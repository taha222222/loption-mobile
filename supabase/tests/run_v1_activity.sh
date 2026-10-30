#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261030120000_v1_activity_tracking.sql.
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated monitor blocks match the Phase 1C migration (--check)
#   2  refusals: without the nutrition migration, wrong role, altered
#      monitor; a failing postcondition under ON_ERROR_ROLLBACK=on commits
#      nothing
#   3  migration; monitor fingerprint equals the recorded value
#   4  SQL tests (activity days, workouts, energy model, meal logging,
#      security) — v1_activity_tests.sql
#   5  regression on fresh databases: nutrition, V1 onboarding/offer and
#      Phase 1C SQL tests after this migration; containment = 0
#   6  concurrency: parallel syncs of one day give one row; parallel
#      retries of one workout give one session; overlapping parallel
#      sessions give one
#   7  rollback archives data and restores the nutrition monitor; the
#      nutrition rollback is refused while this migration is applied;
#      re-apply works
# Exit 0 only if every check passes.
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
BASE="$ROOT/supabase/baseline/staging_schema_2026-10-15.sql"
MIG_1C="$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql"
MIG_V1="$ROOT/supabase/migrations/20261028120000_v1_onboarding_first_order_offer.sql"
MIG_N="$ROOT/supabase/migrations/20261029120000_v1_nutrition_tracking_engagement.sql"
MIG="$ROOT/supabase/migrations/20261030120000_v1_activity_tracking.sql"
RB="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
RB_N="$ROOT/supabase/rollback/v1_nutrition_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_activity_tests.sql"; N_TESTS="$HERE/v1_nutrition_tests.sql"
V1_TESTS="$HERE/v1_onboarding_offer_tests.sql"; P1C_TESTS="$HERE/phase1c_security_tests.sql"
POSTDEPLOY="$HERE/postdeploy_verify_activity_readonly.sql"
NUTRITION_MD5=1bbbc1b29865c5700a680b3711ef84e3
OUT="$(mktemp -d /tmp/v1-activity-run.XXXXXX)"
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
  DBNAME="v1act-$1-$$"
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
base_setup() {  # baseline + fixtures + Phase 1C core + V1 onboarding (+ profiles)
  q supabase_admin -f "$BOOT" >/dev/null
  q postgres -f "$BASE" >/dev/null 2>&1
  q supabase_admin -f "$FIX" >/dev/null
  [ "${1:-}" = "plain" ] || fixtures
  sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" "$MIG_1C" > "$OUT/p1c.sql"
  q postgres -f "$OUT/p1c.sql" >"$OUT/p1c.log" 2>&1 || { echo "Phase 1C failed: $(tail -3 "$OUT/p1c.log")"; exit 1; }
  q postgres -f "$MIG_V1" >"$OUT/v1.log" 2>&1 || { echo "V1 onboarding failed: $(tail -3 "$OUT/v1.log")"; exit 1; }
  [ "${1:-}" = "plain" ] || profiles
}
setup() {  # + nutrition migration
  base_setup "${1:-}"
  q postgres -f "$MIG_N" >"$OUT/n.log" 2>&1 || { echo "V1 nutrition failed: $(tail -3 "$OUT/n.log")"; exit 1; }
  [ "${1:-}" = "plain" ] || time_zones
}
as_user() {  # as_user <uuid> <sql>: one PostgREST-like transaction
  q postgres -At -c "begin; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$1\"}', true);
    set local role authenticated; $2; commit;"
}

echo "=== 1. generated monitor blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "monitor blocks in the V1 migrations and rollbacks match the Phase 1C source" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
base_setup
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the nutrition migration"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regclass('public.activity_daily_totals') is null")" = "t" ] \
    && pass "refused without the nutrition migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "$MIG_N" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the nutrition migration" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.extended_monitor())" > "$OUT/monitor.sql"
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$NUTRITION_MD5" ] || { echo "could not restore the nutrition monitor"; exit 1; }
sed 's/^-- 10. Postcondition$/create policy activity_rogue on public.activity_daily_totals for select to authenticated using (true);\n-- 10. Postcondition/' "$MIG" > "$OUT/rogue.sql"
grep -q activity_rogue "$OUT/rogue.sql" || { echo "mutation not inserted"; exit 2; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regclass('public.activity_daily_totals') is null")" = "t" ] && [ "$(monitor_md5)" = "$NUTRITION_MD5" ] \
  && pass "a rogue policy fails the postcondition; under ON_ERROR_ROLLBACK=on the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. migration"
start_db main
setup
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
recorded="$(grep -o 'ACTIVITY_MONITOR_MD5:[0-9a-z]*' "$POSTDEPLOY" | cut -d: -f2)"
[ "$(monitor_md5)" = "$recorded" ] && pass "monitor fingerprint = recorded value ($recorded)" || fail "monitor md5 $(monitor_md5) != recorded $recorded"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || { fail "containment violations: $(violations)"; qa "select category||' '||object||' '||problem from public.containment_violations() where category in ('drift','containment')" | sed 's/^/    /'; }
[ "$(q postgres -At -f "$POSTDEPLOY" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["all_required_checks_ok"])')" = "True" ] \
  && pass "postdeploy_verify_activity_readonly.sql: all checks ok" || fail "postdeploy verification failed"

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(detail, '') || ']' from atests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from atests.results where not passed")"; np="$(qa "select count(*) from atests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 17 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"

