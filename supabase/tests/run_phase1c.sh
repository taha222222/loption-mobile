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
# Exit 0 only if every check below passes.
#
#   A  baseline round-trip vs evidence; read-only preflight (non-storage
#      checks) passes; BEFORE security tests (expected failures)
#   B  AFTER core migration: every SQL security test passes; the storage
#      migration refuses to run where storage is absent; preflight reports
#      the migration as applied
#   C  re-apply core migration: no further change, tests still pass
#   D-F  data/policy guards (2nd admin, unknown driver status, rogue policy)
#   H  drift guards (U3-U6, owners, grantees, RLS): every injected unsafe
#      state aborts the migration with nothing applied AND fails the
#      matching preflight check; reverting it makes the preflight pass
#   G  rollback (core) restores the exact BEFORE matrix + driver statuses
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
OUT="$(mktemp -d /tmp/phase1c-run.XXXXXX)"
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
migrate() { q postgres --single-transaction -f "${2:-$MIG}" >"$OUT/$1.log" 2>&1; }
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
if migrate b; then pass "core migration applied (single transaction)"; else fail "core migration failed"; cat "$OUT/b.log"; fi
q postgres -f "$TESTS" > "$OUT/tests_after.txt"
echo "  AFTER: $(summary)"; [ "$(nfail)" = "0" ] && pass "every SQL security test passes" || { fail "security tests failing"; cat "$OUT/tests_after.txt"; }
q postgres -f "$MATRIX" > "$OUT/matrix_after.txt"
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
echo; echo "=== D-F, H. data, policy and platform-drift guards (one database, injected one at a time)"
start_db h; setup
[ "$(preflight ALL skip-storage)" = "True" ] || fail "guard database not clean before injections"
U1=00000000-0000-0000-0000-0000000000e1; D2=00000000-0000-0000-0000-0000000000d2
guard D_second_admin "update public.user_profiles set role = 'admin' where user_id = '$U1'" \
  "admin seed guard" "exactly_one_legitimate_admin_profile" "update public.user_profiles set role = 'customer' where user_id = '$U1'"
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
  "table not owned by postgres" "public_tables_owned_by_postgres" "alter table public.meals owner to postgres"
guard H10_grantee "grant select on public.orders to dashboard_user" \
  "unexpected table grantee" "public_table_grantees_expected" "revoke select on public.orders from dashboard_user"
guard H11_rls_off "alter table public.meals disable row level security" \
  "row level security disabled" "public_tables_rls_enabled" "alter table public.meals enable row level security"
[ "$(preflight ALL skip-storage)" = "True" ] && pass "guard database clean again after all reverts" || fail "guard database not clean after reverts"
if migrate h_final; then pass "migration applies once every injected state is reverted"; else fail "migration failed after reverts"; cat "$OUT/h_final.log"; fi

echo; echo "=== G. ROLLBACK core (re-opens the vulnerabilities by design)"
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

