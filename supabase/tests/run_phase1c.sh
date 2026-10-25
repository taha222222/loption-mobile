#!/usr/bin/env bash
# =====================================================================
# Phase 1C test harness. LOCAL, DISPOSABLE databases only.
#
# Starts throw-away containers of the Supabase Postgres image (same
# PostgreSQL 17.6 as staging) and, for scenario S, the real Supabase
# Storage API. It takes no connection string, so it cannot be pointed at a
# remote database. Containers are removed on exit.
#
# Requires: docker, psql, python3, curl.  Usage: supabase/tests/run_phase1c.sh
# Optional: KEEP_OUTPUT=<dir> keeps matrices / catalogs / test output.
#           PHASE1C_SUPABASE_CLI=<path to supabase CLI> adds the db push
#           checks of scenario P (local container only, --db-url 127.0.0.1).
# The committed core migration refuses to run until the owner-authorized
# initial admin id is filled in (deployment prerequisite). The tests apply
# a COPY in which only that marked line is replaced by the fixture admin
# a1; the copy is checked to differ from the committed file in that one
# line only. The committed file itself is tested to refuse.
# Exit 0 only if every check below passes.
#
#   A  baseline round-trip vs evidence; read-only preflight (non-storage
#      checks) passes; BEFORE security tests (expected failures)
#   B  AFTER core migration: every SQL security test passes; the storage
#      migration refuses to run where storage is absent; preflight reports
#      the migration as applied
#   C  re-apply core migration: no further change, tests still pass
#   P  migration procedure / initial admin (M1, L6): the committed file
#      (placeholder) refuses; customer-controlled admin profiles are never
#      seeded; unverified admin ids are refused; guard and postcondition
#      failures commit nothing under plain psql -f, ON_ERROR_STOP without
#      --single-transaction and ON_ERROR_ROLLBACK=on; wrong role refused;
#      Supabase CLI db push (only if PHASE1C_SUPABASE_CLI is set)
#   E-F  data/policy guards (unknown driver status, rogue policy)
#   H  drift guards (U3-U6, owners, grantees, RLS): every injected unsafe
#      state aborts the migration with nothing applied AND fails the
#      matching preflight check; reverting it makes the preflight pass
#   M  monitoring (M2, L1-L3): every injected regression of the reviewed
#      state (altered or broad policies, views, materialized views, foreign
#      tables, unreviewed SECURITY DEFINER functions, changed migration
#      functions, effective Auth-hook privilege, unreviewed client schema,
#      RLS-ungoverned grants, no active admin, unapproved online driver,
#      nullable driver status) is reported by containment_violations();
#      concurrent admin revocations leave an active admin
#   G  rollback (core) restores the exact BEFORE matrix + driver statuses
#      (incl. NULL) and ARCHIVES the new tables (rows preserved)
#   S  real Storage API: preflight incl. storage passes; BEFORE shows the
#      customer-upload hole; bucket-state guards abort; core+storage
#      migrations; HTTP checks (authorization, MIME allowlist, 5 MiB bucket
#      limit, effective bucket config) pass; zero containment violations;
#      SQL tests pass; re-apply clean; storage+core rollback restores the
#      exact BEFORE state incl. NULL bucket limits
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
STORAGE_IMAGE="${PHASE1C_STORAGE_IMAGE:-ghcr.io/supabase/storage-api:v1.79.30}"
BASE="$ROOT/supabase/baseline/staging_schema_2026-10-15.sql"
MIG="${PHASE1C_MIGRATION:-$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql}"   # override only for mutation testing
MIG_S="${PHASE1C_STORAGE_MIGRATION:-$ROOT/supabase/migrations/20261016171000_phase1c_storage_meal_images.sql}"   # override only for mutation testing
DOWN="$ROOT/supabase/rollback/20261016170000_phase1c_security_containment.down.sql"
DOWN_S="$ROOT/supabase/rollback/20261016171000_phase1c_storage_meal_images.down.sql"
EVIDENCE="$ROOT/supabase/evidence/catalog_2026-10-15.json"
CATALOG_Q="$ROOT/supabase/evidence/phase1b_catalog_query.sql"
BOOT="$HERE/bootstrap_hosted_auth.sql"; FIX="$HERE/fixtures_staging_like.sql"
TESTS="$HERE/phase1c_security_tests.sql"; MATRIX="$HERE/phase1c_matrix.sql"
PREFLIGHT="$HERE/preflight_staging_readonly.sql"; STORAGE_TESTS="$HERE/storage_api_tests.sh"
INVENTORY="$ROOT/supabase/evidence/meal_images_inventory_readonly.sql"; SCAN="$ROOT/supabase/tools/meal_images_scan.py"
QUARANTINE="$ROOT/supabase/tools/meal_images_quarantine.py"; BROWSER_TESTS="$HERE/browser_serving_tests.js"
OUT="$(mktemp -d /tmp/phase1c-run.XXXXXX)"
INITIAL_ADMIN=00000000-0000-0000-0000-0000000000a1          # fixture a1 (synthetic)
MIG_T="$OUT/core_migration_test_admin.sql"                  # MIG with only the marked admin line replaced
CLI="${PHASE1C_SUPABASE_CLI:-}"
NET="p1c-net-$$"
CONTAINERS=()
STATUS=0
export PGPASSWORD=postgres

cleanup() {
  for c in "${CONTAINERS[@]:-}"; do [ -n "$c" ] && docker rm -f "$c" >/dev/null 2>&1 || true; done
  docker network rm "$NET" >/dev/null 2>&1 || true
  if [ -n "${KEEP_OUTPUT:-}" ]; then mkdir -p "$KEEP_OUTPUT" && cp -r "$OUT"/. "$KEEP_OUTPUT"/; fi
  rm -rf "$OUT"
}
trap cleanup EXIT
fail() { echo "  FAIL: $*"; STATUS=1; }
pass() { echo "  pass: $*"; }

# start_db NAME [network] -> sets PORT and DBNAME; waits for init scripts
start_db() {
  DBNAME="p1c-$1-$$"
  docker rm -f "$DBNAME" >/dev/null 2>&1 || true
  docker run -d --name "$DBNAME" ${2:+--network "$2"} -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$IMAGE" >/dev/null
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
setup() {   # test-only auth stand-ins, baseline (as postgres, like hosted), fixtures
  q supabase_admin -f "$BOOT" >/dev/null
  q postgres -f "$BASE" >/dev/null 2>&1
  q supabase_admin -f "$FIX" >/dev/null
}
# with_admin <uuid> <dst>: copy of the committed core migration with only the
# marked initial-admin line changed (asserted: exactly one line differs)
with_admin() {
  sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$1',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" "$MIG" > "$2"
  [ "$(diff "$MIG" "$2" | grep -c '^[<>]')" = "2" ] || { echo "with_admin: expected exactly one changed line"; exit 2; }
}
# migrate NAME [file]: the file controls its own transaction (BEGIN/COMMIT);
# applied the way a contributor would with psql (ON_ERROR_STOP, no extra wrapping)
migrate() { q postgres -f "${2:-$MIG_T}" >"$OUT/$1.log" 2>&1; }
summary() { qa "select count(*) filter (where passed) || ' pass / ' || count(*) filter (where not passed) || ' fail' from tests.results"; }
nfail()   { qa "select count(*) from tests.results where not passed"; }
catalog() {  # owner's evidence query; storage.buckets is absent in the bare image
  sed "s/(select jsonb_agg(to_jsonb(b) - 'owner' - 'owner_id') from storage.buckets b)/null::jsonb/" "$CATALOG_Q" \
    | q postgres -At > "$1"
}
# preflight_check <check-name-prefix-or-ALL> [skip-storage]: prints True/False/ERROR
preflight() {
  q postgres -At -f "$PREFLIGHT" 2>"$OUT/preflight.err" > "$OUT/preflight.json" || { echo ERROR; return; }
  python3 -I - "$OUT/preflight.json" "$1" "${2:-}" <<'PY'
import json, sys
d = json.load(open(sys.argv[1])); want, skip_storage = sys.argv[2], sys.argv[3] == "skip-storage"
rows = [c for c in d["checks"] if not c["check"].startswith("info:")
        and not (skip_storage and c["check"].startswith("storage_"))]
if want != "ALL":
    rows = [c for c in rows if c["check"] == want]
    if not rows: print("MISSING"); sys.exit()
print(all(c["ok"] for c in rows))
PY
}
nothing_applied() {
  [ "$(qa "select to_regclass('public.staff_roles') is null and to_regclass('public.kitchens') is null and to_regprocedure('public.containment_violations()') is null")" = "t" ] &&
  [ "$(qa "select count(*) from pg_policies where schemaname = 'public'")" = "$1" ]
}
with_admin "$INITIAL_ADMIN" "$MIG_T"

echo "Images: $IMAGE ($(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE" 2>/dev/null || echo 'digest unknown'))"
echo "        $STORAGE_IMAGE ($(docker image inspect --format '{{index .RepoDigests 0}}' "$STORAGE_IMAGE" 2>/dev/null || echo 'not present locally'))"

