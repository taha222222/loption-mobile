#!/usr/bin/env bash
# =====================================================================
# Phase 1C mutation tests (review 2026-10-26). LOCAL, DISPOSABLE containers
# only. Each case applies the core migration (test copy with the fixture
# admin a1) to a fresh database, then deliberately weakens ONE control
# after the migration and runs the test that is supposed to catch it.
# "detected" = that test now fails, as it must. "SURVIVED" = the weakening
# went unnoticed, which fails this script. m0 is the unmodified control:
# every detector must pass on it.
#
# The weakenings are applied as plain DDL after the migration, so the
# monitor's function fingerprints are deliberately not what is tested here
# (they would flag most of these changes on their own); the behaviour tests
# are.
#
# Usage: supabase/tests/mutation_tests.sh   (Docker, psql, python3)
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
MIG="$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql"
RB_SH="$ROOT/supabase/rollback/phase1c_rollback.sh"
OUT="$(mktemp -d /tmp/phase1c-mut.XXXXXX)"
A1=00000000-0000-0000-0000-0000000000a1
F1=00000000-0000-0000-0000-0000000000f1
STATUS=0
CONTAINERS=()
export PGPASSWORD=postgres
cleanup() {
  for c in "${CONTAINERS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done
  if [ -n "${KEEP_OUTPUT:-}" ]; then mkdir -p "$KEEP_OUTPUT" && cp -r "$OUT"/. "$KEEP_OUTPUT"/; fi
  rm -rf "$OUT"
}
trap cleanup EXIT
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$A1',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" "$MIG" > "$OUT/mig.sql"
[ "$(diff "$MIG" "$OUT/mig.sql" | grep -c '^[<>]')" = "2" ] || { echo "test copy: expected exactly one changed line"; exit 2; }

