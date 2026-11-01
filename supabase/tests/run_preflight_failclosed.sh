#!/usr/bin/env bash
# =====================================================================
# Fast regression tests for the READ-ONLY verification scripts
# (preflight_staging_readonly.sql, verify_initial_admin_readonly.sql and
# the three postdeploy_verify_*_readonly.sql files). Disposable local
# container only. ~1 minute. The same preflight injections also run as
# guards P1-P7 inside run_phase1c.sh.
#
# Each case injects one state, asserts that the named check is FALSE (not
# NULL, not missing) and that all_required_checks_ok is false, reverts it,
# and asserts the check is TRUE again. A case that cannot make the check
# fail is a fail-open bug.
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
BASE="$ROOT/supabase/baseline/staging_schema_2026-10-15.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
PREFLIGHT="${PREFLIGHT_FILE:-$HERE/preflight_staging_readonly.sql}"   # override only to show the old file fails open
NAME="pf-failclosed-$$"; OUT="$(mktemp -d)"; STATUS=0; NPASS=0; NFAIL=0
export PGPASSWORD=postgres
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$OUT"; }
trap cleanup EXIT
pass() { echo "  pass: $*"; NPASS=$((NPASS + 1)); }
fail() { echo "  FAIL: $*"; NFAIL=$((NFAIL + 1)); STATUS=1; }

docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
PORT="$(docker port "$NAME" 5432/tcp | head -1 | sed 's/.*://')"
ok=0
for _ in $(seq 1 90); do
  if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
    ok=$((ok + 1)); [ "$ok" -ge 3 ] && break
  else ok=0; fi
  sleep 1
done
[ "$ok" -ge 3 ] || { echo "database did not start"; exit 2; }
q() { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
q supabase_admin -f "$BOOT" >/dev/null
q postgres -f "$BASE" >/dev/null 2>&1
q supabase_admin -f "$FIX" >/dev/null

# check FILE NAME -> prints "<check ok> <all ok>" (MISSING / ERROR)
check() {
  q postgres -At -f "$1" > "$OUT/r.json" 2>"$OUT/r.err" || { echo ERROR; return; }
  python3 -I - "$OUT/r.json" "$2" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); rows = [c for c in d["checks"] if c["check"] == sys.argv[2]]
print("MISSING" if not rows else f'{rows[0]["ok"]} {d["all_required_checks_ok"]}')
PY
}
# case NAME CHECK "inject" "revert"   (preflight; storage checks are not part of this database)
case_pf() {
  local name="$1" chk="$2" inject="$3" revert="$4" r
  [ "$(check "$PREFLIGHT" "$chk" | cut -d' ' -f1)" = "True" ] || { fail "$name: '$chk' not ok before injection"; return; }
  q supabase_admin -c "$inject" >/dev/null
  r="$(check "$PREFLIGHT" "$chk")"
  [ "$r" = "False False" ] && pass "$name: '$chk' fails closed and the overall result is false" \
                           || fail "$name: expected 'False False', got '$r'"
  q supabase_admin -c "$revert" >/dev/null
  [ "$(check "$PREFLIGHT" "$chk" | cut -d' ' -f1)" = "True" ] && pass "$name: '$chk' passes again after revert" \
                                                       || fail "$name: '$chk' still failing after revert"
}

echo "=== preflight fail-closed regressions"
COT="public.create_order_transaction(text, uuid, jsonb, numeric, text, text)"
SAVED="public.create_order_transaction_saved(text, uuid, jsonb, numeric, text, text)"
case_pf missing_function create_order_transaction_signature \
  "alter function $COT rename to create_order_transaction_saved" \
  "alter function $SAVED rename to create_order_transaction"
case_pf wrong_signature create_order_transaction_signature \
  "alter function $COT rename to create_order_transaction_saved; create function public.create_order_transaction(p_order_number text, p_kiosk_id uuid, p_items jsonb, p_total numeric, p_language text) returns void language sql as ''" \
  "drop function public.create_order_transaction(text, uuid, jsonb, numeric, text); alter function $SAVED rename to create_order_transaction"
case_pf wrong_argument_names create_order_transaction_signature \
  "alter function $COT rename to create_order_transaction_saved; create function public.create_order_transaction(order_number text, p_kiosk_id uuid, p_items jsonb, p_total numeric, p_language text, p_tracking_token text) returns void language sql as ''" \
  "drop function $COT; alter function $SAVED rename to create_order_transaction"
