#!/usr/bin/env bash
# =====================================================================
# Phase 1C test harness. LOCAL, DISPOSABLE databases only.
#
# Starts throw-away containers of the Supabase Postgres image (same major/
# minor as staging: PostgreSQL 17.6) and never connects anywhere else. It
# takes no connection string, so it cannot be pointed at a remote database.
#
# Requires: docker, psql, python3.  Usage: supabase/tests/run_phase1c.sh
# Optional: KEEP_OUTPUT=<dir> to keep matrices / catalogs / test output.
# Exit 0 only if every scenario below passes.
#
#   A  baseline round-trip: baseline reproduces the staging evidence;
#      read-only preflight passes; BEFORE security tests (expected failures)
#   B  AFTER: baseline + fixtures + migration -> every security test passes;
#      preflight now reports the migration as applied
#   C  re-apply: migration twice -> no further change, every test passes
#   D  guard: a second role=admin/is_admin=true profile aborts, nothing applied
#   E  guard: an unexpected drivers.status value aborts, nothing applied
#   F  guard: an unreviewed policy on orders aborts, nothing applied
#   G  rollback: migration + rollback restores the BEFORE matrix exactly
#      and the legacy driver statuses (re-opens the vulnerabilities!)
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
BASE="$ROOT/supabase/migrations/20261015194030_baseline_staging_schema.sql"
MIG="${PHASE1C_MIGRATION:-$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql}"   # override only for mutation testing
DOWN="$ROOT/supabase/rollback/20261016170000_phase1c_security_containment.down.sql"
EVIDENCE="$ROOT/supabase/evidence/catalog_2026-10-15.json"
CATALOG_Q="$ROOT/supabase/evidence/phase1b_catalog_query.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/phase1c_security_tests.sql"; MATRIX="$HERE/phase1c_matrix.sql"
PREFLIGHT="$HERE/preflight_staging_readonly.sql"
OUT="$(mktemp -d /tmp/phase1c-run.XXXXXX)"
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

# start_db NAME -> sets PORT; waits until the image's init scripts are done
start_db() {
  local name="p1c-$1-$$"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
  CONTAINERS+=("$name")
  PORT="$(docker port "$name" 5432/tcp | head -1 | sed 's/.*://')"
  local ok=0
  for _ in $(seq 1 90); do
    if psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
      ok=$((ok + 1)); [ "$ok" -ge 3 ] && break
    else ok=0; fi
    sleep 1
  done
  [ "$ok" -ge 3 ] || { echo "database $name did not start"; exit 2; }
}
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
setup() {   # bootstrap stand-ins, baseline (as postgres, like hosted), fixtures
  q supabase_admin -f "$BOOT" >/dev/null
  q postgres -f "$BASE" >/dev/null 2>&1
  q supabase_admin -f "$FIX" >/dev/null
}
migrate() { q postgres --single-transaction -f "$MIG" >"$OUT/$1.log" 2>&1; }
summary() { qa "select count(*) filter (where passed) || ' pass / ' || count(*) filter (where not passed) || ' fail' from tests.results"; }
nfail()   { qa "select count(*) from tests.results where not passed"; }
catalog() {  # owner's evidence query; storage.buckets is absent in the bare image
  sed "s/(select jsonb_agg(to_jsonb(b) - 'owner' - 'owner_id') from storage.buckets b)/null::jsonb/" "$CATALOG_Q" \
    | q postgres -At > "$1"
}
preflight_ok() { q postgres -At -f "$PREFLIGHT" 2>"$OUT/preflight.err" | python3 -I -c "import json,sys; print(json.load(sys.stdin)['all_required_checks_ok'])" 2>/dev/null || echo ERROR; }
nothing_applied() {
  [ "$(qa "select to_regclass('public.staff_roles') is null and to_regclass('public.kitchens') is null")" = "t" ] &&
  [ "$(qa "select count(*) from pg_policies where schemaname = 'public'")" = "$1" ]
}

echo "Image: $IMAGE ($(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo 'digest unknown'))"

echo; echo "=== A. baseline round-trip, preflight, BEFORE tests"
start_db a; setup
echo "  $(qa 'select version()')"
catalog "$OUT/catalog_local.json"
if python3 -I "$ROOT/supabase/baseline/compare_catalog.py" "$EVIDENCE" "$OUT/catalog_local.json" > "$OUT/compare.txt"; then
  pass "baseline reproduces the staging evidence"; sed 's/^/    /' "$OUT/compare.txt"
else fail "baseline differs from evidence"; cat "$OUT/compare.txt"; fi
POLICIES_BEFORE="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
[ "$(preflight_ok)" = "True" ] && pass "read-only preflight: all required checks ok on the reproduced staging schema" \
  || { fail "preflight not ok on reproduced schema"; q postgres -At -f "$PREFLIGHT" || true; }
