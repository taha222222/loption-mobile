#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261103120000_v1_standalone_tracking.sql.
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated monitor and function blocks are up to date (--check)
#   2  refusals: without the activity migration, wrong role, altered
#      monitor; a failing postcondition under ON_ERROR_ROLLBACK=on commits
#      nothing
#   3  migration; monitor fingerprint equals the recorded value; post-deploy
#   4  SQL tests (phone days, energy budget, workouts, gym log, manual
#      meals, cross-account security) — v1_standalone_tests.sql
#   5  regression: activity, nutrition and Phase 1C SQL tests after this
#      migration on fresh databases; containment = 0
#   6  concurrency: parallel phone syncs of one day leave one row with the
#      highest count; parallel gym-log saves leave one log
#   7  rollback archives data and restores the activity definitions; the
#      activity rollback is refused while this migration is applied;
#      re-apply works
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
MIG="$M/20261103120000_v1_standalone_tracking.sql"
RB="$ROOT/supabase/rollback/v1_standalone_tracking_rollback.sql"
RB_A="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_standalone_tests.sql"; A_TESTS="$HERE/v1_activity_tests.sql"; N_TESTS="$HERE/v1_nutrition_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
POSTDEPLOY="$HERE/postdeploy_verify_standalone_readonly.sql"
ACTIVITY_MD5=79b9e433ed0e38d803cdeb89b9847d89
OUT="$(mktemp -d /tmp/v1-standalone-run.XXXXXX)"
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
  DBNAME="v1std-$1-$$"
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

echo "=== 1. generated blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "monitor and restored-function blocks match their sources" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
setup "" 2
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the activity migration"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regclass('public.workout_exercises') is null")" = "t" ] \
    && pass "refused without the activity migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "${CHAIN[2]}" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.activity_monitor())" > "$OUT/monitor.sql"
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the activity migration" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$ACTIVITY_MD5" ] || { echo "could not restore the activity monitor"; exit 1; }
q postgres -c "create or replace function public.activity_met(p_kind text, p_speed_mps numeric) returns numeric language sql immutable set search_path = '' as \$x\$ select 1.0 \$x\$" >/dev/null
sed 's/^-- 10. Postcondition$/create policy gym_rogue on public.workout_sets for select to authenticated using (true);\n-- 10. Postcondition/' "$MIG" > "$OUT/rogue.sql"
grep -q gym_rogue "$OUT/rogue.sql" || { echo "mutation not inserted"; exit 2; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regclass('public.workout_exercises') is null")" = "t" ] && [ "$(monitor_md5)" = "$ACTIVITY_MD5" ] \
  && pass "a rogue policy fails the postcondition; under ON_ERROR_ROLLBACK=on the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. migration"
start_db main
setup
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
recorded="$(grep -o 'STANDALONE_MONITOR_MD5:[0-9a-z]*' "$POSTDEPLOY" | cut -d: -f2)"
[ "$(monitor_md5)" = "$recorded" ] && pass "monitor fingerprint = recorded value ($recorded)" || fail "monitor md5 $(monitor_md5) != recorded $recorded"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || { fail "containment violations: $(violations)"; qa "select category||' '||object||' '||problem from public.containment_violations() where category in ('drift','containment')" | sed 's/^/    /'; }
[ "$(q postgres -At -f "$POSTDEPLOY" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["all_required_checks_ok"])')" = "True" ] \
  && pass "postdeploy_verify_standalone_readonly.sql: all checks ok" || fail "post-deploy verification failed"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "the migration ran twice"; else
  grep -q "already exist\|not the reviewed" "$OUT/rerun.log" && pass "a second run is refused" || fail "re-run: $(tail -2 "$OUT/rerun.log")"; fi

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(detail, '') || ']' from stests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from stests.results where not passed")"; np="$(qa "select count(*) from stests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 39 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 5. regression on fresh databases"
start_db areg
setup
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (activity regression db)"
q postgres -f "$A_TESTS" >"$OUT/atests.out" 2>&1 || fail "activity test file error: $(tail -3 "$OUT/atests.out")"
# Tests whose expectation this migration changes on purpose (with the reason):
#   A12  a phone (device_motion) day may now carry a distance — S01/S04
A_CHANGED="'A12'"
af="$(qa "select count(*) from atests.results where not passed and id not in ($A_CHANGED)")"
ap="$(qa "select count(*) from atests.results")"
[ "$af" = "0" ] && [ "$ap" -ge 50 ] && pass "activity SQL tests: $ap run, all pass after the standalone migration (changed on purpose: $A_CHANGED)" \
  || { fail "activity SQL tests: $af fail"; qa "select id || ' ' || coalesce(detail,'') from atests.results where not passed" | sed 's/^/    /'; }