case_pf unexpected_overload create_order_transaction_signature \
  "create function public.create_order_transaction(p_order_number text) returns void language sql as ''" \
  "drop function public.create_order_transaction(text)"
case_pf second_match_other_schema create_order_transaction_signature \
  "create schema pf_guard; create function pf_guard.create_order_transaction(p_order_number text, p_kiosk_id uuid, p_items jsonb, p_total numeric, p_language text, p_tracking_token text) returns void language sql as ''" \
  "drop schema pf_guard cascade"
case_pf table_renamed_same_count public_table_set_matches_evidence \
  "alter table public.bank_accounts rename to bank_accounts_renamed" \
  "alter table public.bank_accounts_renamed rename to bank_accounts"
case_pf table_missing public_table_set_matches_evidence \
  "create schema pf_guard; alter table public.bank_accounts set schema pf_guard" \
  "alter table pf_guard.bank_accounts set schema public; drop schema pf_guard"
case_pf table_unexpected public_table_set_matches_evidence \
  "create table public.pf_guard_extra (id int)" \
  "drop table public.pf_guard_extra"
case_pf auth_admin_role_missing U3_no_auth_hook_functions \
  "alter role supabase_auth_admin rename to supabase_auth_admin_saved" \
  "alter role supabase_auth_admin_saved rename to supabase_auth_admin"

echo "=== NULL never counts as a pass"
# A check whose expression is NULL must be reported as false, per check and overall.
sed "s/select 'server_version_17', current_setting('server_version_num')::int >= 170000,/select 'server_version_17', null::boolean,/" "$PREFLIGHT" > "$OUT/null_preflight.sql"
grep -q "null::boolean" "$OUT/null_preflight.sql" || fail "could not build the NULL variant"
r="$(check "$OUT/null_preflight.sql" server_version_17)"
[ "$r" = "False False" ] && pass "a NULL check result is reported as false and fails the run" || fail "NULL check: got '$r'"

echo "=== initial-admin verification fails closed"
r="$(check "$HERE/verify_initial_admin_readonly.sql" user_exists)"
[ "$r" = "False False" ] && pass "placeholder id: user_exists false, overall false" || fail "placeholder: got '$r'"
sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID'::text as v/'11111111-1111-1111-1111-111111111111'::text as v/" "$HERE/verify_initial_admin_readonly.sql" > "$OUT/va.sql"
r="$(check "$OUT/va.sql" email_confirmed)"
[ "$r" = "False False" ] && pass "unknown id: email_confirmed false (not NULL), overall false" || fail "unknown id: got '$r'"

echo "=== post-deployment checks fail closed before deployment"
for f in postdeploy_verify_readonly postdeploy_verify_nutrition_readonly postdeploy_verify_activity_readonly; do
  r="$(q postgres -At -f "$HERE/$f.sql" 2>/dev/null | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["all_required_checks_ok"])' 2>/dev/null || echo ERROR)"
  # ERROR (the script stops on a missing object) and False are both closed; True is open.
  [ "$r" != "True" ] && pass "$f on an undeployed database: not ok ($r)" || fail "$f passed on an undeployed database"
done

echo "=== read-only: the scripts change nothing"
before="$(q postgres -At -c "select md5(string_agg(x, ',' order by x)) from (select oid::regprocedure::text || md5(prosrc) x from pg_proc where pronamespace = 'public'::regnamespace union all select relname || relacl::text from pg_class where relnamespace = 'public'::regnamespace) s")"
for f in "$PREFLIGHT" "$HERE/verify_initial_admin_readonly.sql"; do
  q postgres -At -c "begin read only" -f "$f" -c "commit" >/dev/null 2>"$OUT/ro.err" && pass "$(basename "$f") runs inside a READ ONLY transaction" \
    || { fail "$(basename "$f") is not read-only"; cat "$OUT/ro.err"; }
done
after="$(q postgres -At -c "select md5(string_agg(x, ',' order by x)) from (select oid::regprocedure::text || md5(prosrc) x from pg_proc where pronamespace = 'public'::regnamespace union all select relname || relacl::text from pg_class where relnamespace = 'public'::regnamespace) s")"
[ "$before" = "$after" ] && pass "catalog digest unchanged" || fail "catalog digest changed"

echo "preflight fail-closed: $NPASS pass / $NFAIL fail"
exit "$STATUS"
