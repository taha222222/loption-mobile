#!/usr/bin/env bash
# =====================================================================
# meal-images checks through the REAL Supabase Storage API (HTTP).
# Called by run_phase1c.sh (scenario S) against a LOCAL storage-api
# container; never against a hosted project. Needs:
#   STORAGE_URL  e.g. http://127.0.0.1:55000
#   JWT_SECRET   the local HS256 secret the container was started with
#   ANON_KEY, SERVICE_KEY  JWTs signed with JWT_SECRET
# Usage: storage_api_tests.sh seed | check
#   seed   create an object owned by customer c1 (works only while the
#          vulnerable staging policies are in place)
#   check  run every expectation; prints PASS/FAIL; exit 1 on any FAIL
# PASS = the secure / approved behaviour:
#   non-staff writes denied by POLICY (Storage API code 403);
#   admin staff may write approved images; jpeg/png/webp only (else 415);
#   at most 5,242,880 bytes (else 413), enforced by the BUCKET setting
#   (the container's global FILE_SIZE_LIMIT is 50 MiB, so a 413 at
#   5 MiB + 1 byte can only come from the bucket's file_size_limit);
#   public read kept.
# Policy-denial checks upload a valid PNG, so they cannot pass merely
# because the MIME or size limit rejected the request.
# =====================================================================
set -uo pipefail
: "${STORAGE_URL:?}" "${JWT_SECRET:?}" "${ANON_KEY:?}" "${SERVICE_KEY:?}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
RUN="r$(date +%s%N)"   # unique object names per run (a previous run must not cause 409 conflicts)

python3 -I - "$TMP" <<'PY'
import base64, struct, sys, zlib
d = sys.argv[1]
def png(path, size=None):
    # a real 1x1 PNG; optionally padded with an ancillary chunk to an exact size
    def chunk(t, data): return struct.pack('>I', len(data)) + t + data + struct.pack('>I', zlib.crc32(t + data) & 0xffffffff)
    head = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
    body = chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b'')
    if size is not None:
        pad = size - len(head) - len(body) - 12
        head += chunk(b'tEXt', b'x' * pad)
    data = head + body
    assert size is None or len(data) == size
    open(path, 'wb').write(data)
png(d + '/img.png')
png(d + '/exact.png', 5242880)       # exactly 5 MiB
png(d + '/over.png', 5242881)        # 5 MiB + 1 byte
open(d + '/img.jpg', 'wb').write(base64.b64decode(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='))
open(d + '/img.webp', 'wb').write(base64.b64decode('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='))
open(d + '/img.svg', 'w').write('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
open(d + '/img.gif', 'wb').write(b'GIF89a\x01\x00\x01\x00\x00\x00\x00;')
open(d + '/page.html', 'w').write('<html><script>alert(1)</script></html>')
PY

jwt() {  # jwt <sub>  -> authenticated JWT valid for 10 minutes
  python3 -I - "$1" <<'PY'
import base64, hashlib, hmac, json, os, sys, time
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode()
h = b(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode())
p = b(json.dumps({'sub': sys.argv[1], 'role': 'authenticated', 'aud': 'authenticated',
                  'exp': int(time.time()) + 600}).encode())
sig = hmac.new(os.environ['JWT_SECRET'].encode(), (h + '.' + p).encode(), hashlib.sha256).digest()
print(h + '.' + p + '.' + b(sig))
PY
}
CUSTOMER="$(jwt 00000000-0000-0000-0000-0000000000c1)"
ADMIN="$(jwt 00000000-0000-0000-0000-0000000000a1)"
FLAGGED="$(jwt 00000000-0000-0000-0000-0000000000e1)"   # role=customer, is_admin=true

# up <token> <method> <object path> <file> <content-type> [extra curl args]
#   prints the effective outcome: 2xx HTTP code on success, otherwise the
#   Storage API's own statusCode from the error body (403, 413, 415, ...)
up() {
  local tok="$1" method="$2" path="$3" file="$4" ctype="$5"; shift 5
  local http; http="$(curl -s -o "$TMP/body" -w '%{http_code}' -X "$method" "$STORAGE_URL/object/$path" \
       -H "Authorization: Bearer $tok" -H "Content-Type: $ctype" --data-binary @"$file" "$@")"
  outcome "$http"
}
outcome() {
  case "$1" in 2??) echo "$1" ;;
    *) python3 -I -c "import json,sys
try: print(json.load(open(sys.argv[1])).get('statusCode', sys.argv[2]))
except Exception: print(sys.argv[2])" "$TMP/body" "$1" ;; esac
}
req() { local tok="$1" method="$2" path="$3"; shift 3
  outcome "$(curl -s -o "$TMP/body" -w '%{http_code}' -X "$method" "$STORAGE_URL$path" -H "Authorization: Bearer $tok" "$@")"; }
served() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$STORAGE_URL/object/public/meal-images/$1")" = "200" ]; }

if [ "${1:-}" = "seed" ]; then
  echo "seed: customer-owned object (vulnerable policy): $(up "$CUSTOMER" POST meal-images/seed-customer.png "$TMP/img.png" image/png)"
  exit 0
fi