echo; echo "=== A. baseline round-trip, preflight, BEFORE tests"
start_db a; setup
echo "  $(qa 'select version()')"
catalog "$OUT/catalog_local.json"
if python3 -I "$ROOT/supabase/baseline/compare_catalog.py" "$EVIDENCE" "$OUT/catalog_local.json" > "$OUT/compare.txt"; then
  pass "baseline matches the staging evidence in every compared section (scope: supabase/evidence/README.md)"; sed 's/^/    /' "$OUT/compare.txt"
else fail "baseline differs from evidence"; cat "$OUT/compare.txt"; fi
[ "$(preflight ALL skip-storage)" = "True" ] && pass "read-only preflight: all required non-storage checks ok on the reproduced schema" \
  || { fail "preflight not ok on reproduced schema"; cat "$OUT/preflight.json" "$OUT/preflight.err" || true; }
if q postgres -f "$BASE" >"$OUT/base_again.log" 2>&1; then fail "baseline ran twice"; else
  grep -q "refusing to run" "$OUT/base_again.log" && pass "baseline refuses to run on a database that already has the schema" || fail "baseline second run: wrong error"; fi
q postgres -f "$MATRIX" > "$OUT/matrix_before.txt"
q postgres -f "$TESTS" > "$OUT/tests_before.txt"
echo "  BEFORE (vulnerable staging reproduction): $(summary)  <- failures here document C1-C4/H2-H4"

echo; echo "=== B. AFTER: baseline + fixtures + core containment migration"
start_db b; setup
if migrate b; then pass "core migration applied (file-controlled transaction; test copy with the fixture admin)"; else fail "core migration failed"; cat "$OUT/b.log"; fi
[ "$(qa "select string_agg(user_id::text, ',') from public.staff_roles where role = 'admin' and is_active")" = "$INITIAL_ADMIN" ] \
  && pass "exactly one active admin: the supplied initial admin (not derived from user_profiles)" || fail "unexpected admin set after migration"
q postgres -f "$TESTS" > "$OUT/tests_after.txt"
echo "  AFTER: $(summary)"; [ "$(nfail)" = "0" ] && pass "every SQL security test passes" || { fail "security tests failing"; cat "$OUT/tests_after.txt"; }
q postgres -f "$MATRIX" > "$OUT/matrix_after.txt"
qa "select coalesce(jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'command', cmd,
          'roles', roles, 'permissive', permissive, 'using', qual, 'with_check', with_check)), '[]') from pg_policies where schemaname = 'public'" > "$OUT/policies_after.json"
if python3 -I - "$EVIDENCE" "$OUT/policies_after.json" > "$OUT/kept_policies.txt" <<'PY'
import json, re, sys
norm = lambda x: None if x is None else re.sub(r"\s+", " ", x).strip()
key = lambda p: (p["schema"], p["table"], p["name"])
ev = {key(p): p for p in json.load(open(sys.argv[1]))["policies"]}
after = json.load(open(sys.argv[2]))
kept = [p for p in after if key(p) in ev]
bad = [p["table"] + "." + p["name"] for p in kept
       if any(norm(str(p[f])) != norm(str(ev[key(p)][f])) for f in ("command", "permissive", "using", "with_check"))
       or sorted(p["roles"]) != sorted(ev[key(p)]["roles"])]
print(f"{len(kept)} kept policies" + (": changed " + ", ".join(bad) if bad else ", all identical to the evidence"))
sys.exit(1 if bad or not kept else 0)
PY
then pass "every pre-existing policy the migration keeps is unchanged from the staging evidence ($(cat "$OUT/kept_policies.txt"))"
else fail "kept policies differ from the evidence: $(cat "$OUT/kept_policies.txt")"; fi
[ "$(preflight phase1c_not_yet_applied\ \(U9\))" = "False" ] && pass "preflight reports the migration as already applied" || fail "preflight did not detect applied migration"
if migrate b_storage "$MIG_S"; then fail "storage migration ran without a storage schema"
elif grep -q "storage.objects / storage.buckets missing" "$OUT/b_storage.log"; then pass "storage migration refuses to run where storage.objects is absent (fails closed)"
else fail "storage migration: wrong error"; cat "$OUT/b_storage.log"; fi

echo; echo "=== C. RE-APPLY core migration (repeatability)"
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

echo; echo "=== P. migration procedure and initial administrator (M1, L6)"
start_db p; setup
NPOL="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
C2=00000000-0000-0000-0000-0000000000c2
# run_mode MODE FILE LOG [user]: apply FILE the way a given runner would
run_mode() {
  local args=(-h 127.0.0.1 -p "$PORT" -U "${4:-postgres}" -d postgres -X -q)
  case "$1" in
    plain)       psql "${args[@]}" -f "$2" ;;                                   # psql -f, no flags
    stop)        psql "${args[@]}" -v ON_ERROR_STOP=1 -f "$2" ;;                # ON_ERROR_STOP, no --single-transaction
    single)      psql "${args[@]}" -v ON_ERROR_STOP=1 --single-transaction -f "$2" ;;
    rollback_on) psql "${args[@]}" -v ON_ERROR_ROLLBACK=on -f "$2" ;;          # errors inside the transaction are ignored
  esac > "$3" 2>&1
}
if migrate p_committed "$MIG"; then fail "committed migration ran with the placeholder admin id"
elif grep -q "initial administrator not supplied" "$OUT/p_committed.log" && nothing_applied "$NPOL"; then
  pass "committed file refuses until the owner-authorized initial admin id is supplied (deployment prerequisite); nothing applied"
else fail "committed file: wrong error or partial application"; cat "$OUT/p_committed.log"; fi
for spec in "flagged:00000000-0000-0000-0000-0000000000e1:illegitimate profile pattern" \
            "unknown:00000000-0000-0000-0000-00000000dead:does not exist in auth.users" \
            "unconfirmed:00000000-0000-0000-0000-0000000000c3:has not confirmed"; do
  IFS=: read -r tag uid frag <<<"$spec"
  with_admin "$uid" "$OUT/p_admin_$tag.sql"
  if migrate "p_admin_$tag" "$OUT/p_admin_$tag.sql"; then fail "initial admin $tag was accepted"
  elif grep -q "$frag" "$OUT/p_admin_$tag.log" && nothing_applied "$NPOL"; then pass "initial admin '$tag' refused ($frag); nothing applied"
  else fail "initial admin $tag: wrong error or partial application"; cat "$OUT/p_admin_$tag.log"; fi
done
# Reproduction of the self-review scenario P1a: a customer made their own
# profile role=admin, is_admin=true through the (still open) C1 hole.
q supabase_admin -c "update public.user_profiles set role = 'admin', is_admin = true where user_id = '$C2'" >/dev/null
for inj in "guard|update public.drivers set status = 'approved' where id = '00000000-0000-0000-0000-0000000000d2'|update public.drivers set status = 'pending' where id = '00000000-0000-0000-0000-0000000000d2'" \
           "postcondition|create policy p1c_probe_open_insert on public.cash_collections for insert to authenticated with check (true)|drop policy p1c_probe_open_insert on public.cash_collections"; do
  IFS='|' read -r kind inject revert <<<"$inj"
  q supabase_admin -c "$inject" >/dev/null
  NPOL_I="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
  for mode in plain stop single rollback_on; do
    run_mode "$mode" "$MIG_T" "$OUT/p_${kind}_$mode.log" || true
    if nothing_applied "$NPOL_I"; then pass "$kind failure under '$mode' runner: nothing committed (no staff_roles, no admin, policies unchanged)"
    else fail "$kind failure under '$mode' runner: PARTIAL APPLICATION"; cat "$OUT/p_${kind}_$mode.log"; fi
  done
  q supabase_admin -c "$revert" >/dev/null
