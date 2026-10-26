#!/usr/bin/env bash
# =====================================================================
# Phase 1C rollback: the ONE supported procedure (plan, section 9).
#
# !!! Re-opens C1-C4, H2-H4 and the meal-images upload/listing holes. !!!
# Only with written CTO approval. Prefer forward recovery.
#
# Usage:
#   supabase/rollback/phase1c_rollback.sh \
#     --target staging|local \
#     --db-url 'postgresql://postgres@db.<ref>.supabase.co:5432/postgres' \
#     --expected-admin <auth.users id of the seeded initial admin> \
#     --approved-by '<CTO name, as in the written approval>' \
#     --backup-ref '<backup / PITR point newer than the change window>' \
#     --export-dir <new directory OUTSIDE the repository> \
#     --confirm 'ROLLBACK PHASE 1C ON <staging ref | local>'
#
# Credentials (review 2026-10-26 L8): --db-url must NOT contain a password
# (it would be visible in the process list, shell history and logs). psql
# takes it from a password file: PGPASSFILE=<file, mode 600> or ~/.pgpass
# (line: host:port:database:user:password). PGPASSWORD in the environment
# also works but is discouraged (the environment of a process is readable
# by the same OS user). The script never prompts (psql -w) and never prints
# the URL's userinfo or any password.
#
# What it does, in order (any failure stops it; steps 1-4 change nothing):
#   1. Target: --target staging accepts ONLY the staging project
#      (teppcfnpkoxkudajnvad, direct host or pooler user); --target local
#      accepts only 127.0.0.1 / localhost. Every other target (production
#      included) is refused before connecting. --confirm must name it.
#   2. Read-only identification: connected role must be postgres; the
#      database must hold the Phase 1C initial-admin seed record for
#      --expected-admin, the Phase 1C migration-history rows as the newest
#      versions, and containment_violations() must return 0 rows.
#   3. Prerequisites: --approved-by and --backup-ref given; --export-dir
#      does not exist yet and is outside the git checkout.
#   4. Audit export (read-only): security_audit_log, staff_roles, kitchens
#      to CSV in --export-dir (mode 700), row counts checked, SHA-256
#      manifest written. The export holds user ids: keep it in secure
#      storage, never in the repository.
#   5. Rollback: supabase/rollback/phase1c_rollback.sql with psql, as ONE
#      transaction (storage part, then core part; preflight, postcondition
#      and deferred commit gate inside). On any error nothing is committed.
#   6. Verification (read-only): Phase 1C absent, archive schema present,
#      migration-history rows removed. Log written to --export-dir.
# Requires: psql, sha256sum. Exit 0 only if the rollback committed and
# verified; any other exit means the database was not changed by step 5
# (step 6 failing after a commit is reported as such).
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SQL="$HERE/phase1c_rollback.sql"
STAGING_REF=teppcfnpkoxkudajnvad

die() { echo "phase1c_rollback: REFUSED: $*" >&2; exit 2; }
TARGET= DB_URL= EXPECTED_ADMIN= APPROVED_BY= BACKUP_REF= EXPORT_DIR= CONFIRM=
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --db-url) DB_URL="${2:-}"; shift 2 ;;
    --expected-admin) EXPECTED_ADMIN="${2:-}"; shift 2 ;;
    --approved-by) APPROVED_BY="${2:-}"; shift 2 ;;
    --backup-ref) BACKUP_REF="${2:-}"; shift 2 ;;
    --export-dir) EXPORT_DIR="${2:-}"; shift 2 ;;
    --confirm) CONFIRM="${2:-}"; shift 2 ;;
    *) die "unknown argument $1" ;;
  esac
done

# ---- 1. target -------------------------------------------------------
[ -n "$DB_URL" ] || die "--db-url is required"
URL_CHECK="$(python3 -I -c '
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1])
if u.scheme not in ("postgres", "postgresql") or not u.hostname:
    print("bad"); sys.exit()
q = {k.lower() for k, _ in urllib.parse.parse_qsl(u.query, keep_blank_values=True)}
if u.password is not None or "password" in q or "passfile" in q:
    print("password"); sys.exit()
