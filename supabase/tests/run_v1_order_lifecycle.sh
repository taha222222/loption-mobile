#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261110120000_v1_order_lifecycle_hardening.sql and the
# confirmed delivery-order lifecycle (Milestone 1).
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated blocks are up to date (--check)
#   2  refusals: without the checkout migration, wrong role, altered monitor;
#      a failing postcondition (guard without DELETE) commits nothing
#   3  the gaps exist before the migration (admin deletes a workflow order,
#      service_role rewrites its timeline); migration; monitor unchanged;
#      re-run refused
#   4  SQL tests — v1_order_lifecycle_tests.sql (all 64 status x action
#      combinations, cancellation, scope, bypass, payment, first-order rule)
#   5  concurrency: two cashiers confirm at once; pickup races a cancellation;
#      parallel identical cancellations
#   6  regression: order workflow, checkout experience, account deletion,
#      standalone, Phase 1C
#   7  rollback restores the previous guard (the gap is back), the checkout
#      rollback still runs after it; re-apply on a fresh chain
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
MIG_O="$M/20261105120000_v1_order_workflow.sql"
MIG_C="$M/20261106120000_v1_create_order.sql"
MIG_Z="$M/20261107120000_v1_delivery_zones.sql"
MIG_P="$M/20261108120000_v1_pricing_engine.sql"
MIG_X="$M/20261109120000_v1_checkout_experience.sql"
MIG="$M/20261110120000_v1_order_lifecycle_hardening.sql"
RB="$ROOT/supabase/rollback/v1_order_lifecycle_hardening_rollback.sql"
RB_X="$ROOT/supabase/rollback/v1_checkout_experience_rollback.sql"
RB_P="$ROOT/supabase/rollback/v1_pricing_engine_rollback.sql"
RB_Z="$ROOT/supabase/rollback/v1_delivery_zones_rollback.sql"
RB_A="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_order_lifecycle_tests.sql"; X_TESTS="$HERE/v1_checkout_experience_tests.sql"; O_TESTS="$HERE/v1_order_workflow_tests.sql"; S_TESTS="$HERE/v1_standalone_tests.sql"; A_TESTS="$HERE/v1_account_deletion_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
STANDALONE_MD5=1b29b6a009a2f466bd0a12b4e460780c
ACCOUNT_MD5=8c902c66f5fac9b355d28b67c4c03250
ORDER_MD5=be70f09b095844cf186059ed347cae04
CREATE_MD5=b40dfd53391a3b70942cfa91bb03236d
ZONES_MD5=fc876c0897b2e23a59fe2cfecfcd3ad7
CHECKOUT_MD5=39523bf8d3b37e19078633046313f8eb
OUT="$(mktemp -d /tmp/v1-lifecycle-run.XXXXXX)"
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
  DBNAME="v1lc-$1-$$"
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

full() {  # setup + standalone + account deletion + order workflow + create_order + zones + pricing + checkout (+ staff users)
  setup "${1:-}"
  q postgres -f "$MIG_S" >"$OUT/s.log" 2>&1 || { echo "standalone migration failed: $(tail -3 "$OUT/s.log")"; exit 1; }
  q postgres -f "$MIG_A" >"$OUT/a.log" 2>&1 || { echo "account deletion migration failed: $(tail -3 "$OUT/a.log")"; exit 1; }
  q supabase_admin -c "insert into auth.users (id, confirmed_at) select ('00000000-0000-0000-0000-0000000' || x)::uuid, now()
    from unnest(array['0e0c1','0e0c2','0e0b1','0e0b2']) x on conflict do nothing" >/dev/null
  [ "${2:-}" = "no-orders" ] && return 0
  q postgres -f "$MIG_O" >"$OUT/o.log" 2>&1 || { echo "order workflow migration failed: $(tail -3 "$OUT/o.log")"; exit 1; }
  [ "${2:-}" = "no-create" ] && return 0
  q postgres -f "$MIG_C" >"$OUT/c.log" 2>&1 || { echo "create_order migration failed: $(tail -3 "$OUT/c.log")"; exit 1; }
  [ "${2:-}" = "no-zones" ] && return 0
  q postgres -f "$MIG_Z" >"$OUT/z.log" 2>&1 || { echo "delivery zones migration failed: $(tail -3 "$OUT/z.log")"; exit 1; }
  [ "${2:-}" = "no-pricing" ] && return 0
  q postgres -f "$MIG_P" >"$OUT/p.log" 2>&1 || { echo "pricing engine migration failed: $(tail -3 "$OUT/p.log")"; exit 1; }
  [ "${2:-}" = "no-checkout" ] && return 0
  q postgres -f "$MIG_X" >"$OUT/x.log" 2>&1 || { echo "checkout experience migration failed: $(tail -3 "$OUT/x.log")"; exit 1; }
}
order_shape() { qa "select string_agg(id::text || ':' || coalesce(status,'') || ':' || coalesce(total::text,''), ',' order by id) from public.orders"; }

