#!/usr/bin/env bash
# =====================================================================
# Test harness for the cashier order management workflow (Milestone 2).
# No migration of its own: the cashier screens use the existing policies
# (orders_cashier_read, staff_admin_all_orders, order_items/
# order_status_updates read with the order) and the workflow functions
# (order_confirm, order_cancel) of 20261105 + 20261110.
# LOCAL, DISPOSABLE databases only (Supabase Postgres image in Docker); it
# takes no connection string. Containers are removed on exit.
#
#   1  the app's column lists (src/services/cashierApi.ts) are loaded so the
#      SQL tests run the app's own reads
#   2  full V1 chain + lifecycle hardening; monitor unchanged; 0 violations
#   3  SQL tests — v1_cashier_orders_tests.sql (queue and detail per role,
#      customer isolation, confirm, duplicate, cancel with/without reason,
#      payment stays pending, direct-write bypass, revoked cashier, realtime)
#   4  concurrency: cashier + admin confirm at once; confirm races the
#      customer's cancellation; cashier cancel races admin confirm; 5 taps
# Regressions (order workflow, lifecycle, checkout, account deletion,
# standalone, Phase 1C): run_v1_order_lifecycle.sh, unchanged by this work.
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
K_TESTS="$HERE/v1_cashier_orders_tests.sql"; TESTS="$HERE/v1_order_lifecycle_tests.sql"; X_TESTS="$HERE/v1_checkout_experience_tests.sql"; O_TESTS="$HERE/v1_order_workflow_tests.sql"; S_TESTS="$HERE/v1_standalone_tests.sql"; A_TESTS="$HERE/v1_account_deletion_tests.sql"
P1C_TESTS="$HERE/phase1c_security_tests.sql"
STANDALONE_MD5=1b29b6a009a2f466bd0a12b4e460780c
ACCOUNT_MD5=8c902c66f5fac9b355d28b67c4c03250
ORDER_MD5=be70f09b095844cf186059ed347cae04
CREATE_MD5=b40dfd53391a3b70942cfa91bb03236d
ZONES_MD5=fc876c0897b2e23a59fe2cfecfcd3ad7
CHECKOUT_MD5=39523bf8d3b37e19078633046313f8eb
OUT="$(mktemp -d /tmp/v1-cashier-run.XXXXXX)"
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
  DBNAME="v1k-$1-$$"
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

echo "=== 1. the app's reads"
python3 -I - "$ROOT/src/services/cashierApi.ts" > "$OUT/app_columns.sql" <<'PY' || { echo "could not read the app's column lists"; exit 2; }
import re, sys
src = open(sys.argv[1], encoding="utf-8").read()
names = {"queue": "CASHIER_QUEUE_COLUMNS", "order": "CASHIER_ORDER_COLUMNS", "items": "CASHIER_ITEM_COLUMNS", "timeline": "CASHIER_TIMELINE_COLUMNS"}
print("create schema if not exists ktests; create table if not exists ktests.app_columns (name text primary key, cols text not null); truncate ktests.app_columns;")
for key, const in names.items():
    m = re.search(r"export const " + const + r"\s*=\s*((?:\s*'[^']*'\s*\+?)+);", src)
    if not m: sys.exit("missing " + const)
    cols = "".join(re.findall(r"'([^']*)'", m.group(1)))
    if not re.fullmatch(r"[a-z_, ]+", cols): sys.exit("unexpected characters in " + const)
    print("insert into ktests.app_columns values ('%s', '%s');" % (key, cols))
PY
grep -c "insert into ktests.app_columns" "$OUT/app_columns.sql" | grep -qx 4 && pass "4 column lists read from src/services/cashierApi.ts" || fail "column lists"
grep -Eq "user_id|client_request_id" "$OUT/app_columns.sql" && fail "the cashier reads ask for account identifiers" || pass "no account identifiers (user_id, client_request_id) in the cashier reads"

echo "=== 2. full chain"
start_db main
full
q postgres -f "$MIG" >"$OUT/mig.log" 2>&1 && pass "V1 chain + lifecycle hardening applied" || { fail "hardening: $(tail -3 "$OUT/mig.log")"; exit 1; }
q supabase_admin -c "insert into auth.users (id, confirmed_at) values ('00000000-0000-0000-0000-00000000e0c3', now()) on conflict do nothing" >/dev/null
[ "$(monitor_md5)" = "$CHECKOUT_MD5" ] && pass "monitor unchanged ($CHECKOUT_MD5): no policy or function added" || fail "monitor md5 $(monitor_md5)"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0" || fail "containment violations: $(violations)"