print("ok", u.hostname.lower(), urllib.parse.unquote(u.username or "-"))' "$DB_URL")"
case "$URL_CHECK" in
  password) die "--db-url must not contain a password (use PGPASSFILE or ~/.pgpass; see the header)" ;;
  ok\ *) read -r _ URL_HOST URL_USER <<<"$URL_CHECK" ;;
  *) die "--db-url is not a postgresql:// URL with a host" ;;
esac
case "$TARGET" in
  staging)
    TARGET_ID="$STAGING_REF"
    if [ "$URL_HOST" = "db.$STAGING_REF.supabase.co" ] && [ "$URL_USER" = "postgres" ]; then :
    elif [[ "$URL_HOST" == *.pooler.supabase.com ]] && [ "$URL_USER" = "postgres.$STAGING_REF" ]; then :
    else die "target staging accepts only project $STAGING_REF (got host $URL_HOST, user $URL_USER)"; fi ;;
  local)
    TARGET_ID=local
    case "$URL_HOST" in 127.0.0.1|localhost) ;; *) die "target local accepts only 127.0.0.1 or localhost (got $URL_HOST)" ;; esac ;;
  *) die "--target must be staging or local (production is never a target of this procedure)" ;;
esac
[ "$CONFIRM" = "ROLLBACK PHASE 1C ON $TARGET_ID" ] || die "--confirm must be exactly 'ROLLBACK PHASE 1C ON $TARGET_ID'"

# ---- 3. prerequisites given (checked before connecting) ---------------
[[ "$EXPECTED_ADMIN" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
  || die "--expected-admin must be the UUID of the seeded initial administrator"
EXPECTED_ADMIN="$(echo "$EXPECTED_ADMIN" | tr 'A-F' 'a-f')"
[[ "$APPROVED_BY" =~ [^[:space:]] ]] || die "--approved-by is required (the written CTO approval)"
[[ "$BACKUP_REF" =~ [^[:space:]] ]] || die "--backup-ref is required (a backup or PITR point newer than the change window)"
[ -n "$EXPORT_DIR" ] || die "--export-dir is required"
[ ! -e "$EXPORT_DIR" ] || die "--export-dir $EXPORT_DIR already exists (use a new directory)"
EXPORT_PARENT="$(cd "$(dirname "$EXPORT_DIR")" 2>/dev/null && pwd)" || die "parent of --export-dir does not exist"
REPO_TOP="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || (cd "$HERE/../.." && pwd))"   # also without git (export)
case "$EXPORT_PARENT/" in "$REPO_TOP/"*) die "--export-dir must be outside the repository (it will hold user ids)" ;; esac
[ -f "$SQL" ] || die "$SQL missing"

PSQL=(psql "$DB_URL" -X -q -w -v ON_ERROR_STOP=1)   # -w: never prompt for a password
ro() { "${PSQL[@]}" -At -c "begin transaction read only" -c "$1" -c "commit"; }   # one statement, read-only transaction

# ---- 2. read-only identification -------------------------------------
echo "phase1c_rollback: target $TARGET ($TARGET_ID), host $URL_HOST"
WHO="$(ro "select current_user || ' ' || session_user || ' ' || current_database() || ' ' || current_setting('server_version')")" \
  || die "cannot connect read-only (password from PGPASSFILE, ~/.pgpass or PGPASSWORD; the script never prompts)"
echo "  connected: current_user session_user database version = $WHO"
[ "${WHO%% *}" = "postgres" ] || die "must connect as role postgres (current_user is ${WHO%% *})"
APPLIED="$(ro "select to_regclass('public.staff_roles') is not null and to_regclass('public.security_audit_log') is not null and to_regprocedure('public.containment_violations()') is not null")"
[ "$APPLIED" = "t" ] || die "Phase 1C is not applied on this database (nothing to roll back; a repeated run changes nothing)"
SEED="$(ro "select coalesce(string_agg(target_user_id::text, ','), 'none') from public.security_audit_log where action = 'staff_role.seed_initial_admin'")"
[ "$SEED" = "$EXPECTED_ADMIN" ] || die "unexpected database: its initial-admin seed record is $SEED, not $EXPECTED_ADMIN"
HIST="$(ro "select case when to_regclass('supabase_migrations.schema_migrations') is null then 'missing' else (select coalesce(string_agg(version, ',' order by version), 'none') from supabase_migrations.schema_migrations where version >= '20261016170000') end")"
echo "  migration history (>= 20261016170000): $HIST"
case "$HIST" in 20261016170000|20261016170000,20261016171000) ;; *) die "migration history must end with the Phase 1C versions (got $HIST)" ;; esac
NV="$(ro "select count(*) from public.containment_violations() where not (category = 'storage' and to_regclass('storage.objects') is null)")"
[ "$NV" = "0" ] || die "containment_violations() returns $NV rows: Phase 1C is not in its reviewed state; use forward recovery"
echo "  identified: Phase 1C applied, initial admin $SEED, 0 containment violations"