# A workflow order as the order service creates it (postgres + service flag).
mk_order() {  # mk_order <status> <driver-or-empty>
  qa "select set_config('loption.order_service','on',false);
      insert into public.orders (order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id, driver_id, total, subtotal)
      select 'H-' || substr(md5(random()::text), 1, 8), '$1', 1, id, 'pending', 'cash', '00000000-0000-0000-0000-000000000f02',
             $( [ -n "${2:-}" ] && echo "'$2'::uuid" || echo null ), 50, 50 from public.kitchens where code = 'A' returning id" | tail -1
}

echo "=== 1. generated blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "generated blocks match their sources" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
full "" no-checkout
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the checkout migration"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regprocedure('public.order_status_updates_guard()') is null")" = "t" ] \
    && pass "refused without the checkout experience migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "$MIG_X" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.checkout_monitor())" > "$OUT/monitor.sql"
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the checkout experience" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$CHECKOUT_MD5" ] || { echo "could not restore the checkout monitor"; exit 1; }
grep -q "^-- 4. Postcondition$" "$MIG" || { echo "postcondition marker not found"; exit 2; }
sed "s/^-- 4. Postcondition$/drop trigger trg_orders_workflow_guard on public.orders; create trigger trg_orders_workflow_guard before insert or update on public.orders for each row execute function public.orders_workflow_guard();\n-- 4. Postcondition/" "$MIG" > "$OUT/rogue.sql"
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regprocedure('public.order_status_updates_guard()') is null")" = "t" ] \
  && pass "a guard without DELETE fails the postcondition; the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. gaps before, migration"
start_db main
full
O="$(mk_order pending)"
q postgres -At -c "begin; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$INITIAL_ADMIN\"}', true);
  set local role authenticated; delete from public.orders where id = '$O'; reset role;
  select 'left=' || count(*) from public.orders where id = '$O'; rollback;" > "$OUT/gap.out" 2>&1
grep -q "left=0" "$OUT/gap.out" && pass "before: an admin can delete a workflow order (gap reproduced)" || fail "gap not reproduced: $(cat "$OUT/gap.out")"
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
q postgres -At -c "begin; select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"sub\":\"$INITIAL_ADMIN\"}', true);
  set local role authenticated; delete from public.orders where id = '$O'; rollback;" > "$OUT/gap2.out" 2>&1