done
grep -q "phase1c_guard_did_not_pass" "$OUT/p_guard_rollback_on.log" "$OUT/p_postcondition_rollback_on.log" \
  && pass "with ON_ERROR_ROLLBACK=on the deferred commit gate is what refuses the COMMIT (guards ignored by the runner)" \
  || { fail "commit gate did not act under ON_ERROR_ROLLBACK"; cat "$OUT/p_guard_rollback_on.log"; }
q supabase_admin -c "create role cli_login_postgres login password 'postgres' in role postgres" >/dev/null
run_mode stop "$MIG_T" "$OUT/p_role.log" cli_login_postgres || true
grep -q "must run as role postgres" "$OUT/p_role.log" && nothing_applied "$NPOL" \
  && pass "a login role that has not switched to postgres is refused before any change (L6)" || { fail "role check"; cat "$OUT/p_role.log"; }
q supabase_admin -c "drop role cli_login_postgres" >/dev/null
run_mode plain "$MIG_T" "$OUT/p_plain_ok.log" || true
[ "$(qa "select coalesce(string_agg(user_id::text, ','), 'none') from public.staff_roles where role = 'admin' and is_active")" = "$INITIAL_ADMIN" ] \
  && [ "$(qa "select count(*) from public.containment_violations() where category <> 'storage'")" = "0" ] \
  && pass "applied with plain psql -f: the only admin is the supplied id; the customer-controlled role=admin/is_admin=true profiles (c2, e1) are NOT admins" \
  || { fail "plain apply / admin set wrong"; cat "$OUT/p_plain_ok.log"; }
if [ -n "$CLI" ] && [ -x "$CLI" ]; then
  mkdir -p "$OUT/cliproj/supabase/migrations"; touch "$OUT/cliproj/supabase/config.toml"   # the CLI writes only below this temp project
  echo "  -- Supabase CLI $(cd "$OUT/cliproj" && "$CLI" --version 2>/dev/null) db push against a LOCAL container (--db-url 127.0.0.1)"
  start_db pc; setup
  NPOL="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
  cp "$MIG_T" "$OUT/cliproj/supabase/migrations/20261016170000_phase1c_security_containment.sql"
  URL="postgresql://postgres:postgres@127.0.0.1:$PORT/postgres?sslmode=disable"
  q supabase_admin -c "update public.drivers set status = 'approved' where id = '00000000-0000-0000-0000-0000000000d2'" >/dev/null
  (cd "$OUT/cliproj" && "$CLI" db push --db-url "$URL" --yes) > "$OUT/p_cli_fail.log" 2>&1 && fail "CLI push succeeded despite a failing guard"
  nothing_applied "$NPOL" && [ "$(qa "select to_regclass('supabase_migrations.schema_migrations') is null or not exists (select 1 from supabase_migrations.schema_migrations where version = '20261016170000')")" = "t" ] \
    && pass "CLI db push with a failing guard: nothing applied, migration not recorded" || { fail "CLI failure case"; cat "$OUT/p_cli_fail.log"; }
  q supabase_admin -c "update public.drivers set status = 'pending' where id = '00000000-0000-0000-0000-0000000000d2'" >/dev/null
  if (cd "$OUT/cliproj" && "$CLI" db push --db-url "$URL" --yes) > "$OUT/p_cli_ok.log" 2>&1 \
     && [ "$(qa "select count(*) from supabase_migrations.schema_migrations where version = '20261016170000'")" = "1" ] \
     && [ "$(qa "select count(*) from public.containment_violations() where category <> 'storage'")" = "0" ]; then
    pass "CLI db push applies the migration (with its own BEGIN/COMMIT), records it, 0 violations"
  else fail "CLI success case"; cat "$OUT/p_cli_ok.log"; fi
else
  echo "  SKIPPED: Supabase CLI db push checks (PHASE1C_SUPABASE_CLI not set) - NOT verified in this run"
fi

# guard NAME "inject SQL" "expected migration error fragment" "preflight check" "revert SQL"
#   inject -> migration must abort with the fragment, nothing applied, and the
#   preflight check must be false; revert -> that preflight check passes again.
#   An empty fragment means: preflight-only check (the migration does not verify it).
guard() {
  local name="$1" inject="$2" frag="$3" check="$4" revert="$5" n
  q supabase_admin -c "$inject" >/dev/null
  n="$(qa "select count(*) from pg_policies where schemaname = 'public'")"
  local pf; pf="$(preflight "$check")"
  if [ -n "$frag" ]; then
    if migrate "guard_$name"; then fail "guard $name: migration did not abort"
    elif grep -q "$frag" "$OUT/guard_$name.log" && nothing_applied "$n"; then
      [ "$pf" = "False" ] && pass "guard $name: migration aborted ($frag), nothing applied; preflight '$check' fails" \
                         || fail "guard $name: preflight '$check' returned $pf"
    else fail "guard $name: wrong error or partial application"; cat "$OUT/guard_$name.log"; fi
  else
    [ "$pf" = "False" ] && pass "guard $name: preflight-only check '$check' fails (not verified by the migration)" \
                       || fail "guard $name: preflight '$check' returned $pf"
  fi
  q supabase_admin -c "$revert" >/dev/null
  [ "$(preflight "$check")" = "True" ] || fail "guard $name: preflight '$check' still failing after revert"
}
echo; echo "=== E-F, H. data, policy and platform-drift guards (one database, injected one at a time)"
start_db h; setup
[ "$(preflight ALL skip-storage)" = "True" ] || fail "guard database not clean before injections"
U1=00000000-0000-0000-0000-0000000000e1; D2=00000000-0000-0000-0000-0000000000d2
guard E_driver_status "update public.drivers set status = 'approved' where id = '$D2'" \
  "unexpected drivers.status values" "drivers_status_values_known" "update public.drivers set status = 'pending' where id = '$D2'"
guard F_rogue_policy "create policy rogue_insert on public.orders for insert with check (true)" \
  "unreviewed policies" "public_policy_set_matches_evidence" "drop policy rogue_insert on public.orders"
guard H1_custom_role "create role ceo nologin" \
  "unexpected database role" "U3_no_unexpected_roles" "drop role ceo"
guard H2_membership "grant service_role to authenticated" \
  "unexpected membership" "U3_no_unexpected_role_memberships" "revoke service_role from authenticated"
guard H3_bypassrls "alter role dashboard_user bypassrls" \
  "unexpected BYPASSRLS role" "U3_no_unexpected_superuser_or_bypassrls" "alter role dashboard_user nobypassrls"
guard H4_auth_hook "create function public.custom_access_token_hook(e jsonb) returns jsonb language sql as 'select e'; grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin" \
  "possible Auth hook" "U3_no_auth_hook_functions" "drop function public.custom_access_token_hook(jsonb)"
guard H5_event_trigger "create function public.p1c_evt() returns event_trigger language plpgsql as 'begin end'; create event trigger p1c_evt on ddl_command_end execute function public.p1c_evt()" \
  "unexpected event trigger" "U4_no_unexpected_event_triggers" "drop event trigger p1c_evt; drop function public.p1c_evt()"
guard H6_authenticator "alter role authenticator inherit" \
  "authenticator must be" "U5_authenticator_nosuperuser_nobypassrls_noinherit" "alter role authenticator noinherit"
guard H7_safeupdate "alter role authenticator set session_preload_libraries = 'supautils'" \
  "" "U5_authenticator_preloads_safeupdate" "alter role authenticator set session_preload_libraries = 'supautils, safeupdate'"
guard H8_schema_create "grant create on schema public to authenticated" \
  "can CREATE in schema" "U6_no_client_or_public_create_on_schemas" "revoke create on schema public from authenticated"
guard H9_table_owner "alter table public.meals owner to supabase_admin" \
  "relation not owned by postgres" "public_tables_owned_by_postgres" "alter table public.meals owner to postgres"
guard H10_grantee "grant select on public.orders to dashboard_user" \
  "unexpected table grantee" "public_table_grantees_expected" "revoke select on public.orders from dashboard_user"
guard H11_rls_off "alter table public.meals disable row level security" \
  "row level security disabled" "public_tables_rls_enabled" "alter table public.meals enable row level security"
[ "$(preflight ALL skip-storage)" = "True" ] && pass "guard database clean again after all reverts" || fail "guard database not clean after reverts"
if migrate h_final; then pass "migration applies once every injected state is reverted"; else fail "migration failed after reverts"; cat "$OUT/h_final.log"; fi