# ---- 4. audit export --------------------------------------------------
umask 077
mkdir "$EXPORT_DIR"
for t in security_audit_log staff_roles kitchens; do
  "${PSQL[@]}" -c "\\copy (select * from public.$t order by 1) to '$EXPORT_DIR/$t.csv' with (format csv, header)"
  want="$(ro "select count(*) from public.$t")"
  got="$(python3 -I -c "import csv,sys; print(sum(1 for _ in csv.reader(open(sys.argv[1], newline=''))) - 1)" "$EXPORT_DIR/$t.csv")"
  [ "$want" = "$got" ] || die "export of $t has $got rows, database has $want (nothing changed)"
done
(cd "$EXPORT_DIR" && sha256sum security_audit_log.csv staff_roles.csv kitchens.csv > SHA256SUMS)
EXPORT_SHA="$(sha256sum "$EXPORT_DIR/SHA256SUMS" | cut -d' ' -f1)"
echo "  audit export written to $EXPORT_DIR (manifest sha256 $EXPORT_SHA)"

# ---- 5. rollback: one transaction ------------------------------------
LOG="$EXPORT_DIR/rollback.log"
{ echo "target=$TARGET ($TARGET_ID) host=$URL_HOST approved_by=$APPROVED_BY backup_ref=$BACKUP_REF"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ) sql_sha256=$(sha256sum "$SQL" | cut -d' ' -f1)"; } > "$LOG"
if ! "${PSQL[@]}" -v expected_admin="$EXPECTED_ADMIN" -v approved_by="$APPROVED_BY" -v backup_ref="$BACKUP_REF" \
       -v export_sha256="$EXPORT_SHA" -f "$SQL" >>"$LOG" 2>&1; then
  echo "result=FAILED; the rollback transaction did not commit" >> "$LOG"
  echo "phase1c_rollback: FAILED; the rollback transaction did not commit (database unchanged). Details: $LOG" >&2
  tail -5 "$LOG" >&2
  exit 1
fi

# ---- 6. verification --------------------------------------------------
POST="$(ro "select (to_regclass('public.staff_roles') is null and to_regprocedure('public.containment_violations()') is null)::text
            || ':' || coalesce((select string_agg(nspname, ',') from pg_namespace where nspname like 'phase1c_archive_%'), 'none')
            || ':' || (select count(*) from supabase_migrations.schema_migrations where version in ('20261016170000', '20261016171000'))")"
echo "verified=$POST finished=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
case "$POST" in
  true:phase1c_archive_*:0) echo "phase1c_rollback: COMMITTED and verified. Archive: $(echo "$POST" | cut -d: -f2). Log: $LOG"
                            echo "  Next: run phase1c_matrix.sql and compare with the BEFORE side of PHASE1C_POLICY_GRANT_MATRIX.md (plan, section 9)." ;;
  *) echo "phase1c_rollback: committed, but read-only verification failed ($POST); investigate before anything else. Log: $LOG" >&2; exit 3 ;;
esac
