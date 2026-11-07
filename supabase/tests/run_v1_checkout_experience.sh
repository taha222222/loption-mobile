#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261109120000_v1_checkout_experience.sql (meal choices,
# promo codes, WhatsApp-verified phone, first-order fee rule, price preview,
# create_order v2).
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  generated blocks are up to date (--check)
#   2  refusals: without the pricing engine, wrong role, altered monitor; a
#      failing postcondition (a promo code created by the migration) under
#      ON_ERROR_ROLLBACK=on commits nothing
#   3  migration; monitor fingerprint; re-run refused
#   4  SQL tests — v1_checkout_experience_tests.sql
#   5  concurrency: two first orders of one account in parallel; parallel
#      identical requests
#   6  regression: order workflow, account deletion, standalone, Phase 1C.
#      The create_order / zones / pricing SQL suites call the previous
#      create_order() signature; their cases are covered again by section 4
#      and they still pass on their own migrations.
#   7  rollback (with orders, codes, choices, verified phones) restores the
#      pricing-engine create_order() and monitor; the pricing and zones
#      rollbacks still run after it; re-apply on a fresh chain
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
MIG="$M/20261109120000_v1_checkout_experience.sql"
RB="$ROOT/supabase/rollback/v1_checkout_experience_rollback.sql"
RB_P="$ROOT/supabase/rollback/v1_pricing_engine_rollback.sql"
RB_Z="$ROOT/supabase/rollback/v1_delivery_zones_rollback.sql"
RB_A="$ROOT/supabase/rollback/v1_activity_tracking_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_checkout_experience_tests.sql"; O_TESTS="$HERE/v1_order_workflow_tests.sql"; S_TESTS="$HERE/v1_standalone_tests.sql"; A_TESTS="$HERE/v1_account_deletion_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
STANDALONE_MD5=1b29b6a009a2f466bd0a12b4e460780c
ACCOUNT_MD5=8c902c66f5fac9b355d28b67c4c03250
ORDER_MD5=be70f09b095844cf186059ed347cae04
CREATE_MD5=b40dfd53391a3b70942cfa91bb03236d
ZONES_MD5=fc876c0897b2e23a59fe2cfecfcd3ad7
CHECKOUT_MD5=39523bf8d3b37e19078633046313f8eb
OUT="$(mktemp -d /tmp/v1-checkout-run.XXXXXX)"
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
  DBNAME="v1chk-$1-$$"
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

full() {  # setup + standalone + account deletion + order workflow + create_order + zones + pricing (+ staff users)
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
}
order_shape() { qa "select string_agg(id::text || ':' || coalesce(status,'') || ':' || coalesce(total::text,''), ',' order by id) from public.orders"; }

echo "=== 1. generated blocks"
python3 -I "$ROOT/supabase/tools/generate_nutrition_monitor.py" --check >"$OUT/gen.log" 2>&1 \
  && pass "generated blocks match their sources" || fail "$(cat "$OUT/gen.log")"

echo "=== 2. refusals"
start_db refuse
full "" no-pricing
if q postgres -f "$MIG" >"$OUT/r1.log" 2>&1; then fail "applied without the pricing engine"; else
  grep -q "must be applied first" "$OUT/r1.log" && [ "$(qa "select to_regclass('public.meal_option_groups') is null")" = "t" ] \
    && pass "refused without the pricing engine migration; nothing applied" || fail "unexpected: $(tail -2 "$OUT/r1.log")"; fi
q postgres -f "$MIG_P" >/dev/null 2>&1
if q supabase_admin -f "$MIG" >"$OUT/r2.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/r2.log" && pass "refused as a role other than postgres" || fail "wrong role: $(tail -2 "$OUT/r2.log")"; fi
python3 -I -c "import sys; sys.path.insert(0, '$ROOT/supabase/tools'); import generate_nutrition_monitor as g; print(g.zones_monitor())" > "$OUT/monitor.sql"
q postgres -c "create or replace function public.containment_violations() returns table (category text, object text, problem text) language plpgsql stable set search_path = '' as \$x\$ begin return; end \$x\$" >/dev/null
if q postgres -f "$MIG" >"$OUT/r3.log" 2>&1; then fail "applied over an altered monitor"; else
  grep -q "not the reviewed monitor of the pricing engine" "$OUT/r3.log" && pass "refused over an altered (weakened) monitor" || fail "altered monitor: $(tail -2 "$OUT/r3.log")"; fi
