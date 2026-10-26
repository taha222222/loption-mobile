#!/usr/bin/env bash
# =====================================================================
# Phase 1C: concurrent changes to administrator roles (finding L2 / rev6 M1).
# LOCAL, DISPOSABLE database only. Called by run_phase1c.sh (scenario M)
# with PORT set to a local container on which the core migration has been
# applied with the fixture admin a1. Can also be run by hand against such a
# container (used to reproduce the revision-5 failure; see the plan, 0e).
#
# Invariant under test: after every COMMITTED change at least one active
# admin remains, whatever the write path (assign/revoke functions,
# service_role UPDATE/DELETE, role change, ON DELETE CASCADE from
# auth.users) and whatever the isolation level (READ COMMITTED, REPEATABLE
# READ, SERIALIZABLE).
#
# Each case resets staff_roles to two active admins (a1, f1), runs two
# transactions that overlap in time (T2 takes its snapshot while T1 is
# still open), and then asserts the COMMITTED database state: number and
# identity of active admins, and which transaction committed. Return values
# alone are never trusted.
# Exit 0 only if every case passes.
# =====================================================================
set -uo pipefail
: "${PORT:?PORT of a local container is required}"
case "${PGHOST:-127.0.0.1}" in 127.0.0.1|localhost) ;; *) echo "local databases only"; exit 2 ;; esac
export PGPASSWORD="${PGPASSWORD:-postgres}"
OUT="${CONC_OUT:-$(mktemp -d /tmp/phase1c-conc.XXXXXX)}"; mkdir -p "$OUT"
A1=00000000-0000-0000-0000-0000000000a1
F1=00000000-0000-0000-0000-0000000000f1
G1=00000000-0000-0000-0000-0000000000a9   # throw-away admin account for the cascade case
STATUS=0
fail() { echo "  FAIL: $*"; STATUS=1; }
pass() { echo "  pass: $*"; }
q()  { local u="$1"; shift; psql -h 127.0.0.1 -p "$PORT" -U "$u" -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; }
qa() { q postgres -At -c "$1"; }
as_user() { echo "set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) is not null;"; }
as_service() { echo "set role service_role;"; }
active_admins() { qa "select coalesce(string_agg(user_id::text, ',' order by user_id), 'none') from public.staff_roles where role = 'admin' and is_active"; }

# reset to exactly two active admins a1 and f1 (G1 only for the cascade case)
reset() {
  q supabase_admin -c "insert into auth.users (id, confirmed_at) values ('$G1', now()) on conflict (id) do nothing" >/dev/null
  q postgres -c "
    insert into public.staff_roles (user_id, role) values ('$A1', 'admin'), ('$F1', 'admin')
    on conflict (user_id, role, kitchen_id) do update set is_active = true, revoked_by = null, revoked_at = null;
    delete from public.staff_roles where user_id in ('$A1', '$F1', '$G1') and role <> 'admin';
    delete from public.staff_roles where user_id = '$G1';" >/dev/null 2>"$OUT/reset.err" \
    || { echo "reset failed"; cat "$OUT/reset.err"; exit 2; }
  [ "$(active_admins)" = "$A1,$F1" ] || { echo "reset: unexpected admins $(active_admins)"; exit 2; }
}

# overlap NAME ISO "T1 prefix" "T1 op" "T2 prefix" "T2 op" [T1 tail before commit]
#   T1: begin; op; sleep 2; [tail;] commit      T2 (starts 0.7 s later): begin; snapshot; op; commit
#   prints "<t1 committed>:<t2 committed>" (1/0)
overlap() {
  local name="$1" iso="$2" p1="$3" op1="$4" p2="$5" op2="$6" tail="${7:-}"
  # statements are sent one by one (psql -f -), not as one multi-statement string
  ( echo "$p1 begin isolation level $iso; select 1; $op1; select pg_sleep(2); $tail commit;" | q "${OV_U1:-postgres}" -f - >"$OUT/$name.t1" 2>&1; echo "rc=$?" >>"$OUT/$name.t1" ) &
  sleep 0.7
  ( echo "$p2 begin isolation level $iso; select 1; $op2; commit;" | q postgres -f - >"$OUT/$name.t2" 2>&1; echo "rc=$?" >>"$OUT/$name.t2" ) &
  wait
  local c1=0 c2=0
  grep -q '^rc=0$' "$OUT/$name.t1" && ! grep -q 'ERROR' "$OUT/$name.t1" && c1=1
  grep -q '^rc=0$' "$OUT/$name.t2" && ! grep -q 'ERROR' "$OUT/$name.t2" && c2=1
  echo "$c1:$c2"
}

# mutual NAME ISO "T1 prefix" "T1 op (removes f1)" "T2 prefix" "T2 op (removes a1)"
#   exactly one may commit; exactly one active admin remains: the one the
#   committed transaction did not remove
mutual() {
  local name="$1" iso="$2" r admins err
  reset
  r="$(overlap "$@")"
  admins="$(active_admins)"
  err="$(grep -h -o -E 'ERROR: .*' "$OUT/$1.t1" "$OUT/$1.t2" | head -1)"
  if { [ "$r" = "1:0" ] && [ "$admins" = "$A1" ]; } || { [ "$r" = "0:1" ] && [ "$admins" = "$F1" ]; }; then
    pass "$name ($iso): one transaction committed, the other was refused (${err:-no error text}); committed state: 1 active admin"
  else
    fail "$name ($iso): committed=$r, active admins after commit: $admins"; sed 's/[[:space:]]*$//; s/^./      &/' "$OUT/$1.t1" "$OUT/$1.t2"
  fi
}