q postgres -f "$MATRIX" > "$OUT/matrix_before.txt"
q postgres -f "$TESTS" > "$OUT/tests_before.txt"
echo "  BEFORE (vulnerable staging reproduction): $(summary)  <- failures here document C1-C4/H2-H4"

echo; echo "=== B. AFTER: baseline + fixtures + containment migration"
start_db b; setup
if migrate b; then pass "migration applied (single transaction)"; else fail "migration failed"; cat "$OUT/b.log"; fi
q postgres -f "$TESTS" > "$OUT/tests_after.txt"
echo "  AFTER: $(summary)"; [ "$(nfail)" = "0" ] && pass "every security test passes" || { fail "security tests failing"; cat "$OUT/tests_after.txt"; }
q postgres -f "$MATRIX" > "$OUT/matrix_after.txt"
[ "$(preflight_ok)" = "False" ] && pass "preflight correctly reports the migration as already applied" || fail "preflight did not detect applied migration"

echo; echo "=== C. RE-APPLY (repeatability)"
start_db c; setup
migrate c1 || { fail "first apply failed"; cat "$OUT/c1.log"; }
q postgres -f "$MATRIX" > "$OUT/matrix_c1.txt"; AUDIT1="$(qa 'select count(*) from public.security_audit_log')"
if migrate c2; then pass "second apply succeeded"; else fail "second apply failed"; cat "$OUT/c2.log"; fi
q postgres -f "$MATRIX" > "$OUT/matrix_c2.txt"; AUDIT2="$(qa 'select count(*) from public.security_audit_log')"
diff -q "$OUT/matrix_c1.txt" "$OUT/matrix_c2.txt" >/dev/null && [ "$AUDIT1" = "$AUDIT2" ] \
  && pass "second apply changed nothing (matrix identical, audit rows $AUDIT1 = $AUDIT2)" \
  || { fail "second apply changed state"; diff "$OUT/matrix_c1.txt" "$OUT/matrix_c2.txt" || true; }
q postgres -f "$TESTS" > "$OUT/tests_reapply.txt"
echo "  RE-APPLY tests: $(summary)"; [ "$(nfail)" = "0" ] || fail "tests failing after re-apply"

guard() {  # guard NAME "SQL that breaks an assumption" "expected message fragment"
  start_db "$1"; setup
  q supabase_admin -c "set role postgres; $2" >/dev/null
  local n; n="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
  if migrate "$1"; then fail "guard $1 did not abort"
  elif grep -q "$3" "$OUT/$1.log" && nothing_applied "$n"; then
    pass "guard $1 aborted with: $(grep -o "$3[^|]*" "$OUT/$1.log" | head -1 | cut -c1-110); nothing applied"
  else fail "guard $1: wrong error or partial application"; cat "$OUT/$1.log"; fi
}
echo; echo "=== D/E/F. guards"
guard d "update public.user_profiles set role = 'admin' where user_id = '00000000-0000-0000-0000-0000000000e1'" "admin seed guard"
guard e "update public.drivers set status = 'approved' where id = '00000000-0000-0000-0000-0000000000d2'" "unexpected drivers.status values"
guard f "create policy rogue_insert on public.orders for insert with check (true)" "unreviewed policies"

echo; echo "=== G. ROLLBACK (re-opens the vulnerabilities by design)"
start_db g; setup
q postgres -f "$MATRIX" > "$OUT/matrix_g_before.txt"
DRV_BEFORE="$(qa "select string_agg(id || '=' || status, ',' order by id) from public.drivers")"
migrate g || { fail "migration failed"; cat "$OUT/g.log"; }
if q postgres --single-transaction -f "$DOWN" > "$OUT/g_down.log" 2>&1; then pass "rollback applied"; else fail "rollback failed"; cat "$OUT/g_down.log"; fi
q postgres -f "$MATRIX" > "$OUT/matrix_rollback.txt"
diff -q "$OUT/matrix_g_before.txt" "$OUT/matrix_rollback.txt" >/dev/null \
  && pass "rollback restores the exact BEFORE policy/grant/function/default-privilege matrix" \
  || { fail "rollback matrix differs"; diff "$OUT/matrix_g_before.txt" "$OUT/matrix_rollback.txt" || true; }
DRV_AFTER="$(qa "select string_agg(id || '=' || status, ',' order by id) from public.drivers")"
[ "$DRV_BEFORE" = "$DRV_AFTER" ] && pass "legacy drivers.status values restored from the audit log" || fail "driver statuses not restored: $DRV_AFTER"
diff -q "$OUT/matrix_before.txt" "$OUT/matrix_g_before.txt" >/dev/null && pass "BEFORE matrices of A and G identical (deterministic setup)" || fail "A/G before matrices differ"

echo
if [ "$STATUS" = "0" ]; then echo "RESULT: ALL PHASE 1C LOCAL CHECKS PASSED"; else echo "RESULT: SOME PHASE 1C CHECKS FAILED"; fi
exit $STATUS
