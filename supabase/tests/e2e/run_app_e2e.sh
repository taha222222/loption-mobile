#!/usr/bin/env bash
# =====================================================================
# End-to-end check of the customer journey in the real app code against
# real Supabase services, LOCAL AND DISPOSABLE ONLY:
#   Supabase Postgres 17.6 (staging baseline + fixtures + Phase 1C core +
#   V1 onboarding migration), Supabase Auth (GoTrue) with e-mail
#   confirmation ON, PostgREST, a local gateway, an SMTP sink, and the
#   app's web build driven by Playwright (Chromium).
#
# Nothing here talks to a hosted project; it takes no connection string.
# Containers and processes are removed on exit.
# Requires: docker, psql, node (Playwright preinstalled), python3, npx.
# Usage: supabase/tests/e2e/run_app_e2e.sh   (KEEP_OUTPUT=<dir> keeps logs/screens)
#   E2E_SCHEMA=baseline: only the staging baseline (what a hosted project has
#   before the V1 migrations); runs journey_baseline.js instead.
#
# Not covered (cannot be, locally): Google/Apple (no credentials; their
# "not configured" path IS covered), real e-mail delivery (an SMTP sink
# stands in for Resend), native iOS/Android permission dialogs (the web
# build reports notifications as unavailable), real push delivery (the
# dispatcher runs against a local fake of the Expo Push API).
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TESTS="$ROOT/supabase/tests"
PG_IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
AUTH_IMAGE="${E2E_AUTH_IMAGE:-supabase/gotrue:v2.186.0}"
REST_IMAGE="${E2E_REST_IMAGE:-postgrest/postgrest:v14.1}"
NET="v1e2e-net-$$"; DB="v1e2e-db-$$"; AUTH="v1e2e-auth-$$"; REST="v1e2e-rest-$$"
GW_PORT=54321; WEB_PORT=8765; SMTP_PORT=2525
OUT="$(mktemp -d /tmp/v1-e2e.XXXXXX)"; MAIL="$OUT/mail"; mkdir -p "$MAIL"
JWT_SECRET="local-e2e-only-$(python3 -c 'import secrets; print(secrets.token_hex(24))')"
INITIAL_ADMIN=00000000-0000-0000-0000-0000000000a1
PIDS=(); STATUS=0
export PGPASSWORD=postgres

cleanup() {
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done
  docker rm -f "$DB" "$AUTH" "$REST" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  if [ -n "${KEEP_OUTPUT:-}" ]; then mkdir -p "$KEEP_OUTPUT" && cp -r "$OUT"/. "$KEEP_OUTPUT"/; fi
  rm -rf "$OUT"
}
trap cleanup EXIT
fail() { echo "  FAIL: $*"; STATUS=1; }
pass() { echo "  pass: $*"; }
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$DB_PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
jwt() {  # HS256 token for a role (anon / service_role), signed with the local secret
  python3 -I - "$JWT_SECRET" "$1" <<'PY'
import base64, hashlib, hmac, json, sys, time
secret, role = sys.argv[1], sys.argv[2]
b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(",", ":")).encode()).rstrip(b"=")
head, body = b({"alg": "HS256", "typ": "JWT"}), b({"role": role, "iss": "supabase", "iat": int(time.time()), "exp": int(time.time()) + 86400})
sig = base64.urlsafe_b64encode(hmac.new(secret.encode(), head + b"." + body, hashlib.sha256).digest()).rstrip(b"=")
print((head + b"." + body + b"." + sig).decode())
PY
}

echo "=== 1. services"
docker network create "$NET" >/dev/null
docker run -d --name "$DB" --network "$NET" --network-alias db -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$PG_IMAGE" >/dev/null
DB_PORT="$(docker port "$DB" 5432/tcp | head -1 | sed 's/.*://')"
ok=0; for _ in $(seq 1 90); do
  if psql -h 127.0.0.1 -p "$DB_PORT" -U postgres -d postgres -XAtc "select 1 from pg_roles where rolname = 'authenticator'" 2>/dev/null | grep -q 1; then
    ok=$((ok + 1)); [ "$ok" -ge 3 ] && break; else ok=0; fi; sleep 1; done
[ "$ok" -ge 3 ] || { echo "database did not start"; exit 2; }
# Service-role logins for the local Auth and PostgREST containers (disposable database only).
q supabase_admin -c "alter role supabase_auth_admin with password 'postgres'; alter role authenticator with password 'postgres';" >/dev/null

docker run -d --name "$AUTH" --network "$NET" --add-host=host.docker.internal:host-gateway -p 127.0.0.1::9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e PORT=9999 -e API_EXTERNAL_URL="http://127.0.0.1:$GW_PORT" \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:postgres@db:5432/postgres" \
  -e GOTRUE_SITE_URL="http://127.0.0.1:$WEB_PORT" -e GOTRUE_URI_ALLOW_LIST="http://127.0.0.1:$WEB_PORT/**" \
  -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_JWT_SECRET="$JWT_SECRET" -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_AUD=authenticated \
  -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated -e GOTRUE_JWT_ADMIN_ROLES=service_role \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false -e GOTRUE_PASSWORD_MIN_LENGTH=8 \
  -e GOTRUE_SMTP_HOST=host.docker.internal -e GOTRUE_SMTP_PORT="$SMTP_PORT" -e GOTRUE_SMTP_ADMIN_EMAIL=no-reply@loption.test \
  -e GOTRUE_SMTP_SENDER_NAME="L'OPTION" -e GOTRUE_MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify \
  -e GOTRUE_RATE_LIMIT_EMAIL_SENT=1000 -e GOTRUE_EXTERNAL_PHONE_ENABLED=false "$AUTH_IMAGE" >/dev/null
