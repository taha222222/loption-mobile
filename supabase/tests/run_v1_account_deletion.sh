#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261104120000_v1_account_deletion.sql (in-app account
# deletion).
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated monitor blocks are up to date (--check)
#   2  refusals: without the standalone migration, wrong role, altered
#      monitor; a failing postcondition under ON_ERROR_ROLLBACK=on commits
#      nothing
#   3  migration; monitor fingerprint equals the recorded value; re-run refused
#   4  SQL tests (who may delete, what is deleted, what is kept, isolation)
#      — v1_account_deletion_tests.sql
#   5  regression: standalone SQL tests and Phase 1C tests after it
#   6  rollback restores the standalone monitor; re-apply works
# Exit 0 only if every check passes.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
BASE="$ROOT/supabase/baseline/staging_schema_2026-10-15.sql"
M="$ROOT/supabase/migrations"
MIG_1C="$M/20261016170000_phase1c_security_containment.sql"
CHAIN=("$M/20261028120000_v1_onboarding_first_order_offer.sql" "$M/20261029120000_v1_nutrition_tracking_engagement.sql"
       "$M/20261030120000_v1_activity_tracking.sql")
MIG_S="$M/20261103120000_v1_standalone_tracking.sql"
MIG="$M/20261104120000_v1_account_deletion.sql"
RB="$ROOT/supabase/rollback/v1_account_deletion_rollback.sql"
RB_A="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_account_deletion_tests.sql"; S_TESTS="$HERE/v1_standalone_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
STANDALONE_MD5=1b29b6a009a2f466bd0a12b4e460780c
ACCOUNT_MD5=8c902c66f5fac9b355d28b67c4c03250
OUT="$(mktemp -d /tmp/v1-account-run.XXXXXX)"
INITIAL_ADMIN=00000000-0000-0000-0000-0000000000a1
CONTAINERS=(); STATUS=0
export PGPASSWORD=postgres

cleanup() {
  for c in "${CONTAINERS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done
  if [ -n "${KEEP_OUTPUT:-}" ]; then mkdir -p "$KEEP_OUTPUT" && cp -r "$OUT"/. "$KEEP_OUTPUT"/; fi
  rm -rf "$OUT"
}
trap cleanup EXIT
fail() { echo "  FAIL: $*"; STATUS=1; }
pass() { echo "  pass: $*"; }

start_db() {
  DBNAME="v1acc-$1-$$"
  docker rm -f "$DBNAME" >/dev/null 2>&1 || true
  docker run -d --name "$DBNAME" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  CONTAINERS+=("$DBNAME")
  PORT="$(docker port "$DBNAME" 5432/tcp | head -1 | sed 's/.*://')"
  local ok=0
  for _ in $(seq 1 90); do
    if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
      ok=$((ok + 1)); [ "$ok" -ge 3 ] && break; else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 3 ] || { echo "database did not start"; exit 2; }
}
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
violations() { qa "select count(*) from public.containment_violations() where category in ('drift','containment')"; }
monitor_md5() { qa "select md5(prosrc) from pg_proc where oid = 'public.containment_violations()'::regprocedure"; }
fixtures() {
  q supabase_admin -c "insert into auth.users (id, confirmed_at) select ('00000000-0000-0000-0000-000000000f0' || n)::uuid, now() from generate_series(1, 5) n" >/dev/null
  q postgres -c "insert into public.meals (id, name, price, calories, protein) values ('00000000-0000-0000-0000-00000000aa02', 'Sans info', 50, 0, 0)" >/dev/null
}
profiles() {
  q postgres -c "insert into public.user_profiles (user_id, role, is_admin, gender, age, weight, height, activity_level) values
    ('00000000-0000-0000-0000-000000000f01', 'customer', false, 'man', 30, 70, 175, 'moderate'),
    ('00000000-0000-0000-0000-000000000f02', 'customer', false, 'woman', 25, 60, 165, 'sedentary'),
    ('00000000-0000-0000-0000-000000000f03', 'customer', false, 'unspecified', 30, 70, 175, 'moderate'),
    ('00000000-0000-0000-0000-000000000f04', 'customer', false, 'man', 30, 70, 175, 'moderate'),
    ('00000000-0000-0000-0000-000000000f05', 'customer', false, 'woman', 40, 65, 160, 'light')" >/dev/null
}
time_zones() {
  q postgres -c "update public.user_profiles set time_zone = 'Africa/Casablanca' where user_id::text like '00000000-0000-0000-0000-000000000f0%'" >/dev/null
}
setup() {  # baseline + Phase 1C + onboarding + nutrition + activity (+ fixtures)
  q supabase_admin -f "$BOOT" >/dev/null
  q postgres -f "$BASE" >/dev/null 2>&1
  q supabase_admin -f "$FIX" >/dev/null
  [ "${1:-}" = "plain" ] || fixtures
  sed "s/'e898d986-f8e1-4844-b43c-3996aa094113',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" "$MIG_1C" > "$OUT/p1c.sql"
  q postgres -f "$OUT/p1c.sql" >"$OUT/p1c.log" 2>&1 || { echo "Phase 1C failed: $(tail -3 "$OUT/p1c.log")"; exit 1; }
  local upto="${2:-3}" i=0
  for f in "${CHAIN[@]}"; do
    [ "$i" -lt "$upto" ] || break
    q postgres -f "$f" >"$OUT/chain.log" 2>&1 || { echo "$(basename "$f") failed: $(tail -3 "$OUT/chain.log")"; exit 1; }
    [ "$i" = "0" ] && [ "${1:-}" != "plain" ] && profiles
    [ "$i" = "1" ] && [ "${1:-}" != "plain" ] && time_zones
    i=$((i + 1))
  done
}
as_user() {  # as_user <uuid> <sql>: one PostgREST-like transaction
  q postgres -At -c "begin; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$1\"}', true);
    set local role authenticated; $2; commit;"
}

