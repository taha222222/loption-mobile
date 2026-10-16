#!/usr/bin/env bash
# Phase 1C: run the containment package against a DISPOSABLE local PostgreSQL.
# Never connects to Supabase. Needs PostgreSQL server binaries (initdb, pg_ctl).
# Usage: supabase/tests/run_phase1c_tests.sh [path-to-postgres-bin]
# Exit code 0 only if every AFTER test passes, re-apply is clean, the seed
# guard aborts on an unexpected admin, and rollback restores the BEFORE matrix.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${1:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
MIG="$ROOT/supabase/migrations/20261016120000_phase1c_security_containment.sql"
DOWN="$ROOT/supabase/rollback/20261016120000_phase1c_security_containment.down.sql"
BASE="$HERE/phase1c_baseline_staging.sql"; TESTS="$HERE/phase1c_acceptance.sql"; MATRIX="$HERE/phase1c_policy_matrix.sql"
DIR="$(mktemp -d /tmp/phase1c-pg.XXXXXX)"; chmod 755 "$DIR"
RUNAS=""; if [ "$(id -u)" = "0" ]; then chown nobody "$DIR"; RUNAS="su nobody -s /bin/sh -c"; fi
run() { if [ -n "$RUNAS" ]; then $RUNAS "$*"; else sh -c "$*"; fi; }
cleanup() { run "$PGBIN/pg_ctl -D $DIR/data stop -m fast >/dev/null 2>&1" || true; rm -rf "$DIR"; }
trap cleanup EXIT
run "$PGBIN/initdb -D $DIR/data -A trust -U postgres >/dev/null"
run "$PGBIN/pg_ctl -D $DIR/data -o '-k $DIR -p 54331 -c listen_addresses=' -l $DIR/log start >/dev/null"
psqlq() { local db="$1"; shift; psql -h "$DIR" -p 54331 -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; }
fresh() { psqlq postgres -c "create database $1" ; psqlq "$1" -f "$BASE" >/dev/null; }
summary() { psqlq "$1" -At -c "select count(*) filter (where passed) || ' pass / ' || count(*) filter (where not passed) || ' fail' from tests.results"; }
fails()   { psqlq "$1" -At -c "select count(*) from tests.results where not passed"; }
STATUS=0
echo "Disposable PostgreSQL $(psqlq postgres -At -c 'show server_version')"

echo; echo "=== A. BEFORE: reconstructed staging, no containment"
fresh p1c_before
psqlq p1c_before -f "$TESTS"
echo "BEFORE: $(summary p1c_before)"
psqlq p1c_before -f "$MATRIX" > "$DIR/matrix_before.txt"

echo; echo "=== B. AFTER: fresh baseline + containment migration"
fresh p1c_after
psqlq p1c_after -f "$MIG" 2>/dev/null
psqlq p1c_after -f "$TESTS"
echo "AFTER: $(summary p1c_after)"; [ "$(fails p1c_after)" = "0" ] || STATUS=1
psqlq p1c_after -f "$MATRIX" > "$DIR/matrix_after.txt"

echo; echo "=== C. RE-APPLY the migration on top of B (repeatability)"
if psqlq p1c_after -f "$MIG" >/dev/null 2>"$DIR/reapply.err"; then
  psqlq p1c_after -f "$TESTS" >/dev/null 2>&1
  echo "RE-APPLY: clean · $(summary p1c_after)"; [ "$(fails p1c_after)" = "0" ] || STATUS=1
else echo "RE-APPLY: FAILED"; cat "$DIR/reapply.err"; STATUS=1; fi

echo; echo "=== D. SEED GUARD: a second account with role=admin AND is_admin=true must abort the migration"
fresh p1c_guard
psqlq p1c_guard -c "update public.user_profiles set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000e1'"
if psqlq p1c_guard -f "$MIG" >/dev/null 2>"$DIR/guard.err"; then
  echo "SEED GUARD: did NOT abort (FAIL)"; STATUS=1
else
  echo "SEED GUARD: aborted as expected: $(grep -o 'Phase 1C seed guard[^.]*\.[^.]*' "$DIR/guard.err" | head -1)"
  n=$(psqlq p1c_guard -At -c "select count(*) from pg_class where relname = 'staff_roles'")
  echo "SEED GUARD: nothing partially applied (staff_roles tables present: $n)"; [ "$n" = "0" ] || STATUS=1
fi

echo; echo "=== E. ROLLBACK: fresh baseline + migration + rollback (expected to RE-OPEN the vulnerabilities)"
fresh p1c_rollback
psqlq p1c_rollback -f "$MIG" >/dev/null 2>&1
psqlq p1c_rollback -f "$DOWN" >/dev/null 2>&1
psqlq p1c_rollback -f "$MATRIX" > "$DIR/matrix_rollback.txt"
psqlq p1c_rollback -f "$TESTS" >/dev/null 2>&1
echo "AFTER ROLLBACK: $(summary p1c_rollback)  (BEFORE was: $(summary p1c_before))"
if diff -q "$DIR/matrix_before.txt" "$DIR/matrix_rollback.txt" >/dev/null; then
  echo "ROLLBACK restores the exact BEFORE policy/grant/function matrix: yes"
else
  echo "ROLLBACK restores the exact BEFORE policy/grant/function matrix: NO"; diff "$DIR/matrix_before.txt" "$DIR/matrix_rollback.txt" || true; STATUS=1
fi

if [ -n "${PHASE1C_OUT:-}" ]; then cp "$DIR"/matrix_*.txt "$PHASE1C_OUT"/; fi
echo; [ "$STATUS" = "0" ] && echo "RESULT: ALL PHASE 1C CHECKS PASSED" || echo "RESULT: SOME PHASE 1C CHECKS FAILED"
exit $STATUS