start_db nreg
setup plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (nutrition regression db)"
fixtures; profiles; time_zones
q postgres -f "$N_TESTS" >"$OUT/ntests.out" 2>&1 || fail "nutrition test file error: $(tail -3 "$OUT/ntests.out")"
N_CHANGED="'T12'"  # T12 changed by the activity migration (received orders only)
nfail="$(qa "select count(*) from ntests.results where not passed and id not in ($N_CHANGED)")"
npass="$(qa "select count(*) from ntests.results")"
[ "$nfail" = "0" ] && [ "$npass" -ge 30 ] && pass "nutrition SQL tests pass after the standalone migration (changed earlier on purpose: $N_CHANGED)" \
  || { fail "nutrition SQL tests: $nfail fail"; qa "select id || ' ' || coalesce(detail,'') from ntests.results where not passed" | sed 's/^/    /'; }
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
  (as_user "$U" "insert into public.activity_daily_totals (local_date, source, time_zone, steps, measured_from, measured_to)
     values ($day, 'device_motion', 'Africa/Casablanca', 100 * $k, $day::timestamp at time zone 'Africa/Casablanca', now())
     on conflict (user_id, local_date, source) do update set steps = excluded.steps, local_date = excluded.local_date, source = excluded.source,
       time_zone = excluded.time_zone, measured_from = excluded.measured_from, measured_to = excluded.measured_to;
     select pg_sleep(0.2)" >"$OUT/day-$k.out" 2>&1) &
done; wait
[ "$(qa "select count(*) || ':' || max(steps) from public.activity_daily_totals where user_id = '$U'")" = "1:400" ] \
  && pass "4 parallel phone syncs of one day leave one row with the highest count" || { fail "parallel phone syncs: $(qa "select count(*) || ':' || max(steps) from public.activity_daily_totals where user_id = '$U'")"; cat "$OUT"/day-*.out | sed 's/^/    /'; }
as_user "$U" "insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, intensity)
  values ('app', '66666666-0000-0000-0000-000000000001', 'gym', now() - interval '300 minutes', now() - interval '270 minutes', 1800, 'Africa/Casablanca', 'moderate')" >/dev/null
for k in 1 2 3; do
  (as_user "$U" "select public.save_gym_log('66666666-0000-0000-0000-000000000001', '[{\"name\":\"Rowing\",\"category\":\"upper_body\",\"sets\":[{\"reps\":10},{\"reps\":10}]}]'::jsonb); select pg_sleep(0.2)" >"$OUT/g-$k.out" 2>&1) &
done; wait
[ "$(qa "select count(*) from public.workout_exercises")" = "1" ] && [ "$(qa "select count(*) from public.workout_sets")" = "2" ] \
  && pass "3 parallel saves of one gym log leave exactly one log" || { fail "parallel gym saves: $(qa "select count(*) from public.workout_exercises") exercises"; cat "$OUT"/g-*.out | sed 's/^/    /'; }

echo "=== 7. rollback"
start_db rollback
setup
q postgres -f "$MIG" >/dev/null 2>&1
q postgres -f "$TESTS" >/dev/null 2>&1
as_user 00000000-0000-0000-0000-000000000f01 "insert into public.workout_sessions (source, client_session_id, kind, started_at, ended_at, active_seconds, time_zone, intensity)
  values ('app', '66666666-0000-0000-0000-000000000009', 'gym', now() - interval '600 minutes', now() - interval '570 minutes', 1800, 'Africa/Casablanca', 'light');
  select public.save_gym_log('66666666-0000-0000-0000-000000000009', '[{\"name\":\"Gainage\",\"category\":\"core\",\"sets\":[{\"reps\":3}]}]'::jsonb)" >/dev/null
ex="$(qa "select count(*) from public.workout_exercises")"
if q postgres -f "$RB_A" >"$OUT/rba.log" 2>&1; then fail "the activity rollback ran while the standalone migration is applied"; else
  [ "$(qa "select to_regclass('public.workout_exercises') is not null and to_regclass('public.activity_daily_totals') is not null")" = "t" ] \
    && pass "the activity rollback is refused while this migration is applied; nothing changed" || fail "activity rollback left a partial state"; fi
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(qa "select count(*) from v1_standalone_rollback_archive.workout_exercises")" = "$ex" ] \
    && [ "$ex" -ge 1 ] && pass "archive holds every gym exercise ($ex)" || fail "archive incomplete ($ex)"
  [ "$(monitor_md5)" = "$ACTIVITY_MD5" ] && pass "activity monitor restored (79b9e433…)" || fail "monitor not restored"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  [ "$(qa "select has_table_privilege('service_role', 'v1_standalone_rollback_archive.workout_sets', 'SELECT')")" = "f" ] \
    && pass "archive not readable by service_role or clients" || fail "archive readable"
  [ "$(qa "select count(*) from public.nutrition_log_entries where meal_id is null")" -ge 1 ] \
    && pass "manual meal entries are kept in the activity schema" || fail "manual entries lost"
  q postgres -c "drop schema v1_standalone_rollback_archive cascade" >/dev/null 2>&1
  q postgres -c "delete from public.nutrition_log_entries where meal_id is null" >/dev/null 2>&1
  q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && pass "migration applies again after rollback" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi

echo
[ "$STATUS" = "0" ] && echo "ALL V1 STANDALONE CHECKS PASSED" || echo "V1 STANDALONE CHECKS FAILED"
exit "$STATUS"
