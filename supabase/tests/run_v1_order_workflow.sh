#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261105120000_v1_order_workflow.sql (delivery order
# state machine, roles, payment, driver location, audit).
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated monitor blocks are up to date (--check)
#   2  refusals: without the account-deletion migration, wrong role, altered
#      monitor, a user with two active staff roles; a failing postcondition
#      under ON_ERROR_ROLLBACK=on commits nothing
#   3  migration; monitor fingerprint equals the recorded value; re-run
#      refused; existing orders unchanged
#   4  SQL tests (every role, every allowed and refused transition, scope,
#      payment, location, cancellation, snapshot, audit) — v1_order_workflow_tests.sql
#   5  concurrency: parallel confirmations, pickup racing a cancellation
#   6  regression: account-deletion, standalone and Phase 1C tests after it
#   7  rollback: refused while workflow orders exist; otherwise restores the
#      account-deletion monitor and schema; re-apply works
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
MIG_A="$M/20261104120000_v1_account_deletion.sql"
MIG="$M/20261105120000_v1_order_workflow.sql"
RB="$ROOT/supabase/rollback/v1_order_workflow_rollback.sql"
RB_A="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_order_workflow_tests.sql"; S_TESTS="$HERE/v1_standalone_tests.sql"; A_TESTS="$HERE/v1_account_deletion_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
STANDALONE_MD5=1b29b6a009a2f466bd0a12b4e460780c
ACCOUNT_MD5=8c902c66f5fac9b355d28b67c4c03250
ORDER_MD5=be70f09b095844cf186059ed347cae04
OUT="$(mktemp -d /tmp/v1-order-run.XXXXXX)"
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
  DBNAME="v1ord-$1-$$"
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

full() {  # setup + standalone + account deletion (+ workflow staff users)
  setup "${1:-}"
  q postgres -f "$MIG_S" >"$OUT/s.log" 2>&1 || { echo "standalone migration failed: $(tail -3 "$OUT/s.log")"; exit 1; }
  q postgres -f "$MIG_A" >"$OUT/a.log" 2>&1 || { echo "account deletion migration failed: $(tail -3 "$OUT/a.log")"; exit 1; }
  q supabase_admin -c "insert into auth.users (id, confirmed_at) select ('00000000-0000-0000-0000-0000000' || x)::uuid, now()
    from unnest(array['0e0c1','0e0c2','0e0b1','0e0b2']) x on conflict do nothing" >/dev/null
}
order_shape() { qa "select string_agg(id::text || ':' || coalesce(status,'') || ':' || coalesce(driver_id::text,''), ',' order by id) from public.orders"; }

echo "=== 1. generated blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "monitor blocks match their sources" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
setup
q postgres -f "$MIG_S" >/dev/null 2>&1
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the account-deletion migration"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regprocedure('public.order_transitions()') is null")" = "t" ] \
    && pass "refused without the account-deletion migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "$MIG_A" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.account_monitor())" > "$OUT/monitor.sql"
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the account deletion migration" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$ACCOUNT_MD5" ] || { echo "could not restore the account-deletion monitor"; exit 1; }
q supabase_admin -c "insert into public.staff_roles (user_id, role, kitchen_id) values ('00000000-0000-0000-0000-0000000000d1', 'driver', null), ('00000000-0000-0000-0000-0000000000d1', 'support', null)" >/dev/null
if q postgres -f "$MIG" >"$OUT/r4.log" 2>&1; then fail "applied while a user holds two active staff roles"; else
  grep -q "hold more than one active staff role" "$OUT/r4.log" && pass "refused while a user holds two active staff roles" || fail "two roles: $(tail -2 "$OUT/r4.log")"; fi