# fresh database with the migration applied; sets PORT
fresh() {
  local name="p1c-mut-$1-$$" ok=0
  docker run -d --name "$name" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  CONTAINERS+=("$name")
  PORT="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
  for _ in $(seq 1 90); do
    if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
      ok=$((ok + 1)); [ "$ok" -ge 3 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 3 ] || { echo "database $name did not start"; exit 2; }
  q supabase_admin -f "$HERE/bootstrap_hosted_auth.sql" >/dev/null
  q postgres -f "$ROOT/supabase/baseline/staging_schema_2026-10-15.sql" >/dev/null 2>&1
  q supabase_admin -f "$HERE/fixtures_staging_like.sql" >/dev/null
  q postgres -f "$OUT/mig.sql" > "$OUT/$1.migrate.log" 2>&1 || { echo "migration failed in $1"; tail -3 "$OUT/$1.migrate.log"; exit 2; }
}
# function_sql NAME SED-EXPR: the migration's CREATE OR REPLACE of public.NAME, edited
function_sql() {
  python3 -I - "$MIG" "$1" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\." + sys.argv[2] + r"\(.*?\n(\$\w*\$);\n", s, re.S)
print(m.group(0))
PY
}
# detectors: each prints PASS or FAIL plus detail
det_sql() {   # det_sql ID...: the named SQL security tests all pass?
  q postgres -f "$HERE/phase1c_security_tests.sql" > "$OUT/$CASE.sqltests.txt" 2>&1 || true
  local ids; ids="$(printf "'%s'," "$@")"; ids="${ids%,}"
  local bad; bad="$(qa "select coalesce(string_agg(id, ',' order by id), '') from tests.results where id in ($ids) and not passed")"
  local n; n="$(qa "select count(*) from tests.results where id in ($ids)")"
  if [ -z "$bad" ] && [ "$n" = "$#" ]; then echo "PASS"; else echo "FAIL failing: ${bad:-missing}"; fi
}
det_hosted() {
  q supabase_admin -f "$HERE/staff_account_checks_hosted_shape.sql" > "$OUT/$CASE.hosted.txt" 2>&1 || true
  if [ "$(grep -c '| PASS ' "$OUT/$CASE.hosted.txt")" = "10" ]; then echo "PASS"; else echo "FAIL $(grep -o -E '^ H[0-9]+ +\| FAIL' "$OUT/$CASE.hosted.txt" | awk '{print $1}' | tr '\n' ' ')"; fi
}
det_conc() {  # det_conc PATTERN: the concurrency cases matching PATTERN pass?
  q postgres -c "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$A1\",\"role\":\"authenticated\"}', false); select public.assign_staff_role('$F1', 'admin');" >/dev/null 2>&1 || true
  CONC_OUT="$OUT/$CASE.conc" PORT="$PORT" "$HERE/admin_concurrency_tests.sh" > "$OUT/$CASE.conc.txt" 2>&1 || true
  local bad; bad="$(grep -E "^  FAIL: ($1)" "$OUT/$CASE.conc.txt" | sed -E 's/^  FAIL: ([^ ]+).*/\1/' | tr '\n' ' ')"
  if [ -z "$bad" ] && grep -q -E "^  pass: ($1)" "$OUT/$CASE.conc.txt"; then echo "PASS"; else echo "FAIL ${bad:-no matching case}"; fi
}
det_rule() {  # an audit-discarding rule must be reported by the monitor
  q postgres -c "create rule p1c_drop_audit as on insert to public.security_audit_log do instead nothing" >/dev/null
  local n; n="$(qa "select count(*) from public.containment_violations() where problem = 'unexpected rewrite rule'")"
  q postgres -c "drop rule p1c_drop_audit on public.security_audit_log" >/dev/null
  if [ "$n" = "1" ]; then echo "PASS"; else echo "FAIL rule not reported"; fi
}
det_postdeploy() {  # the post-deployment check accepts the monitor fingerprint?
  local ok; ok="$(q postgres -At -f "$HERE/postdeploy_verify_readonly.sql" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print({c["check"]: c["ok"] for c in d["checks"]}["monitor_fingerprint_matches_review"])')"
  if [ "$ok" = "True" ]; then echo "PASS"; else echo "FAIL monitor fingerprint mismatch"; fi
}
det_rb_password() {  # $1 = wrapper; a password in --db-url must be refused before connecting
  local out; out="$("$1" --target local --db-url "postgresql://postgres:secret@127.0.0.1:1/postgres" --expected-admin "$A1" \
     --approved-by x --backup-ref x --export-dir "/tmp/phase1c-mut-rbx-$$-$CASE" --confirm "ROLLBACK PHASE 1C ON local" 2>&1 || true)"
  if echo "$out" | grep -q "must not contain a password"; then echo "PASS"; else echo "FAIL $(echo "$out" | tail -1)"; fi
}

# expect CASE "description" DETECTOR [args]: on the mutated database the detector must FAIL
expect() {
  local desc="$1"; shift
  local r; r="$("$@")"
  if [ "$CASE" = "m0" ]; then
    [ "${r%% *}" = "PASS" ] && echo "  pass: m0 control: $desc passes on the unmodified migration" || { echo "  FAIL: m0 control: $desc fails without any mutation ($r)"; STATUS=1; }
  elif [ "${r%% *}" = "FAIL" ]; then echo "  pass: $CASE detected: $desc -> ${r#FAIL }"
  else echo "  FAIL: $CASE SURVIVED: $desc still passes"; STATUS=1; fi
}

echo "  -- mutation tests: each weakening must make its test fail"
CASE=m0; fresh m0
expect "SQL tests T25a-d, T26a-d, T27" det_sql T25a T25b T25c T25d T26a T26b T26c T26d T27
expect "hosted-shape account checks (10)" det_hosted
expect "rule reported by the monitor" det_rule
expect "post-deployment monitor fingerprint" det_postdeploy
expect "concurrency lock_order and REPEATABLE READ cases" det_conc "lock_order|.*repeatable_read"
expect "rollback refuses a password in --db-url" det_rb_password "$RB_SH"