q postgres -f "$OUT/monitor.sql" >/dev/null
[ "$(monitor_md5)" = "$ZONES_MD5" ] || { echo "could not restore the pricing-engine monitor"; exit 1; }
grep -q "^-- 9. Postcondition$" "$MIG" || { echo "postcondition marker not found"; exit 2; }
sed "s/^-- 9. Postcondition$/insert into public.promotions (code, kind, audience, is_active, percent_off) values ('ROGUE', 'percent_off', 'code', true, 100);\n-- 9. Postcondition/" "$MIG" > "$OUT/rogue.sql"
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
[ "$(qa "select to_regclass('public.meal_option_groups') is null")" = "t" ] && [ "$(monitor_md5)" = "$ZONES_MD5" ] \
  && [ "$(qa "select count(*) from public.promotions")" = "1" ] \
  && pass "a promo code created by the migration fails the postcondition; the gate refuses COMMIT; nothing applied" \
  || fail "a failing postcondition still committed changes"

echo "=== 3. migration"
start_db main
full
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "migration applied" || { fail "migration: $(tail -3 "$OUT/mig.log")"; exit 1; }
[ "$(monitor_md5)" = "$CHECKOUT_MD5" ] && pass "monitor fingerprint = recorded value ($CHECKOUT_MD5)" || fail "monitor md5 $(monitor_md5) != $CHECKOUT_MD5"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || fail "containment violations: $(violations)"
[ "$(qa "select count(*) from public.promotions where audience = 'code'")" = "0" ] && [ "$(qa "select count(*) from public.meal_option_groups")" = "0" ] \
  && pass "no promo code, no choice, no verified phone created by the migration" || fail "seed wrong"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "the migration ran twice"; else pass "a second run is refused"; fi

