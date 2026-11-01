#!/usr/bin/env bash
# =====================================================================
# Fail-closed check for applying the migrations the way the Supabase
# Management API / connector does: each file sent as ONE request (one
# simple-query message), not through psql's file mode or `supabase db push`.
# LOCAL, DISPOSABLE database only (Supabase Postgres image in Docker).
#
#   1  Phase 1C without the initial-admin id: refused, nothing committed
#   2  the activity migration before its dependencies: refused, nothing
#   3  Phase 1C with a failing postcondition (rogue policy): refused,
#      nothing committed (the deferred commit gate inside one request)
#   4  the migrations in order, one request each: applied; the activity
#      post-deploy verification passes; containment = 0. The storage file
#      needs Supabase Storage (present on hosted projects) and is tested by
#      run_phase1c.sh with the storage service; it is not part of this run.
# Exit 0 only if every check passes.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
M="$ROOT/supabase/migrations"
OUT="$(mktemp -d /tmp/single-request.XXXXXX)"
INITIAL_ADMIN=00000000-0000-0000-0000-0000000000a1
NAME="single-req-$$"; STATUS=0
export PGPASSWORD=postgres
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
fail() { echo "  FAIL: $*"; STATUS=1; }
pass() { echo "  pass: $*"; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
ok=0
for _ in $(seq 1 90); do
  if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
    ok=$((ok + 1)); [ "$ok" -ge 3 ] && break; else ok=0; fi
  sleep 1
done
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
# One request: the whole file as a single query string (like the Management API).
one_request() { psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -c "$(cat "$1")" >"$2" 2>&1; }

q supabase_admin -f "$HERE/bootstrap_hosted_auth.sql" >/dev/null
q postgres -f "$ROOT/supabase/baseline/staging_schema_2026-10-15.sql" >/dev/null 2>&1
q supabase_admin -f "$HERE/fixtures_staging_like.sql" >/dev/null
snapshot() { qa "select md5(string_agg(c.relname || ':' || c.relkind::text, ',' order by c.relname)) || ':' || (select count(*) from pg_policies) || ':' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) from pg_class c where c.relnamespace = 'public'::regnamespace"; }

echo "=== 1. Phase 1C without the initial-admin id"
before="$(snapshot)"
if one_request "$M/20261016170000_phase1c_security_containment.sql" "$OUT/1.log"; then fail "applied without an admin id"; else
  [ "$(snapshot)" = "$before" ] && [ "$(qa "select to_regclass('public.staff_roles') is null")" = "t" ] \
    && pass "refused ($(grep -m1 -o 'ERROR:.*' "$OUT/1.log" | cut -c1-90)…); nothing committed" || fail "partial change"; fi

echo "=== 2. activity migration before its dependencies"
if one_request "$M/20261030120000_v1_activity_tracking.sql" "$OUT/2.log"; then fail "applied without dependencies"; else
  [ "$(snapshot)" = "$before" ] && pass "refused; nothing committed" || fail "partial change"; fi

echo "=== 3. Phase 1C with a failing postcondition, one request"
sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" \
  "$M/20261016170000_phase1c_security_containment.sql" > "$OUT/p1c.sql"
grep -q "'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID" "$OUT/p1c.sql" || { echo "admin id not substituted"; exit 2; }
python3 -I - "$OUT/p1c.sql" "$OUT/p1c_rogue.sql" <<'PY'
import sys
t = open(sys.argv[1]).read()
marker = "-- 13. POSTCONDITIONS"
assert t.count(marker) == 1
i = t.index(marker)
# A rogue policy just before the postconditions: they must abort, and the
# whole request must commit nothing.
open(sys.argv[2], "w").write(t[:i] + "create policy rogue_all on public.orders for select to authenticated using (true);\n" + t[i:])
PY
if one_request "$OUT/p1c_rogue.sql" "$OUT/3.log"; then
  fail "applied with a rogue policy"
else
  [ "$(snapshot)" = "$before" ] && [ "$(qa "select count(*) from pg_policies where policyname = 'rogue_all'")" = "0" ] \
    && pass "refused ($(grep -m1 -o 'ERROR:.*' "$OUT/3.log" | cut -c1-90)…); nothing committed" || fail "partial change"
fi

echo "=== 4. core, onboarding, nutrition and activity migrations in order, one request each"
for f in "$OUT/p1c.sql" "$M/20261028120000_v1_onboarding_first_order_offer.sql" \
         "$M/20261029120000_v1_nutrition_tracking_engagement.sql" "$M/20261030120000_v1_activity_tracking.sql"; do
  if one_request "$f" "$OUT/apply.log"; then pass "applied $(basename "$f" | sed 's/^p1c.sql$/20261016170000_phase1c_security_containment.sql (admin id set)/')"
  else fail "$(basename "$f"): $(grep -m1 -o 'ERROR:.*' "$OUT/apply.log")"; break; fi
done
[ "$(qa "select count(*) from public.containment_violations() where category in ('drift','containment')")" = "0" ] \
  && pass "containment_violations() = 0" || fail "containment violations present"
[ "$(q postgres -At -f "$HERE/postdeploy_verify_activity_readonly.sql" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["all_required_checks_ok"])')" = "True" ] \
  && pass "postdeploy_verify_activity_readonly.sql: all checks ok" || fail "post-deploy verification failed"
[ "$(qa "select user_id from public.staff_roles where role = 'admin' and is_active")" = "$INITIAL_ADMIN" ] \
  && pass "exactly the supplied initial administrator" || fail "unexpected admin rows"

echo
[ "$STATUS" = "0" ] && echo "ALL SINGLE-REQUEST CHECKS PASSED" || echo "SINGLE-REQUEST CHECKS FAILED"
exit "$STATUS"