full() {  # setup + standalone migration (+ staff fixture)
  setup "${1:-}"
  q postgres -f "$MIG_S" >"$OUT/s.log" 2>&1 || { echo "standalone migration failed: $(tail -3 "$OUT/s.log")"; exit 1; }
}

echo "=== 1. generated blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "monitor blocks match their sources" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
setup
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the standalone migration"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regprocedure('public.delete_my_account(text)') is null")" = "t" ] \
    && pass "refused without the standalone migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "$MIG_S" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.standalone_monitor())" > "$OUT/monitor.sql"
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the standalone migration" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$STANDALONE_MD5" ] || { echo "could not restore the standalone monitor"; exit 1; }
sed 's/^-- 10. Postcondition$/grant execute on function public.delete_my_account(text) to anon;\n-- 10. Postcondition/' "$MIG" > "$OUT/rogue.sql"
grep -q "to anon;" "$OUT/rogue.sql" || { echo "mutation not inserted"; exit 2; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regprocedure('public.delete_my_account(text)') is null")" = "t" ] && [ "$(monitor_md5)" = "$STANDALONE_MD5" ] \
  && pass "anon EXECUTE fails the postcondition; under ON_ERROR_ROLLBACK=on the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. migration"
start_db main
full
q supabase_admin -c "insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-000000000f05', 'support')" >/dev/null
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
[ "$(monitor_md5)" = "$ACCOUNT_MD5" ] && pass "monitor fingerprint = recorded value ($ACCOUNT_MD5)" || fail "monitor md5 $(monitor_md5) != $ACCOUNT_MD5"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || fail "containment violations: $(violations)"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "the migration ran twice"; else pass "a second run is refused"; fi

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(detail, '') || ']' from dtests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from dtests.results where not passed")"; np="$(qa "select count(*) from dtests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 10 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 5. regression on fresh databases"
start_db sreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (standalone regression db)"
q postgres -f "$S_TESTS" >"$OUT/stests.out" 2>&1 || fail "standalone test file error: $(tail -3 "$OUT/stests.out")"
sf="$(qa "select count(*) from stests.results where not passed")"; sp="$(qa "select count(*) from stests.results")"
[ "$sf" = "0" ] && [ "$sp" -ge 39 ] && pass "standalone SQL tests: $sp run, all pass with the account-deletion migration" \
  || { fail "standalone SQL tests: $sf fail"; qa "select id || ' ' || coalesce(detail,'') from stests.results where not passed" | sed 's/^/    /'; }
start_db p1creg
full plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (Phase 1C regression db)"
q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests.out" 2>&1 || fail "Phase 1C test file error"
p1f="$(qa "select count(*) from tests.results where not passed")"; p1p="$(qa "select count(*) from tests.results where passed")"
[ "$p1f" = "0" ] && pass "Phase 1C SQL security tests: $p1p pass / 0 fail" \
  || { fail "Phase 1C SQL tests: $p1f fail"; qa "select id || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the Phase 1C tests" || fail "violations after Phase 1C tests"

echo "=== 6. rollback"
start_db rollback
full
q postgres -f "$MIG" >/dev/null 2>&1
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(monitor_md5)" = "$STANDALONE_MD5" ] && pass "standalone monitor restored (1b29b6a0…)" || fail "monitor not restored"
  [ "$(qa "select to_regprocedure('public.delete_my_account(text)') is null")" = "t" ] && pass "function removed" || fail "function still present"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && pass "migration applies again after rollback" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi

echo
[ "$STATUS" = "0" ] && echo "ALL V1 ACCOUNT DELETION CHECKS PASSED" || echo "V1 ACCOUNT DELETION CHECKS FAILED"
exit "$STATUS"