N=0; FAILS=0
check() {  # check <id> <expectation> <actual> <expected...>
  local id="$1" what="$2" got="$3"; shift 3; N=$((N + 1))
  for want in "$@"; do
    if [ "$got" = "$want" ]; then echo "  PASS $id  $what  (got $got)"; return; fi
  done
  echo "  FAIL $id  $what  (got $got, expected $*)"; FAILS=$((FAILS + 1))
}

echo "  -- authorization (valid PNG bodies, so a denial is the policy, not the limits)"
check S01 "anon cannot upload"                                  "$(up "$ANON_KEY" POST meal-images/$RUN-anon.png "$TMP/img.png" image/png)" 403
check S02 "customer cannot upload"                              "$(up "$CUSTOMER" POST meal-images/$RUN-customer-new.png "$TMP/img.png" image/png)" 403
check S03 "customer cannot overwrite an object they uploaded"   "$(up "$CUSTOMER" PUT meal-images/seed-customer.png "$TMP/img.png" image/png)" 403
check S04 "customer cannot upsert over an existing object"      "$(up "$CUSTOMER" POST meal-images/seed-customer.png "$TMP/img.png" image/png -H 'x-upsert: true')" 403
got="$(req "$CUSTOMER" DELETE /object/meal-images/seed-customer.png)"; served seed-customer.png || got="$got+object-gone"
check S05 "customer cannot delete an object (object still served)" "$got" 403
check S06 "flagged is_admin account cannot upload"              "$(up "$FLAGGED" POST meal-images/$RUN-flagged.png "$TMP/img.png" image/png)" 403
check S07 "customer cannot create a bucket"                     "$(req "$CUSTOMER" POST /bucket -H 'Content-Type: application/json' -d '{"name":"evil","public":true}')" 403
check S08 "customer cannot write the private src bucket"        "$(up "$CUSTOMER" POST src/$RUN-x.png "$TMP/img.png" image/png)" 403

echo "  -- approved types (admin staff)"
check S09 "admin can upload image/png"                          "$(up "$ADMIN" POST meal-images/$RUN-ok.png "$TMP/img.png" image/png)" 200
check S10 "admin can upload image/jpeg"                         "$(up "$ADMIN" POST meal-images/$RUN-ok.jpg "$TMP/img.jpg" image/jpeg)" 200
check S11 "admin can upload image/webp"                         "$(up "$ADMIN" POST meal-images/$RUN-ok.webp "$TMP/img.webp" image/webp)" 200
check S12 "admin can upsert an approved image (app uses upsert)" "$(up "$ADMIN" POST meal-images/$RUN-ok.png "$TMP/img.png" image/png -H 'x-upsert: true')" 200

echo "  -- rejected types (admin staff; 415 = invalid_mime_type)"
check S13 "image/svg+xml is rejected"                           "$(up "$ADMIN" POST meal-images/$RUN-bad.svg "$TMP/img.svg" image/svg+xml)" 415
check S14 "image/gif is rejected"                               "$(up "$ADMIN" POST meal-images/$RUN-bad.gif "$TMP/img.gif" image/gif)" 415
check S15 "text/html is rejected"                               "$(up "$ADMIN" POST meal-images/$RUN-bad.html "$TMP/page.html" text/html)" 415
check S16 "application/octet-stream is rejected"                "$(up "$ADMIN" POST meal-images/$RUN-bad.bin "$TMP/img.png" application/octet-stream)" 415
check S17 "an overwrite cannot change an object to SVG"         "$(up "$ADMIN" PUT meal-images/$RUN-ok.png "$TMP/img.svg" image/svg+xml)" 415

echo "  -- size limit (bucket file_size_limit; container global limit is 50 MiB)"
check S18 "exactly 5,242,880 bytes is accepted"                 "$(up "$ADMIN" POST meal-images/$RUN-exact.png "$TMP/exact.png" image/png)" 200
check S19 "5,242,881 bytes is rejected (413)"                   "$(up "$ADMIN" POST meal-images/$RUN-over.png "$TMP/over.png" image/png)" 413

echo "  -- effective bucket configuration as reported by the Storage API"
cfg="$(curl -s "$STORAGE_URL/bucket/meal-images" -H "Authorization: Bearer $SERVICE_KEY" | python3 -I -c "import json,sys
b = json.load(sys.stdin)
print('public=%s size=%s mime=%s' % (b.get('public'), b.get('file_size_limit'), ','.join(b.get('allowed_mime_types') or []) or None))")"
check S20 "bucket: public, 5 MiB, jpeg/png/webp"                "$cfg" "public=True size=5242880 mime=image/jpeg,image/png,image/webp"

echo "  -- public read and admin delete"
ok=no; served "$RUN-ok.webp" && ok=yes;                                check S21 "approved images are publicly readable" "$ok" yes
check S22 "admin can delete a meal image"                       "$(req "$ADMIN" DELETE "/object/meal-images/$RUN-ok.jpg")" 200

echo "  -- documented limitation (not a pass/fail check)"
lim="$(up "$ADMIN" POST meal-images/$RUN-svg-bytes-as.png "$TMP/img.svg" image/png)"
echo "  LIMIT     SVG bytes declared as image/png -> $lim (the allowlist checks the declared Content-Type, not the bytes)"
[ "$lim" = "200" ] && req "$ADMIN" DELETE /object/meal-images/$RUN-svg-bytes-as.png >/dev/null

echo "  storage API: $((N - FAILS)) pass / $FAILS fail"
[ "$FAILS" = "0" ]