echo "=== 4. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(left(detail, 160), '') || ']' from xtests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from xtests.results where not passed")"; np="$(qa "select count(*) from xtests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 40 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 5. concurrency"
KA="$(qa "select id from public.kitchens where code = 'A'")"
F06=00000000-0000-0000-0000-000000000f06
q supabase_admin -c "insert into auth.users (id, confirmed_at) values ('$F06', now())" >/dev/null
q postgres -c "insert into public.user_profiles (user_id, role, is_admin, delivery_address, delivery_latitude, delivery_longitude, delivery_city, phone_e164, phone_verified_at)
  values ('$F06', 'customer', false, '6 Rue Test, Casablanca', 33.57, -7.59, 'casablanca', '+212600000006', now())" >/dev/null
quote() { qa "select public.record_delivery_quote('$1', (select id from public.pricing_policies where active and kitchen_id = '$KA'),
  (select delivery_address from public.user_profiles where user_id = '$1'), 33.57, -7.59, $2, 'test_router') ->> 'quote_id'"; }
quote "$F06" 3000 >/dev/null; quote "$F06" 4000 >/dev/null
ITEMS='[{"meal_id":"00000000-0000-0000-0000-00000000aa03","quantity":1}]'
for k in 1 2; do
  (as_user "$F06" "select public.create_order('$KA', '$ITEMS'::jsonb, gen_random_uuid(), null, null, 35), pg_sleep(0.2)" >"$OUT/first-$k.out" 2>&1) &
done; wait
made="$(qa "select count(*) from public.orders where user_id = '$F06'")"
free="$(qa "select count(*) from public.orders where user_id = '$F06' and total = 35 and platform_service_fee = 0 and delivery_fee = 0")"
[ "$made" = "1" ] && [ "$free" = "1" ] && pass "two first orders of one account in parallel: one created without fees, the other refused (no second free order)" \
  || { fail "parallel first orders: orders=$made free=$free"; cat "$OUT"/first-*.out | sed 's/^/    /'; }
quote "$F06" 3000 >/dev/null
TOTAL="$(qa "select (public.checkout_price('$F06', '$KA', '$ITEMS'::jsonb, null, false) ->> 'total')")"
REQ=44444444-4444-4444-4444-444444444444
for k in 1 2 3 4; do
  (as_user "$F06" "select public.create_order('$KA', '$ITEMS'::jsonb, '$REQ', null, null, $TOTAL), pg_sleep(0.2)" >"$OUT/same-$k.out" 2>&1) &
done; wait
ids="$(cat "$OUT"/same-*.out | grep -E '^[0-9a-f-]{36}' | cut -d'|' -f1 | sort -u | wc -l)"
n="$(qa "select count(*) from public.orders where client_request_id = '$REQ'")"
[ "$ids" = "1" ] && [ "$n" = "1" ] && [ "$TOTAL" = "51.00" ] && pass "4 parallel identical requests: one order (35 + 3 + 13 at 3 km = 51), the same id returned to all" \
  || { fail "parallel identical requests: ids=$ids orders=$n total=$TOTAL"; cat "$OUT"/same-*.out | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the races" || fail "violations after the races"

echo "=== 6. regression on fresh databases"
start_db oreg
full
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (order workflow regression db)"
q postgres -f "$O_TESTS" >"$OUT/otests.out" 2>&1 || fail "order workflow test file error: $(tail -3 "$OUT/otests.out")"
of="$(qa "select count(*) from otests.results where not passed")"; op="$(qa "select count(*) from otests.results")"
[ "$of" = "0" ] && [ "$op" -ge 66 ] && pass "order workflow SQL tests (cashier, kitchen, driver, payment): $op run, all pass" \
  || { fail "order workflow SQL tests: $of fail"; qa "select id || ' ' || coalesce(detail,'') from otests.results where not passed" | sed 's/^/    /'; }
start_db areg
full
q supabase_admin -c "insert into public.staff_roles (user_id, role) values ('00000000-0000-0000-0000-000000000f05', 'support')" >/dev/null
q postgres -f "$MIG" >/dev/null 2>&1 || fail "migration (account-deletion regression db)"
q postgres -f "$A_TESTS" >"$OUT/atests.out" 2>&1 || fail "account deletion test file error: $(tail -3 "$OUT/atests.out")"
af="$(qa "select count(*) from dtests.results where not passed")"; ap="$(qa "select count(*) from dtests.results")"
[ "$af" = "0" ] && [ "$ap" -ge 10 ] && pass "account deletion SQL tests: $ap run, all pass" \
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
# Changed on purpose by the owner decision "one active staff role per user"
# (order workflow migration; see run_v1_order_workflow.sh).
P1C_CHANGED="'T13a','T16'"
p1f="$(qa "select count(*) from tests.results where not passed and id not in ($P1C_CHANGED)")"; p1p="$(qa "select count(*) from tests.results where passed")"
[ "$p1f" = "0" ] && pass "Phase 1C SQL security tests: $p1p pass, 0 unexpected fail (changed on purpose: $P1C_CHANGED)" \
  || { fail "Phase 1C SQL tests: $p1f fail"; qa "select id || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the Phase 1C tests" || fail "violations after Phase 1C tests"

echo "=== 7. rollback"
start_db rollback
full
q postgres -f "$MIG" >/dev/null 2>&1
q postgres -f "$TESTS" >/dev/null 2>&1   # orders, codes, choices, verified phones
totals="$(qa "select string_agg(id::text || ':' || total, ',' order by id) from public.orders where workflow_version is not null")"
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(monitor_md5)" = "$ZONES_MD5" ] && pass "pricing-engine monitor restored (fc876c08…)" || fail "monitor not restored"
  [ "$(qa "select to_regclass('public.meal_option_groups') is null and to_regclass('public.phone_verifications') is null
            and to_regprocedure('public.create_order(uuid,jsonb,uuid,text)') is not null
            and to_regprocedure('public.checkout_preview(uuid,jsonb,text)') is null")" = "t" ] \
    && pass "checkout objects removed; create_order() is the pricing-engine version" || fail "objects still present"
  [ "$(qa "select string_agg(id::text || ':' || total, ',' order by id) from public.orders where workflow_version is not null")" = "$totals" ] \
    && [ "$(qa "select count(*) from v1_checkout_experience_rollback_archive.promotions")" -ge 7 ] \
    && [ "$(qa "select count(*) from v1_checkout_experience_rollback_archive.verified_phones")" -ge 3 ] \
    && pass "orders kept with their totals; codes, choices, phones and snapshot columns archived" || fail "orders or archive wrong"
  [ "$(violations)" = "0" ] && pass "containment_violations() = 0 after rollback" || fail "violations after rollback"
  q postgres -f "$RB_P" >"$OUT/rbp.log" 2>&1 && q postgres -f "$RB_Z" >"$OUT/rbz.log" 2>&1 \
    && pass "the pricing engine and delivery zones rollbacks still run after it" || fail "older rollbacks: $(tail -2 "$OUT/rbp.log") $(tail -2 "$OUT/rbz.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi
start_db reapply
full
q postgres -f "$MIG" >/dev/null 2>&1 && q postgres -f "$RB" >/dev/null 2>&1 \
  && q postgres -c "set client_min_messages = warning; drop schema v1_checkout_experience_rollback_archive cascade" >/dev/null \
  && q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && [ "$(violations)" = "0" ] \
  && pass "migration, rollback, migration again on a fresh chain" || fail "re-apply: $(tail -2 "$OUT/reapply.log")"

echo
[ "$STATUS" = "0" ] && echo "ALL V1 CHECKOUT EXPERIENCE CHECKS PASSED" || echo "V1 CHECKOUT EXPERIENCE CHECKS FAILED"
exit "$STATUS"