grep -q "never deleted" "$OUT/gap2.out" && pass "after: the same delete is refused" || fail "after: $(cat "$OUT/gap2.out")"
[ "$(monitor_md5)" = "$CHECKOUT_MD5" ] && pass "monitor unchanged ($CHECKOUT_MD5)" || fail "monitor md5 $(monitor_md5) != $CHECKOUT_MD5"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || fail "containment violations: $(violations)"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "the migration ran twice"; else pass "a second run is refused"; fi

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(left(detail, 140), '') || ']' from ltests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from ltests.results where not passed")"; np="$(qa "select count(*) from ltests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 21 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 5. concurrency"
C1=00000000-0000-0000-0000-00000000e0c1; D1=00000000-0000-0000-0000-0000000000d1; F02=00000000-0000-0000-0000-000000000f02
O="$(mk_order pending)"
for who in "$C1" "$INITIAL_ADMIN"; do
  (as_user "$who" "select public.order_confirm('$O'), pg_sleep(0.3)" >"$OUT/conf-$who.out" 2>&1) &
done; wait
ch="$(cat "$OUT"/conf-*.out | grep -c '^changed')"; un="$(cat "$OUT"/conf-*.out | grep -c '^unchanged')"
au="$(qa "select count(*) from public.security_audit_log where action = 'order_confirmed' and details ->> 'order_id' = '$O'")"
[ "$ch" = "1" ] && [ "$un" = "1" ] && [ "$au" = "1" ] && pass "two staff confirm at once: one change, one 'unchanged', one audit row" \
  || { fail "parallel confirm: changed=$ch unchanged=$un audits=$au"; cat "$OUT"/conf-*.out | sed 's/^/    /'; }
O="$(mk_order ready "$D1")"
(as_user "$D1" "select public.order_driver_update('$O', 'picked_up'), pg_sleep(0.3)" >"$OUT/race-pick.out" 2>&1) &
(as_user "$C1" "select public.order_cancel('$O', 'Annulation test'), pg_sleep(0.3)" >"$OUT/race-cancel.out" 2>&1) &
wait
st="$(qa "select status from public.orders where id = '$O'")"
wins="$(cat "$OUT"/race-*.out | grep -c '^changed')"
tl="$(qa "select count(*) from public.order_status_updates where order_id = '$O' and status in ('picked_up','cancelled')")"
{ [ "$st" = "picked_up" ] || [ "$st" = "cancelled" ]; } && [ "$wins" = "1" ] && [ "$tl" = "1" ] \
  && pass "pickup races a cancellation: exactly one wins ($st), one timeline row" || { fail "race: status=$st wins=$wins timeline=$tl"; cat "$OUT"/race-*.out | sed 's/^/    /'; }
O="$(mk_order pending)"
for k in 1 2 3 4; do (as_user "$F02" "select public.order_cancel('$O', null), pg_sleep(0.2)" >"$OUT/cc-$k.out" 2>&1) & done; wait
ch="$(cat "$OUT"/cc-*.out | grep -c '^changed')"
au="$(qa "select count(*) from public.security_audit_log where action = 'order_cancelled' and details ->> 'order_id' = '$O'")"
[ "$ch" = "1" ] && [ "$au" = "1" ] && pass "4 parallel identical cancellations by the customer: one change, one audit row" || fail "parallel cancel: changed=$ch audits=$au"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the races" || fail "violations after the races"

echo "=== 6. regression on fresh databases"
start_db oreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (order workflow regression db)"
q postgres -f "$O_TESTS" >"$OUT/otests.out" 2>&1 || fail "order workflow test file error: $(tail -3 "$OUT/otests.out")"
of="$(qa "select count(*) from otests.results where not passed")"; op="$(qa "select count(*) from otests.results")"
[ "$of" = "0" ] && [ "$op" -ge 66 ] && pass "order workflow SQL tests: $op run, all pass" \
  || { fail "order workflow SQL tests: $of fail"; qa "select id || ' ' || coalesce(detail,'') from otests.results where not passed" | sed 's/^/    /'; }
start_db xreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (checkout regression db)"
q postgres -f "$X_TESTS" >"$OUT/xtests.out" 2>&1 || fail "checkout test file error: $(tail -3 "$OUT/xtests.out")"
xf="$(qa "select count(*) from xtests.results where not passed")"; xp="$(qa "select count(*) from xtests.results")"
[ "$xf" = "0" ] && [ "$xp" -ge 40 ] && pass "checkout experience SQL tests (order creation, first-order fees, COD lifecycle): $xp run, all pass" \
  || { fail "checkout SQL tests: $xf fail"; qa "select id || ' ' || coalesce(detail,'') from xtests.results where not passed" | sed 's/^/    /'; }
