#!/usr/bin/env bash
# =====================================================================
# Test harness for 20261028120000_v1_onboarding_first_order_offer.sql.
# LOCAL, DISPOSABLE databases only: starts a throw-away container of the
# Supabase Postgres image (same image as the Phase 1C harness) and removes
# it on exit. It takes no connection string, so it cannot be pointed at a
# remote database.
#
# Requires: docker, psql.   Usage: supabase/tests/run_v1_onboarding_offer.sh
#
#   1  refusals: without Phase 1C, as a wrong role, and with a forced
#      postcondition failure under ON_ERROR_ROLLBACK=on, nothing is applied
#   2  migration on top of baseline + fixtures + Phase 1C core
#   3  SQL tests (nutrition, onboarding, address, offer visibility,
#      authorization, enforcement) — v1_onboarding_offer_tests.sql
#   4  Phase 1C SQL security tests still pass after this migration, and
#      containment_violations() reports zero drift/containment rows
#   5  concurrency: parallel checkouts of one account (READ COMMITTED and
#      REPEATABLE READ) apply the offer at most once
#   6  re-running the migration is refused and changes nothing
#   7  rollback archives data, removes every object, keeps containment at
#      zero; the migration applies again afterwards
# Exit 0 only if every check passes.
# =====================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
BASE="$ROOT/supabase/baseline/staging_schema_2026-10-15.sql"
MIG_1C="$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql"
MIG="$ROOT/supabase/migrations/20261028120000_v1_onboarding_first_order_offer.sql"
RB="$ROOT/supabase/rollback/v1_onboarding_offer_rollback.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/v1_onboarding_offer_tests.sql"; P1C_TESTS="$HERE/phase1c_security_tests.sql"
OUT="$(mktemp -d /tmp/v1-offer-run.XXXXXX)"
INITIAL_ADMIN=00000000-0000-0000-0000-0000000000a1
CONTAINERS=()
STATUS=0
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
  DBNAME="v1offer-$1-$$"
  docker rm -f "$DBNAME" >/dev/null 2>&1 || true
  docker run -d --name "$DBNAME" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  CONTAINERS+=("$DBNAME")
  PORT="$(docker port "$DBNAME" 5432/tcp | head -1 | sed 's/.*://')"
  local ok=0
  for _ in $(seq 1 90); do
    if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
      ok=$((ok + 1)); [ "$ok" -ge 3 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 3 ] || { echo "database $DBNAME did not start"; exit 2; }
}
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
mig_1c() {  # Phase 1C core with the fixture admin (same substitution as run_phase1c.sh)
  sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" "$MIG_1C" > "$OUT/p1c.sql"
  [ "$(diff "$MIG_1C" "$OUT/p1c.sql" | grep -c '^[<>]')" = "2" ] || { echo "expected exactly one changed line"; exit 2; }
  q postgres -f "$OUT/p1c.sql" >"$OUT/p1c.log" 2>&1
}
setup() {
  q supabase_admin -f "$BOOT" >/dev/null
  q postgres -f "$BASE" >/dev/null 2>&1
  q supabase_admin -f "$FIX" >/dev/null
  q supabase_admin -c "insert into auth.users (id, confirmed_at) values
    ('00000000-0000-0000-0000-0000000e1001', now()), ('00000000-0000-0000-0000-0000000e1002', now()),
    ('00000000-0000-0000-0000-0000000e1003', now()), ('00000000-0000-0000-0000-0000000e1004', now()),
    ('00000000-0000-0000-0000-0000000e1c01', now())" >/dev/null
  q postgres -c "insert into public.user_profiles (user_id, role, is_admin) values
    ('00000000-0000-0000-0000-0000000e1001', 'customer', false), ('00000000-0000-0000-0000-0000000e1003', 'customer', false),
    ('00000000-0000-0000-0000-0000000e1c01', 'customer', false);
    insert into public.user_profiles (user_id, role, is_admin, gender, age, weight, height, activity_level, goal)
    values ('00000000-0000-0000-0000-0000000e1004', 'customer', false, 'woman', 34, 80, 168, 'light', 'maintain')" >/dev/null
}
digest() {
  qa "select md5(string_agg(x, '|' order by x)) from (
        select 'c:' || table_name || '.' || column_name || ':' || data_type from information_schema.columns where table_schema = 'public'
        union all select 'f:' || p.oid::regprocedure::text || md5(p.prosrc) from pg_proc p where p.pronamespace = 'public'::regnamespace
        union all select 't:' || tgrelid::regclass::text || '.' || tgname from pg_trigger where not tgisinternal
        union all select 'r:' || c.relname from pg_class c where c.relnamespace = 'public'::regnamespace
        union all select 'p:' || to_jsonb(p)::text from public.user_profiles p
        union all select 'o:' || to_jsonb(o)::text from public.orders o) s(x)"
}
violations() { qa "select count(*) from public.containment_violations() where category in ('drift','containment')"; }