echo; echo "=== M. monitoring: containment_violations() reports regressions of the reviewed state (M2, L1-L3)"
start_db m; setup
migrate m || { fail "migration failed"; cat "$OUT/m.log"; }
clean_m() { [ "$(qa "select count(*) from public.containment_violations() where category <> 'storage'")" = "0" ]; }
clean_m || { fail "monitoring database not clean after migration"; qa "select * from public.containment_violations()"; }
# mon NAME ROLE "inject SQL" "expected problem fragment" "revert SQL"
mon() {
  local name="$1" role="$2" inject="$3" frag="$4" revert="$5" hits
  if ! q "$role" -v ON_ERROR_STOP=1 -c "$inject" >/dev/null 2>"$OUT/mon_$name.err"; then
    fail "monitor $name: injection failed"; cat "$OUT/mon_$name.err"; return
  fi
  hits="$(echo "select count(*) from public.containment_violations() where strpos(problem, :'frag') > 0" | q postgres -At -v frag="$frag")"
  if [ "${hits:-0}" -ge 1 ]; then pass "monitor $name: reported ('$frag')"
  else fail "monitor $name: NOT reported"; qa "select * from public.containment_violations()"; fi
  q "$role" -v ON_ERROR_STOP=1 -c "$revert" >/dev/null
  clean_m || { fail "monitor $name: not clean after revert"; qa "select * from public.containment_violations() where category <> 'storage'"; }
}
REVIEWED="differ from the reviewed definition"
ADM="(( SELECT public.has_staff_role('admin'::text) AS has_staff_role))"
mon P2_policy_expression postgres "alter policy staff_admin_all_orders on public.orders using (true) with check (true)" "$REVIEWED" \
  "alter policy staff_admin_all_orders on public.orders using $ADM with check $ADM"
mon P2_profile_update_expression postgres "alter policy \"Users can update their own profile\" on public.user_profiles using (true)" "$REVIEWED" \
  "alter policy \"Users can update their own profile\" on public.user_profiles using ((auth.uid() = user_id))"
mon P2_policy_roles postgres "alter policy \"Users can view their own orders\" on public.orders to anon" "$REVIEWED" \
  "alter policy \"Users can view their own orders\" on public.orders to public"
mon P3_broad_select_uid postgres "create policy p1c_probe_read on public.user_profiles for select to authenticated using (auth.uid() is not null)" \
  "policy not reviewed" "drop policy p1c_probe_read on public.user_profiles"
mon P3_broad_select_1eq1 postgres "create policy p1c_probe_read on public.orders for select to authenticated using (1 = 1)" \
  "policy not reviewed" "drop policy p1c_probe_read on public.orders"
mon P4_view postgres "create view public.p1c_v_profiles as select * from public.user_profiles; grant select on public.p1c_v_profiles to authenticated" \
  "view / materialized view / foreign table accessible" "drop view public.p1c_v_profiles"
mon P4_security_invoker_view postgres "create view public.p1c_v_orders with (security_invoker = true) as select * from public.orders; grant select on public.p1c_v_orders to authenticated" \
  "view / materialized view / foreign table accessible" "drop view public.p1c_v_orders"
mon P4_matview postgres "create materialized view public.p1c_mv_orders as select * from public.orders; grant select on public.p1c_mv_orders to authenticated" \
  "view / materialized view / foreign table accessible" "drop materialized view public.p1c_mv_orders"
mon P4_foreign_table supabase_admin "create foreign data wrapper p1c_fdw; create server p1c_srv foreign data wrapper p1c_fdw; create foreign table public.p1c_ft (x int) server p1c_srv; grant select on public.p1c_ft to authenticated" \
  "view / materialized view / foreign table accessible" "drop foreign table public.p1c_ft; drop server p1c_srv; drop foreign data wrapper p1c_fdw"
mon P4_unreviewed_schema postgres "create schema p1c_api; grant usage on schema p1c_api to anon; create table p1c_api.t (x int); grant select on p1c_api.t to anon" \
  "client-accessible relation in a schema that is not reviewed" "drop schema p1c_api cascade"
mon P7_extra_definer postgres "create function public.p1c_dump() returns setof public.user_profiles language sql security definer set search_path = '' as 'select * from public.user_profiles'; grant execute on function public.p1c_dump() to authenticated" \
  "SECURITY DEFINER function executable by a client role is not reviewed" "drop function public.p1c_dump()"
mon P7_definer_other_schema postgres "create schema p1c_fn; grant usage on schema p1c_fn to authenticated; create function p1c_fn.dump() returns bigint language sql security definer set search_path = '' as 'select count(*) from public.user_profiles'; grant execute on function p1c_fn.dump() to authenticated" \
  "SECURITY DEFINER function executable by a client role is not reviewed" "drop schema p1c_fn cascade"
mon P6_auth_hook_public supabase_admin "create schema p1c_hooks; create function p1c_hooks.custom_access_token(e jsonb) returns jsonb language sql as 'select e'; grant execute on function p1c_hooks.custom_access_token(jsonb) to public" \
  "effectively executable by supabase_auth_admin" "drop schema p1c_hooks cascade"
mon L1_truncate_grant postgres "grant truncate on public.orders to authenticated" "privilege that RLS does not govern" "revoke truncate on public.orders from authenticated"
mon L1_trigger_grant postgres "grant trigger, references on public.meals to authenticated" "privilege that RLS does not govern" "revoke trigger, references on public.meals from authenticated"
mon L1_service_truncate_audit postgres "grant truncate on public.security_audit_log to service_role" "TRUNCATE on an authority or append-only table" \
  "revoke truncate on public.security_audit_log from service_role"
mon L2_no_active_admin supabase_admin "set session_replication_role = replica; update public.staff_roles set is_active = false where role = 'admin'" \
  "no active admin staff role" "set session_replication_role = replica; update public.staff_roles set is_active = true where role = 'admin' and user_id = '$INITIAL_ADMIN'"
mon L2_guard_trigger_disabled postgres "alter table public.staff_roles disable trigger trg_staff_roles_require_admin" "required guard trigger missing or disabled" \
  "alter table public.staff_roles enable trigger trg_staff_roles_require_admin"
mon L3_unapproved_online supabase_admin "set session_replication_role = replica; update public.drivers set status = 'online' where id = '00000000-0000-0000-0000-0000000000d2'" \
  "driver online without an active driver approval" "update public.drivers set status = 'offline' where id = '00000000-0000-0000-0000-0000000000d2'"
mon P2_nullable_status postgres "alter table public.drivers alter column status drop not null" "drivers.status allows NULL" \
  "alter table public.drivers alter column status set not null"
# a reviewed migration function weakened with CREATE OR REPLACE (same name and signature)
q postgres -c "create or replace function public.has_staff_role(p_role text) returns boolean language sql stable security definer set search_path = '' as \$\$ select true \$\$" >/dev/null
[ "$(qa "select count(*) from public.containment_violations() where object = 'public.has_staff_role(text)' and strpos(problem, 'reviewed function changed') > 0")" = "1" ] \
  && pass "monitor P7_weakened_reviewed_function: reported ('reviewed function changed')" || { fail "weakened has_staff_role not reported"; qa "select * from public.containment_violations()"; }
migrate m_restore || { fail "re-apply to restore has_staff_role failed"; cat "$OUT/m_restore.log"; }
clean_m && pass "re-applying the migration restores the reviewed function; 0 violations" || fail "not clean after restore"

echo "  -- concurrent admin revocations (L2): two admins revoke each other at the same time"
as_user() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) is not null;"; }
F1=00000000-0000-0000-0000-0000000000f1
q postgres -c "$(as_user "$INITIAL_ADMIN") select public.assign_staff_role('$F1', 'admin');" >/dev/null
[ "$(qa "select count(*) from public.staff_roles where role = 'admin' and is_active")" = "2" ] || fail "second admin not assigned"
( q postgres -c "$(as_user "$INITIAL_ADMIN") begin; select public.revoke_staff_role('$F1', 'admin'); select pg_sleep(3); commit;" > "$OUT/l2_s1.log" 2>&1; echo "exit=$?" >> "$OUT/l2_s1.log" ) &
sleep 1
( q postgres -c "$(as_user "$F1") begin; select public.revoke_staff_role('$INITIAL_ADMIN', 'admin'); commit;" > "$OUT/l2_s2.log" 2>&1; echo "exit=$?" >> "$OUT/l2_s2.log" ) &
wait
N_ADM="$(qa "select count(*) from public.staff_roles where role = 'admin' and is_active")"
N_ERR="$(cat "$OUT/l2_s1.log" "$OUT/l2_s2.log" | grep -c -E "cannot revoke the last active admin|at least one active admin|only an admin may revoke")"
[ "$N_ADM" = "1" ] && [ "$N_ERR" = "1" ] \
  && pass "concurrent revocations are serialized: exactly one succeeds, the other is refused; 1 active admin remains" \
  || { fail "concurrent revocation: active admins=$N_ADM, refused=$N_ERR"; cat "$OUT/l2_s1.log" "$OUT/l2_s2.log"; }