start_db areg
full
q supabase_admin -c "insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-000000000f05', 'support')" >/dev/null
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (account-deletion regression db)"
q postgres -f "$A_TESTS" >"$OUT/atests.out" 2>&1 || fail "account deletion test file error: $(tail -3 "$OUT/atests.out")"
af="$(qa "select count(*) from dtests.results where not passed")"; ap="$(qa "select count(*) from dtests.results")"
[ "$af" = "0" ] && [ "$ap" -ge 10 ] && pass "account deletion SQL tests (orders detached by account deletion): $ap run, all pass" \
  || { fail "account deletion SQL tests: $af fail"; qa "select id || ' ' || coalesce(detail,'') from dtests.results where not passed" | sed 's/^/    /'; }
start_db sreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (standalone regression db)"
q postgres -f "$S_TESTS" >"$OUT/stests.out" 2>&1 || fail "standalone test file error: $(tail -3 "$OUT/stests.out")"
sf="$(qa "select count(*) from stests.results where not passed")"; sp="$(qa "select count(*) from stests.results")"
[ "$sf" = "0" ] && [ "$sp" -ge 42 ] && pass "standalone tracking SQL tests: $sp run, all pass" \
  || { fail "standalone SQL tests: $sf fail"; qa "select id || ' ' || coalesce(detail,'') from stests.results where not passed" | sed 's/^/    /'; }
start_db p1creg
full plain
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (Phase 1C regression db)"
q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests.out" 2>&1 || fail "Phase 1C test file error"
P1C_CHANGED="'T13a','T16'"
p1f="$(qa "select count(*) from tests.results where not passed and id not in ($P1C_CHANGED)")"; p1p="$(qa "select count(*) from tests.results where passed")"
[ "$p1f" = "0" ] && pass "Phase 1C SQL security tests: $p1p pass, 0 unexpected fail (changed on purpose: $P1C_CHANGED)" \
  || { fail "Phase 1C SQL tests: $p1f fail"; qa "select id || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the Phase 1C tests" || fail "violations after Phase 1C tests"

echo "=== 7. rollback"
start_db rollback
full
q postgres -f "$MIG" >/dev/null 2>&1
q postgres -f "$TESTS" >/dev/null 2>&1
orders="$(qa "select count(*) from public.orders where workflow_version is not null")"
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(monitor_md5)" = "$CHECKOUT_MD5" ] && pass "monitor unchanged" || fail "monitor changed"
  [ "$(qa "select to_regprocedure('public.order_status_updates_guard()') is null and (select prosrc not like '%never deleted%' from pg_proc where oid = 'public.orders_workflow_guard()'::regprocedure)")" = "t" ] \
    && [ "$(qa "select count(*) from public.orders where workflow_version is not null")" = "$orders" ] \
    && pass "previous guard and transition function restored; orders kept ($orders)" || fail "objects or orders wrong"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  q postgres -f "$RB_X" >"$OUT/rbx.log" 2>&1 && pass "the checkout experience rollback still runs after it" || fail "checkout rollback after it: $(tail -2 "$OUT/rbx.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi
start_db reapply
full
q postgres -f "$MIG" >/dev/null 2>&1 && q postgres -f "$RB" >/dev/null 2>&1 && q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && [ "$(violations)" = "0" ] \
  && pass "migration, rollback, migration again on a fresh chain" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"

echo
[ "$STATUS" = "0" ] && echo "ALL V1 ORDER LIFECYCLE CHECKS PASSED" || echo "V1 ORDER LIFECYCLE CHECKS FAILED"
exit "$STATUS"