CASE=m1_driver_read; fresh m1
q postgres -c "drop policy drivers_read_assigned_orders on public.orders;
  create policy drivers_read_assigned_orders on public.orders for select to authenticated using (driver_id = (select auth.uid()))" >/dev/null
expect "M1: assigned-order read without the active driver role (legacy rule)" det_sql T25a T25b T25c T25d

CASE=m2_assign_checks; fresh m2
function_sql assign_staff_role | python3 -I -c '
import re, sys
s = sys.stdin.read()
a = s.index("  -- Account checks (review 2026-10-26 L2)"); b = s.index("  if p_kitchen is not null")
print(s[:a] + "  if not exists (select 1 from auth.users u where u.id = p_user) then\n    raise exception $m$user % does not exist$m$, p_user using errcode = $m$22023$m$;\n  end if;\n" + s[b:])' > "$OUT/m2.sql"
q postgres -f "$OUT/m2.sql" >/dev/null
expect "L2: assign_staff_role without the account checks (SQL tests)" det_sql T26a T26b
expect "L2: assign_staff_role without the account checks (hosted shape)" det_hosted

CASE=m3_profile_guard; fresh m3
function_sql enforce_profile_privilege_guard | python3 -I -c '
import sys
s = sys.stdin.read()
a = s.index("  elsif new.role is distinct from old.role"); b = s.index("  end if;\n  return new;")
print(s[:a] + s[b:])' > "$OUT/m3.sql"
q postgres -f "$OUT/m3.sql" >/dev/null
expect "L5: profile guard without its UPDATE branch" det_sql T27

CASE=m4_serialize_lock; fresh m4
q postgres -c "drop trigger trg_staff_roles_serialize on public.staff_roles" >/dev/null
expect "L5: statement-level advisory lock removed" det_conc "lock_order"

CASE=m5_last_admin_for_share; fresh m5
function_sql staff_roles_require_admin | sed 's/ and is_active for share;/ and is_active;/' > "$OUT/m5.sql"
grep -q "for share" "$OUT/m5.sql" && { echo "m5: mutation not applied"; exit 2; }
q postgres -f "$OUT/m5.sql" >/dev/null
expect "rev6 M1: last-admin check without FOR SHARE" det_conc ".*repeatable_read"

CASE=m6_monitor_rules; fresh m6
function_sql containment_violations | python3 -I -c '
import sys
s = sys.stdin.read()
a = s.index("  -- Rewrite rules (review 2026-10-26 L3)"); b = s.index("  -- Guard triggers and constraints")
print(s[:a] + s[b:])' > "$OUT/m6.sql"
q postgres -f "$OUT/m6.sql" >/dev/null
expect "L3: monitor without the rewrite-rule check" det_rule
expect "L4: the post-deployment check notices the replaced monitor" det_postdeploy

CASE=m7_rb_password
mkdir -p "$OUT/w/r"
sed 's/^  password) die .*$/  password) read -r _ URL_HOST URL_USER <<<"ok 127.0.0.1 postgres" ;;/' "$RB_SH" > "$OUT/w/r/rb_mut.sh"; chmod +x "$OUT/w/r/rb_mut.sh"
cmp -s "$RB_SH" "$OUT/w/r/rb_mut.sh" && { echo "m7: mutation not applied"; exit 2; }
cp "$ROOT/supabase/rollback/phase1c_rollback.sql" "$OUT/w/r/phase1c_rollback.sql"
expect "L8: rollback wrapper without the password refusal" det_rb_password "$OUT/w/r/rb_mut.sh"

[ "$STATUS" = "0" ] && echo "  mutation tests: every weakening detected, control clean" || echo "  mutation tests: SOME WEAKENINGS SURVIVED OR THE CONTROL FAILED"
exit $STATUS