echo "=== 3. SQL tests"
q postgres -f "$OUT/app_columns.sql" >/dev/null
q postgres -f "$K_TESTS" >"$OUT/ktests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/ktests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(left(detail, 140), '') || ']' from ktests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from ktests.results where not passed")"; np="$(qa "select count(*) from ktests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 19 ] && pass "$np SQL tests passed" || fail "$nf failed, $np passed"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the tests" || fail "violations after the tests"

echo "=== 4. concurrency"
C1=00000000-0000-0000-0000-00000000e0c1; F02=00000000-0000-0000-0000-000000000f02
audits() { qa "select count(*) from public.security_audit_log where action = '$2' and details ->> 'order_id' = '$1'"; }
O="$(mk_order pending)"
for who in "$C1" "$INITIAL_ADMIN"; do
  (as_user "$who" "select public.order_confirm('$O'), pg_sleep(0.3)" >"$OUT/conf-$who.out" 2>&1) &
done; wait
ch="$(cat "$OUT"/conf-*.out | grep -c '^changed')"; un="$(cat "$OUT"/conf-*.out | grep -c '^unchanged')"
[ "$ch" = "1" ] && [ "$un" = "1" ] && [ "$(audits "$O" order_confirmed)" = "1" ] \
  && [ "$(qa "select payment_status from public.orders where id = '$O'")" = "pending" ] \
  && pass "cashier and admin confirm at once: one change, one 'unchanged', one audit row, payment still pending" \
  || { fail "parallel confirm: changed=$ch unchanged=$un"; cat "$OUT"/conf-*.out | sed 's/^/    /'; }
O="$(mk_order pending)"
(as_user "$C1" "select public.order_confirm('$O'), pg_sleep(0.3)" >"$OUT/rc-confirm.out" 2>&1) &
(as_user "$F02" "select public.order_cancel('$O', null), pg_sleep(0.3)" >"$OUT/rc-cancel.out" 2>&1) &
wait
st="$(qa "select status from public.orders where id = '$O'")"; wins="$(cat "$OUT"/rc-*.out | grep -c '^changed')"
tl="$(qa "select count(*) from public.order_status_updates where order_id = '$O' and status <> 'pending'")"
{ [ "$st" = "confirmed" ] || [ "$st" = "cancelled" ]; } && [ "$wins" = "1" ] && [ "$tl" = "1" ] \
  && pass "cashier confirmation races the customer's cancellation: exactly one wins ($st), one timeline row" \
  || { fail "race: status=$st wins=$wins timeline=$tl"; cat "$OUT"/rc-*.out | sed 's/^/    /'; }
O="$(mk_order pending)"
(as_user "$C1" "select public.order_cancel('$O', 'Plat indisponible'), pg_sleep(0.3)" >"$OUT/rx-cancel.out" 2>&1) &
(as_user "$INITIAL_ADMIN" "select public.order_confirm('$O'), pg_sleep(0.3)" >"$OUT/rx-confirm.out" 2>&1) &
wait
st="$(qa "select status from public.orders where id = '$O'")"; wins="$(cat "$OUT"/rx-*.out | grep -c '^changed')"
tl="$(qa "select count(*) from public.order_status_updates where order_id = '$O' and status <> 'pending'")"
au="$(qa "select count(*) from public.security_audit_log where details ->> 'order_id' = '$O' and action in ('order_confirmed','order_cancelled')")"
refused="$(cat "$OUT"/rx-confirm.out | grep -c 'invalid order transition cancelled -> confirmed')"
# Both orders are legal: confirm then cancel (staff cancel until ready) = 2 changes;
# cancel first = the confirmation is refused. Either way the order ends cancelled,
# with one timeline and one audit row per change.
[ "$st" = "cancelled" ] && [ "$tl" = "$wins" ] && [ "$au" = "$wins" ] && { [ "$wins" = "2" ] || { [ "$wins" = "1" ] && [ "$refused" = "1" ]; }; } \
  && pass "cashier cancellation races an admin confirmation: serialized ($wins change(s)), ends cancelled, one timeline and audit row per change" \
  || { fail "race: status=$st wins=$wins timeline=$tl audits=$au refused=$refused"; cat "$OUT"/rx-*.out | sed 's/^/    /'; }
O="$(mk_order pending)"
for k in 1 2 3 4 5; do (as_user "$C1" "select public.order_confirm('$O'), pg_sleep(0.2)" >"$OUT/tap-$k.out" 2>&1) & done; wait
ch="$(cat "$OUT"/tap-*.out | grep -c '^changed')"; un="$(cat "$OUT"/tap-*.out | grep -c '^unchanged')"
[ "$ch" = "1" ] && [ "$un" = "4" ] && [ "$(audits "$O" order_confirmed)" = "1" ] \
  && [ "$(qa "select count(*) from public.order_status_updates where order_id = '$O' and status = 'confirmed'")" = "1" ] \
  && pass "5 parallel confirmations by one cashier (repeated taps): one change, 4 'unchanged', one audit and one timeline row" \
  || fail "taps: changed=$ch unchanged=$un"
[ "$(violations)" = "0" ] && pass "containment_violations() = 0 after the races" || fail "violations after the races"

echo
[ "$STATUS" = "0" ] && echo "ALL V1 CASHIER ORDER CHECKS PASSED" || echo "V1 CASHIER ORDER CHECKS FAILED"
exit "$STATUS"
