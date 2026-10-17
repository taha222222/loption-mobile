#!/usr/bin/env bash
# =====================================================================
# meal-images checks through the REAL Supabase Storage API (HTTP).
# Called by run_phase1c.sh (scenario S) against a LOCAL storage-api
# container; never against a hosted project. Needs:
#   STORAGE_URL  e.g. http://127.0.0.1:55000
#   JWT_SECRET   the local HS256 secret the container was started with
#   ANON_KEY     anon JWT signed with JWT_SECRET
# Usage: storage_api_tests.sh seed | check
#   seed   create an object owned by customer c1 (works only while the
#          vulnerable staging policies are in place) and one by service
#   check  run every expectation; prints PASS/FAIL; exit 1 on any FAIL
# PASS = the secure behaviour (denied for non-staff writes, allowed for
# admin staff, public read kept).
# =====================================================================
set -uo pipefail
: "${STORAGE_URL:?}" "${JWT_SECRET:?}" "${ANON_KEY:?}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
printf 'GIF89a\x01\x00\x01\x00\x00\x00\x00;' > "$TMP/img.gif"

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

# req <token> <method> <path> [extra curl args...] -> prints HTTP status
req() {
  local tok="$1" method="$2" path="$3"; shift 3
  curl -s -o "$TMP/body" -w '%{http_code}' -X "$method" "$STORAGE_URL$path" \
       -H "Authorization: Bearer $tok" "$@"
}
upload() { req "$1" "$2" "/object/$3" -H 'Content-Type: image/gif' --data-binary @"$TMP/img.gif" "${@:4}"; }
exists() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$STORAGE_URL/object/public/meal-images/$1")" = "200" ]; }

if [ "${1:-}" = "seed" ]; then
  echo "seed: customer-owned object (vulnerable policy): HTTP $(upload "$CUSTOMER" POST meal-images/seed-customer.gif)"
  exit 0
fi

FAILS=0
check() {  # check <id> <expectation> <ok:0|1> <detail>
  if [ "$3" = "1" ]; then echo "  PASS $1  $2  ($4)"; else echo "  FAIL $1  $2  ($4)"; FAILS=$((FAILS + 1)); fi
}
denied() { case "$1" in 2??) echo 0 ;; *) echo 1 ;; esac; }
allowed() { case "$1" in 2??) echo 1 ;; *) echo 0 ;; esac; }

s=$(upload "$ANON_KEY" POST meal-images/anon.gif);              check S01 "anon cannot upload to meal-images" "$(denied "$s")" "HTTP $s"
s=$(upload "$CUSTOMER" POST meal-images/customer-new.gif);      check S02 "customer cannot upload to meal-images" "$(denied "$s")" "HTTP $s"
s=$(upload "$CUSTOMER" PUT meal-images/seed-customer.gif);      check S03 "customer cannot overwrite even an object they uploaded earlier" "$(denied "$s")" "HTTP $s"
s=$(upload "$CUSTOMER" POST meal-images/seed-customer.gif -H 'x-upsert: true')
                                                                check S04 "customer cannot upsert over an existing object" "$(denied "$s")" "HTTP $s"
s=$(req "$CUSTOMER" DELETE /object/meal-images/seed-customer.gif)
ok=$(denied "$s"); exists seed-customer.gif || ok=0;            check S05 "customer cannot delete an object (object still served)" "$ok" "HTTP $s"
s=$(upload "$FLAGGED" POST meal-images/flagged.gif);            check S06 "flagged is_admin account cannot upload" "$(denied "$s")" "HTTP $s"
s=$(req "$CUSTOMER" POST /bucket -H 'Content-Type: application/json' -d '{"name":"evil","public":true}')
                                                                check S07 "customer cannot create a bucket" "$(denied "$s")" "HTTP $s"
s=$(upload "$CUSTOMER" POST src/x.gif);                         check S08 "customer cannot write the private src bucket" "$(denied "$s")" "HTTP $s"
s=$(upload "$ADMIN" POST meal-images/admin.gif);                check S09 "admin staff can upload a meal image" "$(allowed "$s")" "HTTP $s"
s=$(upload "$ADMIN" POST meal-images/admin.gif -H 'x-upsert: true')
                                                                check S10 "admin staff can upsert (app uses upsert: true)" "$(allowed "$s")" "HTTP $s"
ok=0; exists admin.gif && ok=1;                                 check S11 "meal images stay publicly readable" "$ok" "public GET"
s=$(req "$ADMIN" DELETE /object/meal-images/admin.gif);         check S12 "admin staff can delete a meal image" "$(allowed "$s")" "HTTP $s"

echo "  storage API: $((12 - FAILS)) pass / $FAILS fail"
[ "$FAILS" = "0" ]