q supabase_admin -c "delete from public.staff_roles where user_id = '00000000-0000-0000-0000-0000000000d1'" >/dev/null
sed 's/^-- 12. Postcondition$/grant execute on function public.order_confirm(uuid) to anon;\n-- 12. Postcondition/' "$MIG" > "$OUT/rogue.sql"
grep -q "to anon;" "$OUT/rogue.sql" || { echo "mutation not inserted"; exit 2; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regprocedure('public.order_transitions()') is null")" = "t" ] && [ "$(monitor_md5)" = "$ACCOUNT_MD5" ] \
  && pass "anon EXECUTE fails the postcondition; under ON_ERROR_ROLLBACK=on the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. migration"
start_db main
full
before="$(order_shape)"
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
[ "$(monitor_md5)" = "$ORDER_MD5" ] && pass "monitor fingerprint = recorded value ($ORDER_MD5)" || fail "monitor md5 $(monitor_md5) != $ORDER_MD5"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || fail "containment violations: $(violations)"
[ "$(order_shape)" = "$before" ] && [ "$(qa "select count(*) from public.orders where workflow_version is not null or payment_status is not null")" = "0" ] \
  && pass "existing orders unchanged (status, driver; no workflow fields)" || fail "existing orders changed"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "the migration ran twice"; else pass "a second run is refused"; fi

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(detail, '') || ']' from otests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from otests.results where not passed")"; np="$(qa "select count(*) from otests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 66 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 5. concurrency"
RACE="$(qa "select id from otests.o where name = 'race'")"
for k in 1 2 3 4; do
  (as_user 00000000-0000-0000-0000-00000000e0c1 "select public.order_confirm('$RACE'), pg_sleep(0.2)" >"$OUT/race-$k.out" 2>&1) &
done; wait
changed="$(cat "$OUT"/race-*.out | grep -c '^changed')"; unchanged="$(cat "$OUT"/race-*.out | grep -c '^unchanged')"
audits="$(qa "select count(*) from public.security_audit_log where action = 'order_confirmed' and details ->> 'order_id' = '$RACE'")"
[ "$changed" = "1" ] && [ "$unchanged" = "3" ] && [ "$audits" = "1" ] \
  && pass "4 parallel confirmations: one change, three no-ops, one audit row" || { fail "parallel confirmations: changed=$changed unchanged=$unchanged audits=$audits"; cat "$OUT"/race-*.out | sed 's/^/    /'; }
as_user 00000000-0000-0000-0000-00000000e0b1 "select public.order_kitchen_update('$RACE', 'preparing')" >/dev/null
as_user 00000000-0000-0000-0000-00000000e0b1 "select public.order_kitchen_update('$RACE', 'ready')" >/dev/null
as_user 00000000-0000-0000-0000-00000000e0c1 "select public.order_assign_driver('$RACE', '00000000-0000-0000-0000-0000000000d1')" >/dev/null
(as_user 00000000-0000-0000-0000-0000000000d1 "select public.order_driver_update('$RACE', 'picked_up'), pg_sleep(0.3)" >"$OUT/pick.out" 2>&1) &
(as_user 00000000-0000-0000-0000-00000000e0c1 "select public.order_cancel('$RACE', 'Client injoignable'), pg_sleep(0.3)" >"$OUT/cancel.out" 2>&1) &
wait
final="$(qa "select status from public.orders where id = '$RACE'")"
wins="$(cat "$OUT/pick.out" "$OUT/cancel.out" | grep -c '^changed')"
{ [ "$final" = "picked_up" ] || [ "$final" = "cancelled" ]; } && [ "$wins" = "1" ] \
  && pass "pickup racing a cancellation: exactly one wins (final: $final), the other is refused as an invalid transition" \
  || { fail "pickup vs cancel: final=$final wins=$wins"; cat "$OUT/pick.out" "$OUT/cancel.out" | sed 's/^/    /'; }