echo "=== 1. refusals"
start_db refuse
setup
before="$(digest)"
if q postgres -f "$MIG" >"$OUT/no1c.log" 2>&1; then fail "applied without Phase 1C"; else
  grep -q "Phase 1C core migration (20261016170000) is not applied" "$OUT/no1c.log" && [ "$(digest)" = "$before" ] \
    && pass "refused without Phase 1C; database unchanged" || fail "unexpected refusal without Phase 1C: $(tail -2 "$OUT/no1c.log")"
fi
mig_1c || { fail "Phase 1C core migration failed: $(tail -3 "$OUT/p1c.log")"; exit 1; }
before="$(digest)"
if q supabase_admin -f "$MIG" >"$OUT/role.log" 2>&1; then fail "applied as supabase_admin"; else
  grep -q "must run as role postgres" "$OUT/role.log" && [ "$(digest)" = "$before" ] \
    && pass "refused as a role other than postgres; database unchanged" || fail "wrong-role refusal: $(tail -2 "$OUT/role.log")"
fi
# Forced postcondition failure: a client-visible policy appears during the
# run. Under ON_ERROR_ROLLBACK=on psql keeps going after the failed
# statement; the deferred gate must still refuse the COMMIT.
sed 's/^-- 8. Postcondition:/create policy v1_rogue on public.promotions for select to authenticated using (true);\ngrant select on public.promotions to authenticated;\n-- 8. Postcondition:/' "$MIG" > "$OUT/rogue.sql"
grep -q "v1_rogue" "$OUT/rogue.sql" || { echo "mutation not inserted"; exit 2; }
psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_ROLLBACK=on -f "$OUT/rogue.sql" >"$OUT/rogue.log" 2>&1
if [ "$(digest)" = "$before" ] && [ "$(qa "select to_regclass('public.promotions') is null")" = "t" ]; then
  pass "postcondition failure under ON_ERROR_ROLLBACK=on: COMMIT refused by the gate; nothing applied"
else fail "a failing postcondition still committed changes"; fi

echo "=== 2. migration"
if q postgres -f "$MIG" >"$OUT/mig.log" 2>&1; then pass "migration applied (precondition + postcondition passed)"; else
  fail "migration failed: $(tail -3 "$OUT/mig.log")"; exit 1; fi

echo "=== 3. SQL tests"
q postgres -f "$TESTS" >"$OUT/tests.out" 2>&1 || fail "test file error: $(tail -3 "$OUT/tests.out")"
qa "select id || ' ' || case when passed then 'PASS' else 'FAIL' end || ' ' || expectation || ' [' || coalesce(detail, '') || ']' from v1tests.results order by id" | sed 's/^/  /'
nf="$(qa "select count(*) from v1tests.results where not passed")"; np="$(qa "select count(*) from v1tests.results where passed")"
[ "$nf" = "0" ] && [ "$np" -ge 25 ] && pass "$np SQL tests passed" || fail "$nf SQL test(s) failed ($np passed)"