AUTH_PORT="$(docker port "$AUTH" 9999/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 90); do curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null && break; sleep 1; done
curl -sf "http://127.0.0.1:$AUTH_PORT/health" >/dev/null && pass "Auth (GoTrue) up; its migrations created the auth schema" \
  || { fail "Auth did not start"; docker logs "$AUTH" 2>&1 | tail -20; exit 1; }

echo "=== 2. schema: staging baseline + fixtures + Phase 1C core + V1 onboarding migration"
q supabase_admin -c "grant references, select on auth.users to postgres" >/dev/null
q postgres -f "$ROOT/supabase/baseline/staging_schema_2026-10-15.sql" >"$OUT/baseline.log" 2>&1 || { fail "baseline"; tail -5 "$OUT/baseline.log"; exit 1; }
# Same fixtures as the Phase 1C harness; real Auth derives confirmed_at from email_confirmed_at.
sed 's/^update auth.users set confirmed_at = now()/update auth.users set email_confirmed_at = now()/' "$TESTS/fixtures_staging_like.sql" > "$OUT/fixtures.sql"
[ "$(diff "$TESTS/fixtures_staging_like.sql" "$OUT/fixtures.sql" | grep -c '^[<>]')" = "2" ] || { echo "fixture adaptation: expected one changed line"; exit 2; }
q supabase_admin -f "$OUT/fixtures.sql" >"$OUT/fixtures.log" 2>&1 || { fail "fixtures"; tail -5 "$OUT/fixtures.log"; exit 1; }
if [ "${E2E_SCHEMA:-full}" = "baseline" ]; then
  pass "baseline only: no Phase 1C or V1 migration (hosted project before the V1 rollout)"
else
  sed "s/'OWNER-MUST-SUPPLY-INITIAL-ADMIN-UUID',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" \
    "$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql" > "$OUT/p1c.sql"
  q postgres -f "$OUT/p1c.sql" >"$OUT/p1c.log" 2>&1 && pass "Phase 1C core applied" || { fail "Phase 1C: $(tail -3 "$OUT/p1c.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261028120000_v1_onboarding_first_order_offer.sql" >"$OUT/v1.log" 2>&1 \
    && pass "V1 onboarding/offer migration applied" || { fail "V1 migration: $(tail -3 "$OUT/v1.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261029120000_v1_nutrition_tracking_engagement.sql" >"$OUT/nutrition.log" 2>&1 \
    && pass "V1 nutrition tracking/engagement migration applied" || { fail "nutrition migration: $(tail -3 "$OUT/nutrition.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261030120000_v1_activity_tracking.sql" >"$OUT/activity.log" 2>&1 \
    && pass "V1 activity tracking migration applied" || { fail "activity migration: $(tail -3 "$OUT/activity.log")"; exit 1; }
  [ "$(qa "select count(*) from public.containment_violations() where category in ('drift','containment')")" = "0" ] \
    && pass "containment_violations() = 0" || fail "containment violations present"
fi

docker run -d --name "$REST" --network "$NET" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" "$REST_IMAGE" >/dev/null
REST_PORT="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$REST_PORT/" && break; sleep 1; done
pass "PostgREST up"

echo "=== 3. app web build pointed at the local gateway"
ANON_KEY="$(jwt anon)"
(cd "$ROOT" && EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:$GW_PORT" EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  npx expo export --platform web --output-dir "$OUT/web" >"$OUT/export.log" 2>&1) \
  && pass "expo export --platform web" || { fail "web export: $(tail -5 "$OUT/export.log")"; exit 1; }
node "$HERE/gateway.js" "$GW_PORT" "$AUTH_PORT" "$REST_PORT" "$OUT/web" "$WEB_PORT" >"$OUT/gateway.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/" && break; sleep 0.5; done

echo "=== 4. customer journey (Playwright, Chromium)"
export E2E_OUT="$OUT" E2E_MAIL="$MAIL" E2E_WEB="http://127.0.0.1:$WEB_PORT" E2E_SMTP_PORT="$SMTP_PORT" E2E_SINK="$HERE/smtp_sink.py"
export E2E_DB_PORT="$DB_PORT" E2E_REST="http://127.0.0.1:$GW_PORT/rest/v1" E2E_SERVICE_JWT="$(jwt service_role)"
export E2E_DISPATCH="$HERE/dispatch_once.ts"
JOURNEY="$HERE/journey.js"; [ "${E2E_SCHEMA:-full}" = "baseline" ] && JOURNEY="$HERE/journey_baseline.js"
node "$JOURNEY" 2>&1 | tee "$OUT/journey.log"
grep -q "^  FAIL" "$OUT/journey.log" && STATUS=1
grep -q "^JOURNEY COMPLETE" "$OUT/journey.log" || { STATUS=1; echo "  FAIL: journey did not complete"; }

echo
[ "$STATUS" = "0" ] && echo "RESULT: END-TO-END JOURNEY PASSED (local services)" || echo "RESULT: FAILURES (see above)"
exit "$STATUS"