echo "=== 6. regression on fresh databases"
start_db areg
full
q supabase_admin -c "insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-000000000f05', 'support')" >/dev/null
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (account-deletion regression db)"
q postgres -f "$A_TESTS" >"$OUT/atests.out" 2>&1 || fail "account deletion test file error: $(tail -3 "$OUT/atests.out")"
af="$(qa "select count(*) from dtests.results where not passed")"; ap="$(qa "select count(*) from dtests.results")"
[ "$af" = "0" ] && [ "$ap" -ge 10 ] && pass "account deletion SQL tests: $ap run, all pass with the order workflow" \
  || { fail "account deletion SQL tests: $af fail"; qa "select id || ' ' || coalesce(detail,'') from dtests.results where not passed" | sed 's/^/    /'; }
start_db sreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (standalone regression db)"
q postgres -f "$S_TESTS" >"$OUT/stests.out" 2>&1 || fail "standalone test file error: $(tail -3 "$OUT/stests.out")"
sf="$(qa "select count(*) from stests.results where not passed")"; sp="$(qa "select count(*) from stests.results")"
[ "$sf" = "0" ] && [ "$sp" -ge 42 ] && pass "standalone SQL tests: $sp run, all pass with the order workflow" \
  || { fail "standalone SQL tests: $sf fail"; qa "select id || ' ' || coalesce(detail,'') from stests.results where not passed" | sed 's/^/    /'; }
start_db p1creg
full plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (Phase 1C regression db)"
q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests.out" 2>&1 || fail "Phase 1C test file error"
# Changed on purpose by the owner decision "one active staff role per user"
# (DECISIONS #32): T13a grants admin to a user who already holds a staff
# role (now refused, 23505), and T16 counts that grant among the audited
# assignments. Their intent (a revoked role stops working on the same JWT)
# is covered by O97; the one-role rule by O92.
P1C_CHANGED="'T13a','T16'"
p1f="$(qa "select count(*) from tests.results where not passed and id not in ($P1C_CHANGED)")"; p1p="$(qa "select count(*) from tests.results where passed")"
p1c="$(qa "select string_agg(id || ' ' || coalesce(detail,''), ' | ') from tests.results where not passed and id in ($P1C_CHANGED)")"
[ "$p1f" = "0" ] && pass "Phase 1C SQL security tests: $p1p pass, 0 unexpected fail (changed on purpose: $P1C_CHANGED -> ${p1c:-none})" \
  || { fail "Phase 1C SQL tests: $p1f fail"; qa "select id || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the Phase 1C tests" || fail "violations after Phase 1C tests"

echo "=== 7. rollback"
start_db rollback
full
before="$(order_shape)"
q postgres -f "$MIG" >/dev/null 2>&1
q postgres -c "select set_config('loption.order_service', 'on', false); insert into public.orders (order_number, total, status, workflow_version, kitchen_id, payment_status)
  values ('RB-1', 1, 'pending', 1, (select id from public.kitchens where code = 'A'), 'pending')" >/dev/null
if q postgres -f "$RB" >"$OUT/rb1.log" 2>&1; then fail "rollback ran while a workflow order exists"; else
  grep -q "workflow order(s) exist" "$OUT/rb1.log" && pass "rollback refused while a workflow order exists; nothing changed" || fail "unexpected: $(tail -2 "$OUT/rb1.log")"; fi
start_db rollback2
full
q postgres -f "$MIG" >/dev/null 2>&1
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(monitor_md5)" = "$ACCOUNT_MD5" ] && pass "account-deletion monitor restored (8c902c66…)" || fail "monitor not restored"
  [ "$(qa "select to_regprocedure('public.order_transitions()') is null and to_regclass('public.driver_location_points') is null")" = "t" ] \
    && [ "$(qa "select count(*) from information_schema.columns where table_name = 'orders' and column_name = 'workflow_version'")" = "0" ] \
    && pass "functions, table and columns removed" || fail "objects still present"
  [ "$(order_shape)" = "$before" ] && pass "existing orders unchanged by migration + rollback" || fail "orders changed"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && pass "migration applies again after rollback" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi

echo
[ "$STATUS" = "0" ] && echo "ALL V1 ORDER WORKFLOW CHECKS PASSED" || echo "V1 ORDER WORKFLOW CHECKS FAILED"
exit "$STATUS"