echo; echo "=== S. real Supabase Storage API (meal-images)"
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
  "$STORAGE_TESTS" check > "$OUT/storage_before.txt" || true
  "$STORAGE_TESTS" seed   # the BEFORE run deleted the seed object (that is the hole); re-seed while still vulnerable
  echo "  BEFORE (staging storage policies):$(tail -1 "$OUT/storage_before.txt" | sed 's/.*storage API://')  <- failures document the open upload hole"
  grep -E "FAIL S" "$OUT/storage_before.txt" | sed 's/^/    /'
  bucket_state() { qa "select public || ':' || coalesce(file_size_limit::text, 'NULL') || ':' || coalesce(allowed_mime_types::text, 'NULL') from storage.buckets where id = 'meal-images'"; }
  migrate s_core || { fail "core migration failed"; cat "$OUT/s_core.log"; }
  [ "$(qa "select count(*) from public.containment_violations() where category = 'storage'")" = "4" ] \
    && pass "after core only: containment_violations() reports 4 storage problems (3 open write policies + bucket limits); containment not complete" \
    || { fail "storage violations after core not as expected"; qa "select * from public.containment_violations() where category = 'storage'"; }
  # Storage guards: each unexpected bucket state is injected in the SAME transaction as the
  # migration, so the abort rolls back the injection too; nothing may persist.
  BUCKET_BEFORE="$(bucket_state)"; POL_BEFORE="$(qa "select count(*) from pg_policies where schemaname = 'storage'")"
  sguard() {
    printf '%s\n\\i %s\n' "$2" "$MIG_S" > "$OUT/sguard_$1.sql"
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
  if "$STORAGE_TESTS" check > "$OUT/storage_after.txt"; then pass "all Storage API checks pass"; else fail "Storage API checks failing"; fi
  sed 's/^/  /' "$OUT/storage_after.txt"
  [ "$(qa 'select count(*) from public.containment_violations()')" = "0" ] && pass "containment_violations() = 0 rows (drift, containment, storage)" \
    || { fail "violations remain"; qa 'select * from public.containment_violations()'; }
  q postgres -f "$TESTS" > "$OUT/tests_storage_env.txt"
  echo "  SQL tests with storage schema present: $(summary)"; [ "$(nfail)" = "0" ] || fail "SQL tests failing in storage scenario"
  q postgres -f "$MATRIX" > "$OUT/matrix_s_after.txt"
  if migrate s_storage2 "$MIG_S"; then pass "storage migration re-apply clean"; else fail "storage re-apply failed"; cat "$OUT/s_storage2.log"; fi
  [ "$(qa "select count(*) from public.security_audit_log where action = 'storage.bucket.limits_set'")" = "1" ] && [ "$(bucket_state)" = "true:5242880:{image/jpeg,image/png,image/webp}" ] \
    && pass "re-apply changed nothing (bucket unchanged, no second audit record)" || fail "re-apply changed the bucket or logged again"
  if q postgres --single-transaction -f "$DOWN" > "$OUT/s_down_wrong_order.log" 2>&1; then fail "core rollback ran before storage rollback"
  else grep -q "run supabase/rollback/20261016171000" "$OUT/s_down_wrong_order.log" && pass "core rollback refuses to run before the storage rollback" || fail "core rollback: wrong error"; fi
  if q postgres --single-transaction -f "$DOWN_S" > "$OUT/s_down_s.log" 2>&1; then pass "storage rollback applied"; else fail "storage rollback failed"; cat "$OUT/s_down_s.log"; fi
  [ "$(qa "select public and file_size_limit is null and allowed_mime_types is null from storage.buckets where id = 'meal-images'")" = "t" ] \
    && pass "storage rollback restores the exact original bucket settings (public; file_size_limit IS NULL; allowed_mime_types IS NULL)" \
    || fail "bucket not restored exactly: $(bucket_state)"
  if q postgres --single-transaction -f "$DOWN" > "$OUT/s_down.log" 2>&1; then pass "core rollback applied"; else fail "core rollback failed"; cat "$OUT/s_down.log"; fi
  [ "$(preflight storage_objects_policies_match_evidence)" = "True" ] && pass "storage rollback restores the verbatim staging storage policies" || fail "storage policies not restored"
  [ "$(preflight storage_buckets_match_evidence)" = "True" ] && pass "preflight bucket check matches the evidence again after rollback" || fail "preflight bucket check not restored"
  q postgres -f "$MATRIX" > "$OUT/matrix_s_rollback.txt"
  diff -q "$OUT/matrix_s_before.txt" "$OUT/matrix_s_rollback.txt" >/dev/null && pass "full rollback restores the exact BEFORE matrix (incl. storage policies and bucket settings)" \
    || { fail "storage-scenario rollback matrix differs"; diff "$OUT/matrix_s_before.txt" "$OUT/matrix_s_rollback.txt" || true; }
fi

echo
if [ "$STATUS" = "0" ]; then echo "RESULT: ALL PHASE 1C LOCAL CHECKS PASSED"; else echo "RESULT: SOME PHASE 1C CHECKS FAILED"; fi
exit $STATUS