clean_m && pass "0 violations after the concurrent revocations" || { fail "violations after concurrency test"; qa "select * from public.containment_violations()"; }

echo; echo "=== G. ROLLBACK core (re-opens the vulnerabilities by design)"
start_db g; setup
q postgres -f "$MATRIX" > "$OUT/matrix_g_before.txt"
D4=00000000-0000-0000-0000-0000000000d4
q supabase_admin -c "update public.drivers set status = null where id = '$D4'" >/dev/null   # a NULL legacy status
DRV_BEFORE="$(qa "select string_agg(id || '=' || coalesce(status, '<null>'), ',' order by id) from public.drivers")"
migrate g || { fail "migration failed"; cat "$OUT/g.log"; }
[ "$(qa "select d.status = 'offline' and exists (select 1 from public.security_audit_log l where l.action = 'drivers.status.normalised' and l.target_user_id = d.id and l.details -> 'old_status' = 'null'::jsonb) from public.drivers d where d.id = '$D4'")" = "t" ] \
  && pass "a NULL drivers.status is normalised to offline and its previous value (NULL) is audited" || fail "NULL driver status not normalised/audited"
N_AUD="$(qa 'select count(*) from public.security_audit_log')"; N_SR="$(qa 'select count(*) from public.staff_roles')"; N_K="$(qa 'select count(*) from public.kitchens')"
if q postgres -f "$DOWN" > "$OUT/g_down.log" 2>&1; then pass "rollback applied"; else fail "rollback failed"; cat "$OUT/g_down.log"; fi
ARCH="$(qa "select string_agg(nspname, ',') from pg_namespace where nspname like 'phase1c_archive_%'")"
if [ -n "$ARCH" ] && [ "${ARCH#*,}" = "$ARCH" ] \
   && [ "$(qa "select count(*) from $ARCH.security_audit_log")" = "$N_AUD" ] && [ "$(qa "select count(*) from $ARCH.staff_roles")" = "$N_SR" ] \
   && [ "$(qa "select count(*) from $ARCH.kitchens")" = "$N_K" ]; then
  pass "rollback ARCHIVES kitchens, staff_roles and security_audit_log in $ARCH with every row ($N_K / $N_SR / $N_AUD)"
else fail "archive missing or rows lost (archive=$ARCH)"; fi
[ "$(qa "select bool_or(has_schema_privilege(r, '$ARCH', 'USAGE')) from unnest(array['anon','authenticated','service_role']) r")" = "f" ] \
  && pass "archive schema is not usable by anon, authenticated or service_role" || fail "archive schema is accessible"
q postgres -f "$MATRIX" > "$OUT/matrix_rollback.txt"
diff -q "$OUT/matrix_g_before.txt" "$OUT/matrix_rollback.txt" >/dev/null \
  && pass "rollback restores the exact BEFORE policy/grant/function/default-privilege matrix" \
  || { fail "rollback matrix differs"; diff "$OUT/matrix_g_before.txt" "$OUT/matrix_rollback.txt" || true; }
DRV_AFTER="$(qa "select string_agg(id || '=' || coalesce(status, '<null>'), ',' order by id) from public.drivers")"
[ "$DRV_BEFORE" = "$DRV_AFTER" ] && pass "legacy drivers.status values (incl. NULL) restored from the audit log" || fail "driver statuses not restored: $DRV_AFTER"
diff -q "$OUT/matrix_before.txt" "$OUT/matrix_g_before.txt" >/dev/null && pass "BEFORE matrices of A and G identical (deterministic setup)" || fail "A/G before matrices differ"

echo; echo "=== S. real Supabase Storage API (meal-images)"
if python3 -I -B "$HERE/tooling_unit_tests.py" > "$OUT/tooling_unit.txt" 2>&1; then pass "tooling unit tests: object paths are percent-encoded per segment (space, ?, #, %, /, unicode)"
else fail "tooling unit tests"; cat "$OUT/tooling_unit.txt"; fi
if ! docker image inspect "$STORAGE_IMAGE" >/dev/null 2>&1 && ! docker pull -q "$STORAGE_IMAGE" >/dev/null 2>&1; then
  fail "BLOCKED: storage-api image $STORAGE_IMAGE unavailable; storage containment NOT verified"
else
  docker network create "$NET" >/dev/null
  start_db s "$NET"
  q supabase_admin -c "alter role supabase_storage_admin password 'postgres'" >/dev/null   # local container only
  eval "$(python3 -I - <<'PY'
import base64, hashlib, hmac, json, secrets, time
sec = secrets.token_hex(32)
b = lambda x: base64.urlsafe_b64encode(x).rstrip(b'=').decode()
def jwt(p):
    h = b(json.dumps({'alg': 'HS256', 'typ': 'JWT'}).encode()); body = b(json.dumps(p).encode())
    return h + '.' + body + '.' + b(hmac.new(sec.encode(), (h + '.' + body).encode(), hashlib.sha256).digest())
