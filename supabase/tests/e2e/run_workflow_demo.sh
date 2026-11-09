#!/usr/bin/env bash
# =====================================================================
# HANDS-ON DEMO of the order workflow (cashier -> kitchen -> driver ->
# payment, with customer tracking), LOCAL AND DISPOSABLE ONLY.
#
# Starts the same services as run_app_e2e.sh (Postgres 17.6 with the whole
# V1 migration chain, Auth, PostgREST, the app's web build), seeds one
# account per role and a few pending orders, prints the logins and KEEPS
# RUNNING until Ctrl+C (everything is removed on exit).
#
# Nothing here talks to a hosted project; it takes no connection string.
# Checkout stays closed in the app, so orders are created by this script
# as the order service would (`DEMO_ORDERS`, default 4).
# Requires: docker, psql, node, python3, npx.
# Usage: supabase/tests/e2e/run_workflow_demo.sh
#   DEMO_PORT (default 8765) — app + API on one port: http://127.0.0.1:8765
#   DEMO_HOST (default 127.0.0.1) — bind address
#   DEMO_ORDERS (default 4) — pending orders created at start
# Add an order while it runs:  psql -h 127.0.0.1 -p <db port> -U postgres -c "select demo.new_order()"
#   (password: postgres; the port is printed at start)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
TESTS="$ROOT/supabase/tests"
PG_IMAGE="${PHASE1C_IMAGE:-supabase/postgres:17.6.1.178}"
AUTH_IMAGE="${E2E_AUTH_IMAGE:-supabase/gotrue:v2.186.0}"
REST_IMAGE="${E2E_REST_IMAGE:-postgrest/postgrest:v14.1}"
NET="v1demo-net-$$"; DB="v1demo-db-$$"; AUTH="v1demo-auth-$$"; REST="v1demo-rest-$$"
WEB_PORT="${DEMO_PORT:-8765}"; GW_PORT="$WEB_PORT"; SMTP_PORT=2525; DEMO_HOST="${DEMO_HOST:-127.0.0.1}"
OUT="$(mktemp -d /tmp/v1-demo.XXXXXX)"; MAIL="$OUT/mail"; mkdir -p "$MAIL"
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
  sed "s/'[^']*',  -- PHASE1C_INITIAL_ADMIN_USER_ID/'$INITIAL_ADMIN',  -- PHASE1C_INITIAL_ADMIN_USER_ID/" \
    "$ROOT/supabase/migrations/20261016170000_phase1c_security_containment.sql" > "$OUT/p1c.sql"
  q postgres -f "$OUT/p1c.sql" >"$OUT/p1c.log" 2>&1 && pass "Phase 1C core applied" || { fail "Phase 1C: $(tail -3 "$OUT/p1c.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261028120000_v1_onboarding_first_order_offer.sql" >"$OUT/v1.log" 2>&1 \
    && pass "V1 onboarding/offer migration applied" || { fail "V1 migration: $(tail -3 "$OUT/v1.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261029120000_v1_nutrition_tracking_engagement.sql" >"$OUT/nutrition.log" 2>&1 \
    && pass "V1 nutrition tracking/engagement migration applied" || { fail "nutrition migration: $(tail -3 "$OUT/nutrition.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261030120000_v1_activity_tracking.sql" >"$OUT/activity.log" 2>&1 \
    && pass "V1 activity tracking migration applied" || { fail "activity migration: $(tail -3 "$OUT/activity.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261103120000_v1_standalone_tracking.sql" >"$OUT/standalone.log" 2>&1 \
    && pass "V1 standalone tracking migration applied" || { fail "standalone migration: $(tail -3 "$OUT/standalone.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261104120000_v1_account_deletion.sql" >"$OUT/account.log" 2>&1 \
    && pass "V1 account deletion migration applied" || { fail "account deletion migration: $(tail -3 "$OUT/account.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261105120000_v1_order_workflow.sql" >"$OUT/orders.log" 2>&1 \
    && pass "V1 order workflow migration applied" || { fail "order workflow migration: $(tail -3 "$OUT/orders.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261106120000_v1_create_order.sql" >"$OUT/create_order.log" 2>&1 \
    && pass "V1 create_order migration applied" || { fail "create_order migration: $(tail -3 "$OUT/create_order.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261107120000_v1_delivery_zones.sql" >"$OUT/zones.log" 2>&1 \
    && pass "V1 delivery zones migration applied" || { fail "delivery zones migration: $(tail -3 "$OUT/zones.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261108120000_v1_pricing_engine.sql" >"$OUT/pricing.log" 2>&1 \
    && pass "V1 pricing engine migration applied" || { fail "pricing engine migration: $(tail -3 "$OUT/pricing.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261109120000_v1_checkout_experience.sql" >"$OUT/checkout.log" 2>&1 \
    && pass "V1 checkout experience migration applied" || { fail "checkout experience migration: $(tail -3 "$OUT/checkout.log")"; exit 1; }
  q postgres -f "$ROOT/supabase/migrations/20261110120000_v1_order_lifecycle_hardening.sql" >"$OUT/lifecycle.log" 2>&1 \
    && pass "V1 order lifecycle hardening applied" || { fail "order lifecycle hardening: $(tail -3 "$OUT/lifecycle.log")"; exit 1; }
  [ "$(qa "select count(*) from public.containment_violations() where category in ('drift','containment')")" = "0" ] \
    && pass "containment_violations() = 0" || fail "containment violations present"
fi

docker run -d --name "$REST" --network "$NET" -p 127.0.0.1::3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@db:5432/postgres" -e PGRST_DB_SCHEMAS=public \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$JWT_SECRET" "$REST_IMAGE" >/dev/null
REST_PORT="$(docker port "$REST" 3000/tcp | head -1 | sed 's/.*://')"
for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$REST_PORT/" && break; sleep 1; done
pass "PostgREST up"

echo "=== 3. app web build (one origin for the app and the API)"
ANON_KEY="$(jwt anon)"; SERVICE_KEY="$(jwt service_role)"
BUILT_URL="http://127.0.0.1:$WEB_PORT"
(cd "$ROOT" && EXPO_PUBLIC_SUPABASE_URL="$BUILT_URL" EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  npx expo export --platform web --output-dir "$OUT/web" >"$OUT/export.log" 2>&1) \
  && pass "expo export --platform web" || { fail "web export: $(tail -5 "$OUT/export.log")"; exit 1; }
node "$HERE/demo_gateway.js" "$WEB_PORT" "$AUTH_PORT" "$REST_PORT" "$OUT/web" "$BUILT_URL" "$DEMO_HOST" >"$OUT/gateway.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/" && break; sleep 0.5; done
pass "app and API served on port $WEB_PORT"

echo "=== 4. demo accounts and orders"
PASSWORD="Demo-1234!"
make_user() {  # make_user <email> -> user id (confirmed, password above)
  curl -s -X POST "http://127.0.0.1:$AUTH_PORT/admin/users" -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
    -H "content-type: application/json" -d "{\"email\":\"$1\",\"password\":\"$PASSWORD\",\"email_confirm\":true}" \
    | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["id"])'
}
CUSTOMER="$(make_user client@demo.loption.test)"; CASHIER="$(make_user caisse@demo.loption.test)"
KITCHEN="$(make_user cuisine@demo.loption.test)"; DRIVER="$(make_user livreur@demo.loption.test)"; ADMIN="$(make_user admin@demo.loption.test)"
for u in "$CUSTOMER" "$CASHIER" "$KITCHEN" "$DRIVER" "$ADMIN"; do [ -n "$u" ] || { fail "account creation"; exit 1; }; done
q postgres >"$OUT/seed.log" 2>&1 <<SQL || { fail "seed: $(tail -3 "$OUT/seed.log")"; exit 1; }
\set ON_ERROR_STOP 1
insert into public.meals (id, name, price, calories, protein) values
  ('00000000-0000-0000-0000-0000000d0e01', 'Bol poulet harissa', 65, 620, 42),
  ('00000000-0000-0000-0000-0000000d0e02', 'Salade César', 55, 480, 30),
  ('00000000-0000-0000-0000-0000000d0e03', 'Tajine kefta', 70, 700, 38);
insert into public.user_profiles (user_id, role, is_admin, full_name, gender, age, weight, height, activity_level, delivery_address)
values ('$CUSTOMER', 'customer', false, 'Client Démo', 'woman', 30, 62, 168, 'moderate', '12 Rue Test, Casablanca'),
       ('$ADMIN', 'admin', true, 'Admin Démo', null, null, null, null, null, null);
update public.user_profiles set onboarding_completed_at = now() where user_id = '$CUSTOMER';
insert into public.staff_roles (user_id, role, kitchen_id)
select u, r, case when r = 'admin' then null else k.id end
  from (values ('$CASHIER'::uuid, 'cashier'), ('$KITCHEN'::uuid, 'kitchen_staff'), ('$DRIVER'::uuid, 'driver'), ('$ADMIN'::uuid, 'admin')) v(u, r),
       public.kitchens k where k.code = 'A';
insert into public.drivers (id, email, first_name, last_name, status, commission_rate, total_earned)
values ('$DRIVER', 'livreur@demo.loption.test', 'Livreur', 'Démo', 'online', 0.15, 0);

create schema demo;
create sequence demo.n;
-- A pending order as create_order leaves it (checkout is closed in the app).
create function demo.new_order() returns text language plpgsql as \$f\$
declare oid uuid := gen_random_uuid(); n bigint := nextval('demo.n'); num text := 'LO-DEMO-' || lpad(n::text, 3, '0'); k uuid;
begin
  select id into k from public.kitchens where code = 'A';
  perform set_config('loption.order_service', 'on', true);
  insert into public.orders (id, order_number, status, workflow_version, kitchen_id, payment_status, payment_method, user_id,
                             subtotal, delivery_fee, platform_service_fee, total, delivery_address, delivery_phone)
  values (oid, num, 'pending', 1, k, 'pending', 'cash', '$CUSTOMER', 120, 16, 3, 139, '12 Rue Test, Casablanca', '+212612345678');
  insert into public.order_items (order_id, meal_id, meal_name, quantity, price, notes, options, line_total_ttc) values
    (oid, '00000000-0000-0000-0000-0000000d0e01', 'Bol poulet harissa', 1, 65, case when n % 2 = 1 then 'sans oignon' end,
     '[{"group": "Sauce", "name": "Harissa", "price": 0}]'::jsonb, 65),
    (oid, '00000000-0000-0000-0000-0000000d0e02', 'Salade César', 1, 55, null, '[]'::jsonb, 55);
  insert into public.order_status_updates (order_id, status) values (oid, 'pending');
  perform set_config('loption.order_service', 'off', true);
  return num;
end \$f\$;
select demo.new_order() from generate_series(1, ${DEMO_ORDERS:-4});
SQL
pass "5 accounts (customer, cashier, kitchen, driver, admin) and ${DEMO_ORDERS:-4} pending orders"
[ "$(qa "select count(*) from public.containment_violations() where category in ('drift','containment')")" = "0" ] \
  && pass "containment_violations() = 0 with the demo data" || fail "containment violations with the demo data"

cat <<TXT

  ===============================================================
  L'OPTION workflow demo is running:  http://127.0.0.1:$WEB_PORT
  Password for every account: $PASSWORD
    cashier   caisse@demo.loption.test    -> /cashier  confirm or cancel (reason)
    kitchen   cuisine@demo.loption.test   -> /kitchen  start preparing, mark ready
    admin     admin@demo.loption.test     -> Orders: assign the driver, record payment after delivery
    driver    livreur@demo.loption.test   -> pickup, on the way, delivered
    customer  client@demo.loption.test    -> Commandes: follows the status
  Use a private window (or another browser) per role.
  New pending order:  PGPASSWORD=postgres psql -h 127.0.0.1 -p $DB_PORT -U postgres -c "select demo.new_order()"
  Ctrl+C stops everything and deletes the demo data.
  ===============================================================
TXT
echo "DEMO READY port=$WEB_PORT db=$DB_PORT"
while true; do sleep 3600; done