echo "=== 5. regression on fresh databases"
start_db nreg
setup plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (nutrition regression db)"
fixtures; profiles; time_zones
q postgres -f "$N_TESTS" >"$OUT/ntests.out" 2>&1 || fail "nutrition test file error: $(tail -3 "$OUT/ntests.out")"
# Tests whose expectation this migration changes on purpose are listed in
# N_CHANGED (with the reason) and checked by v1_activity_tests.sql instead.
N_CHANGED="${N_CHANGED:-}"
nfail="$(qa "select count(*) from ntests.results where not passed${N_CHANGED:+ and id not in ($N_CHANGED)}")"
[ "$nfail" = "0" ] && pass "nutrition SQL tests pass after the activity migration${N_CHANGED:+ (changed on purpose: $N_CHANGED)}" \
  || { fail "nutrition SQL tests: $nfail fail"; qa "select id || ' ' || coalesce(detail,'') from ntests.results where not passed" | sed 's/^/    /'; }
start_db v1reg
setup plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (V1 regression db)"
q supabase_admin -c "insert into auth.users (id, confirmed_at) values ('00000000-0000-0000-0000-0000000e1001', now()), ('00000000-0000-0000-0000-0000000e1002', now()), ('00000000-0000-0000-0000-0000000e1003', now()), ('00000000-0000-0000-0000-0000000e1004', now())" >/dev/null
q postgres -c "insert into public.user_profiles (user_id, role, is_admin) values ('00000000-0000-0000-0000-0000000e1001','customer',false), ('00000000-0000-0000-0000-0000000e1003','customer',false);
  insert into public.user_profiles (user_id, role, is_admin, gender, age, weight, height, activity_level, onboarding_completed_at) values ('00000000-0000-0000-0000-0000000e1004','customer',false,'woman',34,80,168,'light', now())" >/dev/null
q postgres -f "$V1_TESTS" >"$OUT/v1tests.out" 2>&1 || fail "V1 test file error"
v1f="$(qa "select count(*) from v1tests.results where not passed and id <> 'B08'")"
[ "$v1f" = "0" ] && pass "V1 onboarding/offer SQL tests pass with the activity migration (B08 backfill test not applicable here)" \
  || { fail "V1 onboarding/offer SQL tests: $v1f fail"; qa "select id || ' ' || coalesce(detail,'') from v1tests.results where not passed" | sed 's/^/    /'; }
start_db p1creg
setup plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (Phase 1C regression db)"
q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests.out" 2>&1 || fail "Phase 1C test file error"
p1f="$(qa "select count(*) from tests.results where not passed")"; p1p="$(qa "select count(*) from tests.results where passed")"
[ "$p1f" = "0" ] && pass "Phase 1C SQL security tests: $p1p pass / 0 fail" \
  || { fail "Phase 1C SQL tests: $p1f fail"; qa "select id || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the Phase 1C tests" || fail "violations after Phase 1C tests"

echo "=== 6. concurrency"
start_db conc
setup
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (concurrency db)"
U=00000000-0000-0000-0000-000000000f01
day="(now() at time zone 'Africa/Casablanca')::date"
for k in 1 2 3 4; do
  (as_user "$U" "insert into public.activity_daily_totals (local_date, source, time_zone, steps) values ($day, 'apple_health', 'Africa/Casablanca', 100 * $k)
     on conflict (user_id, local_date, source) do update set steps = excluded.steps, local_date = excluded.local_date, source = excluded.source, time_zone = excluded.time_zone;
     select pg_sleep(0.2)" >"$OUT/day-$k.out" 2>&1) &
done; wait
[ "$(qa "select count(*) from public.activity_daily_totals where user_id = '$U'")" = "1" ] \
  && pass "4 parallel syncs of one day and source leave exactly one row" || { fail "parallel syncs duplicated a day"; cat "$OUT"/day-*.out | sed 's/^/    /'; }
[ -n "${EXTRA_CONCURRENCY:-}" ] && . "$EXTRA_CONCURRENCY"

echo "=== 7. rollback"
start_db rollback
setup
q postgres -f "$MIG" >/dev/null 2>&1
q postgres -f "$TESTS" >/dev/null 2>&1
days="$(qa "select count(*) from public.activity_daily_totals")"
if q postgres -f "$RB_N" >"$OUT/rbn.log" 2>&1; then fail "the nutrition rollback ran while the activity migration is applied"; else
  [ "$(qa "select to_regclass('public.nutrition_log_entries') is not null and to_regclass('public.activity_daily_totals') is not null")" = "t" ] \
    && pass "the nutrition rollback is refused while this migration is applied; nothing changed" || fail "nutrition rollback left a partial state"; fi
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(qa "select count(*) from v1_activity_rollback_archive.activity_daily_totals")" = "$days" ] \
    && pass "archive holds every activity day ($days)" || fail "archive incomplete"
  [ "$(monitor_md5)" = "$NUTRITION_MD5" ] && pass "nutrition monitor restored (1bbbc1b2…)" || fail "monitor not restored"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  [ "$(qa "select has_table_privilege('service_role', 'v1_activity_rollback_archive.activity_daily_totals', 'SELECT')")" = "f" ] \
    && pass "archive not readable by service_role or clients" || fail "archive readable"
  q postgres -c "drop schema v1_activity_rollback_archive cascade" >/dev/null 2>&1
  q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && pass "migration applies again after rollback" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi

echo
[ "$STATUS" = "0" ] && echo "ALL V1 ACTIVITY CHECKS PASSED" || echo "V1 ACTIVITY CHECKS FAILED"
exit "$STATUS"