exp = int(time.time()) + 3600
print(f"export JWT_SECRET={sec} ANON_KEY={jwt({'role': 'anon', 'exp': exp})} SERVICE_KEY={jwt({'role': 'service_role', 'exp': exp})}")
PY
)"
  SAPI="p1c-sapi-$$"
  docker run -d --name "$SAPI" --network "$NET" -p 127.0.0.1::5000 \
    -e ANON_KEY="$ANON_KEY" -e SERVICE_KEY="$SERVICE_KEY" -e AUTH_JWT_SECRET="$JWT_SECRET" -e PGRST_JWT_SECRET="$JWT_SECRET" \
    -e AUTH_JWT_ALGORITHM=HS256 -e DATABASE_URL="postgres://supabase_storage_admin:postgres@$DBNAME:5432/postgres" \
    -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=local \
    -e GLOBAL_S3_BUCKET=stub -e FILE_SIZE_LIMIT=52428800 -e ENABLE_IMAGE_TRANSFORMATION=false -e SERVER_PORT=5000 \
    "$STORAGE_IMAGE" >/dev/null
  CONTAINERS+=("$SAPI")
  export STORAGE_URL="http://127.0.0.1:$(docker port "$SAPI" 5000/tcp | head -1 | sed 's/.*://')"
  for _ in $(seq 1 60); do curl -sf "$STORAGE_URL/status" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "$STORAGE_URL/status" >/dev/null && pass "storage-api up; its own migrations created the storage schema ($(qa 'select count(*) from storage.migrations') migrations)" \
    || fail "storage-api did not start"
  setup   # baseline now also creates the 4 staging storage.objects policies verbatim
  for b in '{"id":"meal-images","name":"meal-images","public":true}' '{"id":"src","name":"src","public":false}'; do
    curl -s -o /dev/null -X POST "$STORAGE_URL/bucket" -H "Authorization: Bearer $SERVICE_KEY" -H 'Content-Type: application/json' -d "$b"
  done
  [ "$(preflight ALL)" = "True" ] && pass "read-only preflight incl. storage checks: all required checks ok (staging storage reproduced)" \
    || { fail "full preflight not ok in storage scenario"; cat "$OUT/preflight.json"; }
  q postgres -f "$MATRIX" > "$OUT/matrix_s_before.txt"
  "$STORAGE_TESTS" seed
  RUN_ID=before "$STORAGE_TESTS" check > "$OUT/storage_before.txt" || true
  "$STORAGE_TESTS" seed   # the BEFORE run deleted the seed object (that is the hole); re-seed while still vulnerable
  echo "  BEFORE (staging storage policies):$(tail -1 "$OUT/storage_before.txt" | sed 's/.*storage API://')  <- failures document the open upload hole"
  grep -E "FAIL S" "$OUT/storage_before.txt" | sed 's/^/    /'
  bucket_state() { qa "select public || ':' || coalesce(file_size_limit::text, 'NULL') || ':' || coalesce(allowed_mime_types::text, 'NULL') from storage.buckets where id = 'meal-images'"; }
  migrate s_core || { fail "core migration failed"; cat "$OUT/s_core.log"; }
  [ "$(qa "select count(*) filter (where strpos(problem, 'storage policy not reviewed') > 0) || '/' || count(*) filter (where problem = 'reviewed storage policy missing') || '/' || count(*) filter (where strpos(problem, 'size/MIME limits') > 0) || '/' || count(*) from public.containment_violations() where category = 'storage'")" = "4/4/1/9" ] \
    && pass "after core only: containment_violations() reports the 4 staging storage policies as unreviewed, the 4 reviewed ones as missing and the bucket limits; containment not complete" \
    || { fail "storage violations after core not as expected"; qa "select * from public.containment_violations() where category = 'storage'"; }
  # Storage guards: each unexpected bucket state is injected in the SAME transaction as the
  # migration, so the abort rolls back the injection too; nothing may persist.
  BUCKET_BEFORE="$(bucket_state)"; POL_BEFORE="$(qa "select count(*) from pg_policies where schemaname = 'storage'")"
  sguard() {
    printf '%s\n\\i %s\n' "$2" "$MIG_S" > "$OUT/sguard_$1.sql"
    # test scaffolding: the injection and the migration run in ONE outer transaction so the
    # injected state is rolled back together with the aborted migration
    if q postgres --single-transaction -f "$OUT/sguard_$1.sql" > "$OUT/sguard_$1.log" 2>&1; then fail "storage guard $1: migration did not abort"
    elif grep -q "$3" "$OUT/sguard_$1.log" && [ "$(bucket_state)" = "$BUCKET_BEFORE" ] \
         && [ "$(qa "select count(*) from pg_policies where schemaname = 'storage'")" = "$POL_BEFORE" ]; then
      pass "storage guard $1: migration aborted ($3); bucket and policies unchanged"
    else fail "storage guard $1: wrong error or partial application"; cat "$OUT/sguard_$1.log"; fi
  }
  sguard missing_bucket "set storage.allow_delete_query = 'true'; delete from storage.objects where bucket_id = 'meal-images'; delete from storage.buckets where id = 'meal-images';" \
    "bucket meal-images missing"
  sguard unexpected_limits "update storage.buckets set file_size_limit = 1048576 where id = 'meal-images';" "unexpected limits"
  sguard unexpected_types "update storage.buckets set allowed_mime_types = array['image/png'] where id = 'meal-images';" "unexpected limits"
  sguard not_public "update storage.buckets set public = false where id = 'meal-images';" "is not public"
  [ "$BUCKET_BEFORE" = "true:NULL:NULL" ] && pass "bucket before migration matches evidence: public, file_size_limit NULL, allowed_mime_types NULL" \
    || fail "unexpected bucket state before migration: $BUCKET_BEFORE"
  OBJ_BEFORE="$(qa "select count(*) || ':' || coalesce(string_agg(name, ',' order by name), '') from storage.objects where bucket_id = 'meal-images'")"
  if migrate s_storage "$MIG_S"; then pass "storage migration applied"; else fail "storage migration failed"; cat "$OUT/s_storage.log"; fi
  [ "$(bucket_state)" = "true:5242880:{image/jpeg,image/png,image/webp}" ] \
    && pass "bucket configured: public kept, file_size_limit 5242880, allowed_mime_types {image/jpeg,image/png,image/webp}" \
    || fail "bucket after migration: $(bucket_state)"
  [ "$(qa "select count(*) || ':' || coalesce(string_agg(name, ',' order by name), '') from storage.objects where bucket_id = 'meal-images'")" = "$OBJ_BEFORE" ] \
    && pass "existing objects preserved ($OBJ_BEFORE)" || fail "objects changed by the migration"
  q postgres -At -f "$PREFLIGHT" > "$OUT/preflight_s_after.json" 2>/dev/null || true
  echo "  info: preflight inventory of pre-existing objects (not re-validated by the new limits): $(python3 -I -c "import json,sys
d = json.load(open(sys.argv[1]))
print(next(c['detail'] for c in d['checks'] if c['check'].startswith('info: existing meal-images objects')))" "$OUT/preflight_s_after.json")"
  [ "$(qa "select count(*) = 1 and bool_and(details -> 'old_file_size_limit' = 'null'::jsonb and details -> 'old_allowed_mime_types' = 'null'::jsonb) from public.security_audit_log where action = 'storage.bucket.limits_set'")" = "t" ] \
    && pass "previous bucket values recorded in security_audit_log as JSON null (were SQL NULL)" || fail "bucket audit record missing or wrong"
  if RUN_ID=after "$STORAGE_TESTS" check > "$OUT/storage_after.txt"; then pass "all Storage API checks pass"; else fail "Storage API checks failing"; fi
  sed 's/^/  /' "$OUT/storage_after.txt"
  [ "$(qa 'select count(*) from public.containment_violations()')" = "0" ] && pass "containment_violations() = 0 rows (drift, containment, storage)" \
    || { fail "violations remain"; qa 'select * from public.containment_violations()'; }
  smon() {  # smon NAME "inject" "fragment" "revert"  (storage policy regressions)
    q postgres -c "$2" >/dev/null 2>"$OUT/smon_$1.err" || { fail "storage monitor $1: injection failed"; cat "$OUT/smon_$1.err"; return; }
    [ "$(echo "select count(*) from public.containment_violations() where category = 'storage' and strpos(problem, :'frag') > 0" | q postgres -At -v frag="$3")" -ge 1 ] \
      && pass "storage monitor $1: reported ('$3')" || { fail "storage monitor $1: NOT reported"; qa "select * from public.containment_violations()"; }
    q postgres -c "$4" >/dev/null
    [ "$(qa 'select count(*) from public.containment_violations()')" = "0" ] || { fail "storage monitor $1: not clean after revert"; qa 'select * from public.containment_violations()'; }
  }
  SADM="((bucket_id = 'meal-images'::text) AND ( SELECT public.has_staff_role('admin'::text) AS has_staff_role))"
  smon weakened_insert "alter policy staff_admin_insert_meal_images on storage.objects with check (((bucket_id = 'meal-images') and (select public.has_staff_role('admin'))) or true)" \
    "differ from the reviewed definition" "alter policy staff_admin_insert_meal_images on storage.objects with check $SADM"
  smon private_bucket_select "create policy p1c_probe_src_read on storage.objects for select to public using (bucket_id = 'src')" \
    "storage policy not reviewed" "drop policy p1c_probe_src_read on storage.objects"
  smon public_listing_readded "create policy \"Public Access\" on storage.objects for select to public using (bucket_id = 'meal-images')" \
    "storage policy not reviewed" "drop policy \"Public Access\" on storage.objects"
  smon bucket_metadata_write "create policy p1c_probe_bucket_write on storage.buckets for update to authenticated using (true)" \
    "storage policy not reviewed" "drop policy p1c_probe_bucket_write on storage.buckets"
  q postgres -f "$TESTS" > "$OUT/tests_storage_env.txt"
  echo "  SQL tests with storage schema present: $(summary)"; [ "$(nfail)" = "0" ] || fail "SQL tests failing in storage scenario"
  q postgres -f "$MATRIX" > "$OUT/matrix_s_after.txt"

  echo "  -- existing objects: per-object inventory, content scan, browser serving, reversible quarantine (all local)"
  q postgres -At -f "$INVENTORY" > "$OUT/inventory.json"
  N_DB="$(qa "select count(*) from storage.objects where bucket_id = 'meal-images'")"
  N_INV="$(python3 -I -c "import json,sys; print(len(json.load(open(sys.argv[1]))['objects']))" "$OUT/inventory.json")"
  [ "$N_DB" = "$N_INV" ] && pass "read-only inventory lists all $N_INV objects (id, path, declared type, size, timestamps, backend ETag, uploader class)" \
    || fail "inventory lists $N_INV of $N_DB objects"
  grep -q '00000000-0000-0000-0000-0000000000' "$OUT/inventory.json" && fail "inventory exposes user ids" || pass "inventory contains no user ids (uploader reported as a class only)"
  if python3 -I "$SCAN" --inventory "$OUT/inventory.json" --base-url "$STORAGE_URL" --download-dir "$OUT/scan_dl" --report "$OUT/scan.json" > "$OUT/scan.txt"; then
    sed 's/^/  /' "$OUT/scan.txt"
  else fail "content scan did not complete"; cat "$OUT/scan.txt"; fi
  if python3 -I - "$OUT/scan.json" > "$OUT/scan_assert.txt" <<'PY'