echo "  -- concurrent administrator changes (every write path x every isolation level; committed state asserted)"
for iso in "read committed" "repeatable read" "serializable"; do
  tag="${iso// /_}"
  mutual "fn_revoke_each_other_$tag" "$iso" \
    "$(as_user "$A1")" "select public.revoke_staff_role('$F1', 'admin')" \
    "$(as_user "$F1")" "select public.revoke_staff_role('$A1', 'admin')"
  mutual "direct_update_each_other_$tag" "$iso" \
    "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$F1' and role = 'admin'" \
    "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'"
  mutual "delete_vs_update_$tag" "$iso" \
    "$(as_service)" "delete from public.staff_roles where user_id = '$F1' and role = 'admin'" \
    "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'"
  mutual "role_change_vs_delete_$tag" "$iso" \
    "$(as_service)" "update public.staff_roles set role = 'support' where user_id = '$F1' and role = 'admin'" \
    "$(as_service)" "delete from public.staff_roles where user_id = '$A1' and role = 'admin'"
  mutual "fn_revoke_vs_direct_update_$tag" "$iso" \
    "$(as_user "$A1")" "select public.revoke_staff_role('$F1', 'admin')" \
    "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'"
done

# ON DELETE CASCADE from auth.users: the account of one admin is deleted
# while the other admin is revoked. G1 replaces F1 as the second admin.
for iso in "read committed" "repeatable read"; do
  tag="${iso// /_}"; reset
  q postgres -c "update public.staff_roles set is_active = false where user_id = '$F1' and role = 'admin';
                 insert into public.staff_roles (user_id, role) values ('$G1', 'admin')" >/dev/null
  r="$(OV_U1=supabase_admin overlap "cascade_$tag" "$iso" "" "delete from auth.users where id = '$G1'" \
       "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'")"
  admins="$(active_admins)"
  if { [ "$r" = "1:0" ] && [ "$admins" = "$A1" ]; } || { [ "$r" = "0:1" ] && [ "$admins" = "$G1" ]; }; then
    pass "auth_user_delete_cascade_vs_update ($iso): one committed, the other refused; committed state: 1 active admin"
  else fail "auth_user_delete_cascade_vs_update ($iso): committed=$r, active admins: $admins"; sed 's/[[:space:]]*$//; s/^./      &/' "$OUT/cascade_$tag.t1" "$OUT/cascade_$tag.t2"; fi
done

# A failed (rolled back) removal must not block or count: T1 removes f1 and
# then fails; T2's removal of a1 waits for T1 and then commits; f1 remains.
for iso in "read committed" "repeatable read"; do
  tag="${iso// /_}"; reset
  r="$(overlap "failed_t1_$tag" "$iso" "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$F1' and role = 'admin'" \
       "$(as_service)" "update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'" "select 1 / 0;")"
  admins="$(active_admins)"
  if [ "$r" = "0:1" ] && [ "$admins" = "$F1" ]; then
    pass "rollback_after_failed_operation ($iso): T1 failed and rolled back; T2 committed; committed state: f1 is the 1 active admin"
  else fail "rollback_after_failed_operation ($iso): committed=$r, active admins: $admins"; sed 's/[[:space:]]*$//; s/^./      &/' "$OUT/failed_t1_$tag.t1" "$OUT/failed_t1_$tag.t2"; fi
done

# A refused change is atomic: removing both admins in one transaction or one statement commits nothing.
reset
echo "$(as_service) begin; update public.staff_roles set is_active = false where user_id = '$F1' and role = 'admin';
      update public.staff_roles set is_active = false where user_id = '$A1' and role = 'admin'; commit;" | q postgres -f - >"$OUT/same_tx.log" 2>&1
[ "$(active_admins)" = "$A1,$F1" ] && grep -q "at least one active admin" "$OUT/same_tx.log" \
  && pass "removing every admin in one transaction is refused; committed state unchanged (2 active admins)" \
  || { fail "same-transaction removal: active admins $(active_admins)"; cat "$OUT/same_tx.log"; }
q postgres -c "$(as_service) update public.staff_roles set is_active = false where role = 'admin'" >"$OUT/same_stmt.log" 2>&1
[ "$(active_admins)" = "$A1,$F1" ] && grep -q "at least one active admin" "$OUT/same_stmt.log" \
  && pass "removing every admin in one statement is refused; committed state unchanged (2 active admins)" \
  || { fail "same-statement removal: active admins $(active_admins)"; cat "$OUT/same_stmt.log"; }

# A revoked admin whose transaction started before the revocation cannot use
# its stale authority (REPEATABLE READ snapshot) to assign roles.
reset
r="$(overlap "stale_authority" "repeatable read" "$(as_user "$A1")" "select public.revoke_staff_role('$F1', 'admin')" \
     "$(as_user "$F1")" "select public.assign_staff_role('$F1', 'support')")"
[ "$r" = "1:0" ] && [ "$(qa "select count(*) from public.staff_roles where user_id = '$F1' and role = 'support'")" = "0" ] \
  && pass "a revoked admin cannot act on a stale REPEATABLE READ snapshot (assign refused, nothing committed)" \
  || { fail "stale authority: committed=$r"; sed 's/[[:space:]]*$//; s/^./      &/' "$OUT/stale_authority.t1" "$OUT/stale_authority.t2"; }

reset
[ "$STATUS" = "0" ] && echo "  concurrency: all cases passed" || echo "  concurrency: SOME CASES FAILED"
exit $STATUS