echo "=== 4. Phase 1C regression after this migration"
q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests.out" 2>&1 || fail "Phase 1C test file error: $(tail -3 "$OUT/p1c_tests.out")"
p1c_fail="$(qa "select count(*) from tests.results where not passed")"; p1c_pass="$(qa "select count(*) from tests.results where passed")"
[ "$p1c_fail" = "0" ] && pass "Phase 1C SQL security tests: $p1c_pass pass / 0 fail" \
  || { fail "Phase 1C SQL security tests: $p1c_fail fail"; qa "select id || ' ' || expectation || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
v="$(violations)"; [ "$v" = "0" ] && pass "containment_violations(): 0 drift/containment rows" \
  || { fail "containment_violations(): $v rows"; qa "select category || ' ' || object || ' ' || problem from public.containment_violations() where category in ('drift','containment')" | sed 's/^/    /'; }

echo "=== 5. concurrency"
checkout_sql() {  # $1 isolation level, $2 order number, $3 user: one checkout transaction
  echo "begin isolation level $1;
       insert into public.orders (order_number, total, subtotal, delivery_fee, status, payment_method, user_id)
       values ('$2', 75, 60, 15, 'confirmed', 'cash', '$3');
       select pg_sleep(0.3);
       select 'discount=' || public.apply_first_order_offer((select id from public.orders where order_number = '$2'));
       select pg_sleep(0.5);
       commit;"
}
concurrent_case() {  # $1 isolation level, $2 tag
  local u=00000000-0000-0000-0000-0000000e1c01 k
  q postgres -c "delete from public.promotion_redemptions where user_id = '$u'; delete from public.orders where user_id = '$u'" >/dev/null
  for k in 1 2 3; do
    (q postgres -At -c "$(checkout_sql "$1" "C-$2-$k" "$u")" >"$OUT/conc-$2-$k.out" 2>&1; echo $? >"$OUT/conc-$2-$k.rc") &
  done
  wait
  local applied discounted committed failed_other=0 retried=0
  # A transaction that lost a race may only fail with a serialization
  # failure (SQLSTATE 40001, retryable); retry it the way a client would.
  for k in 1 2 3; do
    if [ "$(cat "$OUT/conc-$2-$k.rc")" != "0" ]; then
      if grep -q "could not serialize access" "$OUT/conc-$2-$k.out"; then
        q postgres -At -c "$(checkout_sql "read committed" "C-$2-$k" "$u")" >>"$OUT/conc-$2-$k.out" 2>&1 && retried=$((retried + 1))
      else failed_other=$((failed_other + 1)); fi
    fi
  done
  applied="$(qa "select count(*) from public.promotion_redemptions where user_id = '$u' and status = 'applied'")"
  discounted="$(qa "select count(*) from public.orders where user_id = '$u' and delivery_discount > 0")"
  committed="$(qa "select count(*) from public.orders where user_id = '$u'")"
  if [ "$applied" = "1" ] && [ "$discounted" = "1" ] && [ "$committed" = "3" ] && [ "$failed_other" = "0" ]; then
    pass "$1: 3 parallel checkouts of one account ($retried retried after SQLSTATE 40001); exactly 1 has free delivery (1 redemption)"
  else
    fail "$1: applied=$applied discounted=$discounted committed=$committed other_failures=$failed_other"; cat "$OUT"/conc-$2-*.out | sed 's/^/    /'
  fi
}
concurrent_case "read committed" rc
concurrent_case "repeatable read" rr

echo "=== 6. re-run"
before="$(digest)"
if q postgres -f "$MIG" >"$OUT/rerun.log" 2>&1; then fail "re-run applied"; else
  grep -q "objects already exist" "$OUT/rerun.log" && [ "$(digest)" = "$before" ] \
    && pass "re-run refused; database unchanged" || fail "re-run: $(tail -2 "$OUT/rerun.log")"
fi

echo "=== 7. rollback (fresh database: Phase 1C tests are run once per database, as in run_phase1c.sh)"
start_db rollback
setup
mig_1c || { fail "Phase 1C core migration failed: $(tail -3 "$OUT/p1c.log")"; exit 1; }
q postgres -f "$MIG" >"$OUT/mig_rb.log" 2>&1 || { fail "migration failed: $(tail -3 "$OUT/mig_rb.log")"; exit 1; }
q postgres -f "$TESTS" >"$OUT/tests_rb.out" 2>&1   # creates profiles, orders and redemptions to archive
profiles_before="$(qa "select count(*) from public.user_profiles")"
redemptions_before="$(qa "select count(*) from public.promotion_redemptions")"
if q postgres -f "$RB" >"$OUT/rb.log" 2>&1; then
  pass "rollback committed"
  [ "$(qa "select count(*) from v1_onboarding_rollback_archive.user_profiles_v1")" = "$profiles_before" ] \
    && [ "$(qa "select count(*) from v1_onboarding_rollback_archive.promotion_redemptions")" = "$redemptions_before" ] \
    && pass "archive holds every profile row ($profiles_before) and redemption ($redemptions_before)" || fail "archive incomplete"
  [ "$(qa "select has_table_privilege('authenticated', 'v1_onboarding_rollback_archive.promotion_redemptions', 'SELECT')
             or has_table_privilege('service_role', 'v1_onboarding_rollback_archive.user_profiles_v1', 'SELECT')")" = "f" ] \
    && pass "archive not readable by client roles or service_role" || fail "archive readable"
  [ "$(qa "select to_regclass('public.promotions') is null and to_regprocedure('public.estimate_energy(text,integer,numeric,numeric,text)') is null
             and not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in
               ('bmr_kcal','onboarding_completed_at','first_order_offer_status','delivery_discount'))
             and not exists (select 1 from pg_trigger where tgname like 'trg_first_order_offer%' or tgname = 'trg_user_profiles_v1_derive')")" = "t" ] \
    && pass "every object of the migration removed" || fail "objects remain after rollback"
  v="$(violations)"; [ "$v" = "0" ] && pass "containment_violations() after rollback: 0" || fail "containment after rollback: $v"
  q postgres -f "$P1C_TESTS" >"$OUT/p1c_tests_rb.out" 2>&1
  [ "$(qa "select count(*) from tests.results where not passed")" = "0" ] && pass "Phase 1C SQL security tests pass after rollback" \
    || { fail "Phase 1C SQL tests fail after rollback"; qa "select id || ' ' || expectation || ' ' || coalesce(detail,'') from tests.results where not passed" | sed 's/^/    /'; }
  q postgres -c "drop schema v1_onboarding_rollback_archive cascade" >/dev/null 2>&1
  q postgres -f "$MIG" >"$OUT/reapply.log" 2>&1 && pass "migration applies again after rollback" || fail "re-apply after rollback: $(tail -2 "$OUT/reapply.log")"
else
  fail "rollback failed: $(tail -3 "$OUT/rb.log")"
fi

echo
[ "$STATUS" = "0" ] && echo "RESULT: ALL V1 ONBOARDING/OFFER LOCAL CHECKS PASSED" || echo "RESULT: FAILURES (see above)"
exit "$STATUS"