import json, sys
res = {r["path"]: r for r in json.load(open(sys.argv[1]))["results"]}
must_be_ok = {"before-ok.webp", "before-exact.png", "after-ok.png", "after-ok.webp", "after-exact.png"}
expect = {   # path -> reasons that MUST be reported (others may be reported too)
  "seed-svg-as-png.png": {"detected_format_not_approved", "type_mismatch", "non_staff_uploader"},
  "seed-truncated.png": {"decode_failure", "non_staff_uploader"},
  "seed-bomb.png": {"pixel_limit_exceeded", "non_staff_uploader"},
  "seed-customer.png": {"non_staff_uploader"},
  "seed-polyglot.png": {"embedded_markup", "non_staff_uploader"},
  "seed-jpeg-as-png.png": {"type_mismatch", "non_staff_uploader"},
  "seed space.png": {"non_staff_uploader"},                   # name with a space (URL-encoded fetch)
  "seed?q.png": {"detected_format_not_approved", "type_mismatch", "non_staff_uploader"},  # '?' in the name
  "before-customer-new.png": {"non_staff_uploader"},
  "before-flagged.png": {"non_staff_uploader"},
  "before-ok.png": {"declared_type_not_approved", "detected_format_not_approved", "extension_mismatch"},  # overwritten with SVG while open
  "before-bad.svg": {"declared_type_not_approved", "detected_format_not_approved"},
  "before-bad.gif": {"declared_type_not_approved", "detected_format_not_approved"},
  "before-bad.html": {"declared_type_not_approved", "detected_format_not_approved"},
  "before-bad.bin": {"declared_type_not_approved", "type_mismatch"},
  "before-over.png": {"over_5_mib"},
}
bad = []
for path, r in res.items():
    if path in must_be_ok:
        if r["status"] != "ok": bad.append(f"{path}: expected ok, got {r['reasons']}")
    elif path in expect:
        missing = expect[path] - set(r["reasons"])
        if r["status"] != "suspicious" or missing: bad.append(f"{path}: missing reasons {sorted(missing)}")
    else:
        bad.append(f"{path}: unexpected object in bucket")
for path in set(must_be_ok) | set(expect):
    if path not in res: bad.append(f"{path}: not in inventory")
for path, r in res.items():   # served headers recorded for every object; locally none carries nosniff (documented)
    sh = r.get("served_headers") or {}
    if sh.get("content-type", "absent") == "absent": bad.append(f"{path}: served headers not recorded")
    if sh.get("x-content-type-options", "absent").lower() == "nosniff": bad.append(f"{path}: nosniff present; update the docs")
print("\n".join(bad) if bad else f"all {len(res)} objects classified as expected")
sys.exit(1 if bad else 0)
PY
  then pass "content scan: $(cat "$OUT/scan_assert.txt") (signatures + full decode; decode failure, pixel bomb, mislabelled, disallowed, oversize and non-staff uploads detected)"
  else fail "content scan classification wrong"; cat "$OUT/scan_assert.txt"; fi

  if ! NODE_PATH="${NODE_PATH:-/opt/node-tools/node_modules}" node -e "require('playwright')" 2>/dev/null; then
    fail "BLOCKED: Playwright not available; browser serving behaviour NOT verified"
  elif NODE_PATH="${NODE_PATH:-/opt/node-tools/node_modules}" node "$BROWSER_TESTS" "$STORAGE_URL" \
       before-bad.svg=executes seed-svg-as-png.png=inert before-bad.html=inert after-ok.png=inert > "$OUT/browser.txt" 2>&1; then
    pass "browser serving behaviour matches the documented observations"; grep -v '^  headers' "$OUT/browser.txt" | sed 's/^/  /'
  else fail "browser serving behaviour differs from the documentation"; cat "$OUT/browser.txt"; fi
  grep -q "nosniff=absent" "$OUT/browser.txt" && echo "  info: X-Content-Type-Options: nosniff is NOT returned by the Storage API (local v1.79.30)"

  # names that mean something in a URL: the scan must have hashed exactly these objects
  for nm in "seed space.png" "seed?q.png"; do
    enc="$(python3 -I -c "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" "$nm")"
    want="$(curl -s "$STORAGE_URL/object/meal-images/$enc" -H "Authorization: Bearer $SERVICE_KEY" | sha256sum | cut -d' ' -f1)"
    got="$(python3 -I -c "import json,sys; print(next(r.get('sha256') for r in json.load(open(sys.argv[1]))['results'] if r['path'] == sys.argv[2]))" "$OUT/scan.json" "$nm")"
    [ "$want" = "$got" ] && pass "scan fetched exactly the object named '$nm' (URL-encoded; SHA-256 equals the authenticated download)" \
      || fail "scan hashed the wrong bytes for '$nm' ($got vs $want)"
  done
  [ "$(qa "select count(*) from storage.objects where bucket_id = 'meal-images' and name like 'seed#%'")" = "0" ] \
    && pass "Storage API v1.79.30 refuses '#' in object keys (InvalidKey); '#' and '%' are covered by the offline unit tests" \
    || fail "an object with '#' exists; extend the end-to-end tests"

  export SERVICE_KEY
  QM="$OUT/quarantine_manifest.json"
  python3 -I "$QUARANTINE" plan --scan-report "$OUT/scan.json" --manifest "$QM" > "$OUT/q.txt"
  python3 -I "$QUARANTINE" copy --manifest "$QM" --base-url "$STORAGE_URL" --confirm-copy >> "$OUT/q.txt" \
    && python3 -I "$QUARANTINE" verify --manifest "$QM" --base-url "$STORAGE_URL" >> "$OUT/q.txt" \
    && pass "quarantine copy: every suspicious object copied to the PRIVATE bucket with a metadata sidecar; SHA-256 verified" \
    || { fail "quarantine copy/verify failed"; cat "$OUT/q.txt"; }
  [ "$(curl -s "$STORAGE_URL/bucket/meal-images-quarantine" -H "Authorization: Bearer $SERVICE_KEY" | python3 -I -c "import json,sys; print(json.load(sys.stdin)['public'])")" = "False" ] \
    && [ "$(curl -s -o /dev/null -w '%{http_code}' "$STORAGE_URL/object/public/meal-images-quarantine/before-bad.svg")" != "200" ] \
    && pass "quarantine bucket is private (public URL does not serve)" || fail "quarantine bucket is publicly readable"
  qsha() { python3 -I -c "import json,sys; print(next((e['sha256'] for e in json.load(open(sys.argv[1]))['entries'] if e['path'] == sys.argv[2]), 'none'))" "$QM" "$1"; }
  qfield() { python3 -I -c "import json,sys; print(next(e.get(sys.argv[3]) for e in json.load(open(sys.argv[1]))['entries'] if e['path'] == sys.argv[2]))" "$QM" "$1" "$2"; }
  n_obj() { qa "select count(*) from storage.objects where bucket_id = 'meal-images'"; }
  has_obj() { [ "$(echo "select count(*) from storage.objects where bucket_id = 'meal-images' and name = :'n'" | q postgres -At -v n="$1")" = "1" ]; }
  rm_one() { python3 -I "$QUARANTINE" remove --manifest "$QM" --base-url "${QBASE:-$STORAGE_URL}" --approved-by local-harness "$@"; }
  N0="$(n_obj)"
  rm_one --path before-bad.svg --sha256 "$(qsha before-bad.svg)" >/dev/null 2>&1 && fail "remove ran without --confirm-remove" \
    || pass "remove refuses to run without --confirm-remove"
  rm_one --path before-bad.svg --confirm-remove >/dev/null 2>&1 && fail "remove ran without --sha256" || pass "remove refuses to run without the object's --sha256"
  rm_one --path before-ok.webp --sha256 x --confirm-remove >> "$OUT/q.txt" 2>&1 && fail "a scan-clean image not in the manifest was removed" \
    || pass "remove refuses an object that is not a manifest entry (a scan-clean image)"
  rm_one --path before-bad.svg --sha256 0000 --confirm-remove >> "$OUT/q.txt" 2>&1 && fail "remove accepted a wrong SHA-256" \
    || pass "remove refuses when --sha256 does not match the scanned bytes"
  rm_one --path seed-customer.png --sha256 "$(qsha seed-customer.png)" --confirm-remove >> "$OUT/q.txt" 2>&1 && fail "provenance-only entry removed without its flag" \
    || pass "remove refuses a provenance-only entry (valid image, non-staff uploader) without --allow-provenance-only"
  [ "$(n_obj)" = "$N0" ] && pass "every refused removal left the public bucket unchanged ($N0 objects)" || fail "a refused removal changed the bucket"
  if rm_one --path before-bad.svg --sha256 "$(qsha before-bad.svg)" --confirm-remove >> "$OUT/q.txt" 2>&1 \
     && ! has_obj before-bad.svg && [ "$(n_obj)" = "$((N0 - 1))" ] && has_obj before-bad.gif && has_obj seed-polyglot.png; then
    pass "single-object removal: only before-bad.svg removed; other suspicious objects (mixed set) still present"
  else fail "single-object removal wrong"; cat "$OUT/q.txt"; fi
  [ "$(qfield before-bad.svg removal_verified_via)" = "authenticated Storage API (object not found)" ] \
    && pass "removal verified through the authenticated Storage API" || fail "removal not verified through the authenticated API"
  # A CDN in front of the public URL: a local caching proxy keeps serving the deleted object.
  PPORT="$(python3 -I -c "import socket; s = socket.socket(); s.bind(('127.0.0.1', 0)); print(s.getsockname()[1])")"
  python3 -I "$HERE/caching_proxy.py" "$PPORT" "$STORAGE_URL" & PROXY_PID=$!
  for _ in $(seq 1 20); do curl -sf "http://127.0.0.1:$PPORT/status" >/dev/null 2>&1 && break; sleep 0.5; done
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PPORT/object/public/meal-images/seed%20space.png")" = "200" ] || fail "proxy cache warm-up failed"
  if QBASE="http://127.0.0.1:$PPORT" rm_one --path "seed space.png" --sha256 "$(qsha "seed space.png")" --confirm-remove --allow-provenance-only > "$OUT/q_cdn.txt" 2>&1 \
     && grep -q "WARNING public URL still returns HTTP 200" "$OUT/q_cdn.txt" && ! has_obj "seed space.png" \
     && [ "$(qfield "seed space.png" public_url_still_served)" = "True" ]; then
    pass "cached public URL (CDN stand-in): deletion verified via the authenticated API; the still-served public URL is reported as a warning, not as success"
  else fail "cached public URL case wrong"; cat "$OUT/q_cdn.txt"; fi
  kill "$PROXY_PID" 2>/dev/null || true; wait "$PROXY_PID" 2>/dev/null || true
  cat "$OUT/q_cdn.txt" >> "$OUT/q.txt"
  # every remaining entry, one named object at a time (CTO approval per object on staging)
  for path in $(python3 -I -c "import json,sys,urllib.parse; print(' '.join(urllib.parse.quote(e['path']) for e in json.load(open(sys.argv[1]))['entries'] if not e.get('removed_from_public_at')))" "$QM"); do
    path="$(python3 -I -c "import sys,urllib.parse; print(urllib.parse.unquote(sys.argv[1]))" "$path")"
    flag=""; [ "$(qfield "$path" provenance_only)" = "True" ] && flag="--allow-provenance-only"
    rm_one --path "$path" --sha256 "$(qsha "$path")" --confirm-remove $flag >> "$OUT/q.txt" 2>&1 || fail "remove $path failed"
  done
  [ "$(n_obj)" = "5" ] && pass "after per-object removals the public bucket holds only the 5 objects that passed the scan" \
    || fail "unexpected objects remain: $(qa "select string_agg(name, ',') from storage.objects where bucket_id = 'meal-images'")"
  rs() { local rc=0; python3 -I "$QUARANTINE" restore --manifest "$QM" --base-url "$STORAGE_URL" --confirm-restore "$@" >> "$OUT/q.txt" 2>&1 || rc=$?; echo "$rc"; }
  [ "$(rs --path seed-customer.png)" = "0" ] && has_obj seed-customer.png \
    && pass "restore: a valid PNG is restored byte-identical (exit 0)" || fail "valid restore failed"
  [ "$(rs --path before-bad.svg)" = "3" ] && ! has_obj before-bad.svg \
    && pass "restore: an SVG is refused by the bucket limits (415), stays quarantined, exit 3 (refused, not failed)" || fail "SVG restore result wrong"
  [ "$(rs --path seed-customer.png)" = "1" ] && grep -q "seed-customer.png: failed (an object already exists" "$OUT/q.txt" \
    && pass "restore: an object already present is NOT overwritten and is reported as a failure (exit 1)" || fail "duplicate restore not reported as failure"
  [ "$(rs --path seed-truncated.png --path no-such-object.png)" = "1" ] && has_obj seed-truncated.png \
    && grep -q "no-such-object.png: failed (path is not an entry" "$OUT/q.txt" \
    && pass "restore: mixed request restores the valid entry and reports the unknown path as a failure (exit 1)" || fail "mixed restore wrong"
  grep -q "$SERVICE_KEY" "$QM" && fail "service key written to the manifest" || pass "manifest contains no credentials"
  sed 's/^/  /' "$OUT/q.txt"
  [ "$(qa 'select count(*) from public.containment_violations()')" = "0" ] && pass "containment_violations() still 0 rows with the private quarantine bucket present" \
    || { fail "violations after quarantine"; qa 'select * from public.containment_violations()'; }
  # test cleanup only (local): remove the quarantine bucket so the rollback comparison below stays exact
  curl -s -o /dev/null -X POST "$STORAGE_URL/bucket/meal-images-quarantine/empty" -H "Authorization: Bearer $SERVICE_KEY"
  curl -s -o /dev/null -X DELETE "$STORAGE_URL/bucket/meal-images-quarantine" -H "Authorization: Bearer $SERVICE_KEY"
  [ "$(qa "select count(*) from storage.buckets where id = 'meal-images-quarantine'")" = "0" ] || fail "local quarantine bucket cleanup failed"
  if migrate s_storage2 "$MIG_S"; then pass "storage migration re-apply clean"; else fail "storage re-apply failed"; cat "$OUT/s_storage2.log"; fi
  [ "$(qa "select count(*) from public.security_audit_log where action = 'storage.bucket.limits_set'")" = "1" ] && [ "$(bucket_state)" = "true:5242880:{image/jpeg,image/png,image/webp}" ] \
    && pass "re-apply changed nothing (bucket unchanged, no second audit record)" || fail "re-apply changed the bucket or logged again"
  if q postgres -f "$DOWN" > "$OUT/s_down_wrong_order.log" 2>&1; then fail "core rollback ran before storage rollback"
  else grep -q "run supabase/rollback/20261016171000" "$OUT/s_down_wrong_order.log" && pass "core rollback refuses to run before the storage rollback" || fail "core rollback: wrong error"; fi
  if q postgres -f "$DOWN_S" > "$OUT/s_down_s.log" 2>&1; then pass "storage rollback applied"; else fail "storage rollback failed"; cat "$OUT/s_down_s.log"; fi
  [ "$(qa "select public and file_size_limit is null and allowed_mime_types is null from storage.buckets where id = 'meal-images'")" = "t" ] \
    && pass "storage rollback restores the exact original bucket settings (public; file_size_limit IS NULL; allowed_mime_types IS NULL)" \
    || fail "bucket not restored exactly: $(bucket_state)"
  if q postgres -f "$DOWN" > "$OUT/s_down.log" 2>&1; then pass "core rollback applied"; else fail "core rollback failed"; cat "$OUT/s_down.log"; fi
  [ "$(preflight storage_objects_policies_match_evidence)" = "True" ] && pass "storage rollback restores the verbatim staging storage policies" || fail "storage policies not restored"
  [ "$(preflight storage_buckets_match_evidence)" = "True" ] && pass "preflight bucket check matches the evidence again after rollback" || fail "preflight bucket check not restored"
  q postgres -f "$MATRIX" > "$OUT/matrix_s_rollback.txt"
  diff -q "$OUT/matrix_s_before.txt" "$OUT/matrix_s_rollback.txt" >/dev/null && pass "full rollback restores the exact BEFORE matrix (incl. storage policies and bucket settings)" \
    || { fail "storage-scenario rollback matrix differs"; diff "$OUT/matrix_s_before.txt" "$OUT/matrix_s_rollback.txt" || true; }
fi

echo
if [ "$STATUS" = "0" ]; then echo "RESULT: ALL PHASE 1C LOCAL CHECKS PASSED"; else echo "RESULT: SOME PHASE 1C CHECKS FAILED"; fi
exit $STATUS
