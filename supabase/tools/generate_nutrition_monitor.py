#!/usr/bin/env python3
"""Generates the Phase 1C monitor blocks used by the V1 migrations.

The Phase 1C function public.containment_violations() reports every RLS
policy and client-callable SECURITY DEFINER function that is not in its
reviewed lists. Each later V1 migration re-creates the monitor with exactly
its own reviewed entries appended to those of the migrations before it, and
nothing else changed; its rollback re-creates the previous monitor.
  * nutrition (20261029120000): seven owner-only policies, two client-callable
    functions. Rollback: the original Phase 1C function.
  * activity (20261030120000): owner-only policies on the activity tables.
    Rollback: the nutrition monitor.
  * standalone tracking (20261103120000): owner-only policies on the gym
    log tables. Rollback: the activity monitor and the activity-migration
    versions of the functions it replaced.
  * account deletion (20261104120000): one client-callable definer function,
    public.delete_my_account(text). Rollback: the standalone monitor.

Both blocks are copied mechanically from the committed Phase 1C migration so
that a reviewer only has to read the appended entries below.

Usage:
  python3 -I supabase/tools/generate_nutrition_monitor.py          # rewrite blocks
  python3 -I supabase/tools/generate_nutrition_monitor.py --check  # fail if stale
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
PHASE1C = ROOT / "supabase/migrations/20261016170000_phase1c_security_containment.sql"
MIGRATION = ROOT / "supabase/migrations/20261029120000_v1_nutrition_tracking_engagement.sql"
ROLLBACK = ROOT / "supabase/rollback/v1_nutrition_tracking_rollback.sql"
ACTIVITY_MIGRATION = ROOT / "supabase/migrations/20261030120000_v1_activity_tracking.sql"
ACTIVITY_ROLLBACK = ROOT / "supabase/rollback/v1_activity_tracking_rollback.sql"
STANDALONE_MIGRATION = ROOT / "supabase/migrations/20261103120000_v1_standalone_tracking.sql"
STANDALONE_ROLLBACK = ROOT / "supabase/rollback/v1_standalone_tracking_rollback.sql"
ACCOUNT_MIGRATION = ROOT / "supabase/migrations/20261104120000_v1_account_deletion.sql"
ACCOUNT_ROLLBACK = ROOT / "supabase/rollback/v1_account_deletion_rollback.sql"
ORDER_MIGRATION = ROOT / "supabase/migrations/20261105120000_v1_order_workflow.sql"
ORDER_ROLLBACK = ROOT / "supabase/rollback/v1_order_workflow_rollback.sql"
BEGIN, END = "-- BEGIN GENERATED MONITOR\n", "-- END GENERATED MONITOR\n"

# Reviewed definitions added by the nutrition migration, as PostgreSQL 17
# prints them in pg_policies (table|name|mode|roles|command|USING|WITH CHECK).
OWNER = "(user_id = ( SELECT auth.uid() AS uid))"
NEW_POLICIES = [
    f"notification_preferences|notification_prefs_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"notification_preferences|notification_prefs_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
    f"notification_preferences|notification_prefs_owner_update|PERMISSIVE|{{authenticated}}|UPDATE|{OWNER}|{OWNER}",
    f"nutrition_daily_targets|nutrition_targets_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
    f"nutrition_log_entries|nutrition_entries_owner_delete_mark|PERMISSIVE|{{authenticated}}|UPDATE|{OWNER}|{OWNER}",
    f"nutrition_log_entries|nutrition_entries_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"nutrition_log_entries|nutrition_entries_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
]
NEW_DEFINER_FUNCTIONS = ["public.register_push_token(text,text)", "public.deactivate_push_token(text)"]

# Reviewed definitions added by the activity migration (owner-only).
ACTIVITY_POLICIES = [
    f"activity_daily_totals|activity_days_owner_delete|PERMISSIVE|{{authenticated}}|DELETE|{OWNER}|-",
    f"activity_daily_totals|activity_days_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"activity_daily_totals|activity_days_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
    f"activity_daily_totals|activity_days_owner_update|PERMISSIVE|{{authenticated}}|UPDATE|{OWNER}|{OWNER}",
    f"workout_sessions|workouts_owner_delete|PERMISSIVE|{{authenticated}}|DELETE|{OWNER}|-",
    f"workout_sessions|workouts_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"workout_sessions|workouts_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
]
ACTIVITY_DEFINER_FUNCTIONS: list = []

# Reviewed definitions added by the standalone-tracking migration (owner-only).
STANDALONE_POLICIES = [
    f"workout_exercises|gym_exercises_owner_delete|PERMISSIVE|{{authenticated}}|DELETE|{OWNER}|-",
    f"workout_exercises|gym_exercises_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"workout_exercises|gym_exercises_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
    f"workout_sets|gym_sets_owner_delete|PERMISSIVE|{{authenticated}}|DELETE|{OWNER}|-",
    f"workout_sets|gym_sets_owner_insert|PERMISSIVE|{{authenticated}}|INSERT|-|{OWNER}",
    f"workout_sets|gym_sets_owner_read|PERMISSIVE|{{authenticated}}|SELECT|{OWNER}|-",
]
# Functions the standalone migration replaces; its rollback restores the
# activity-migration versions, copied from that migration.
STANDALONE_REPLACED = [
    "activity_daily_prepare", "workout_session_prepare", "nutrition_log_entry_prepare",
    "activity_workouts", "activity_daily_summary",
]


def original_monitor() -> str:
    text = PHASE1C.read_text()
    start = text.index("create or replace function public.containment_violations()")
    end = text.index("$cv$;\n", start) + len("$cv$;\n")
    return text[start:end]


def extended_monitor(policies=None, definers=None) -> str:
    policies = NEW_POLICIES if policies is None else policies
    definers = NEW_DEFINER_FUNCTIONS if definers is None else definers
    block = original_monitor()
    policies_end = "'];\n  reviewed_storage_policies"
    assert block.count(policies_end) == 1, "policy list end not found exactly once"
    added = "".join(f",\n    '{p}'" for p in policies)
    block = block.replace(policies_end, "'" + added + "];\n  reviewed_storage_policies")
    definer_end = "'public.set_driver_availability(boolean)'];"
    assert block.count(definer_end) == 1, "definer list end not found exactly once"
    block = block.replace(
        definer_end,
        "'public.set_driver_availability(boolean)',\n    " + ",".join(f"'{f}'" for f in definers) + "];",
    )
    return block


def activity_monitor() -> str:
    return extended_monitor(NEW_POLICIES + ACTIVITY_POLICIES, NEW_DEFINER_FUNCTIONS + ACTIVITY_DEFINER_FUNCTIONS)


def standalone_monitor() -> str:
    return extended_monitor(NEW_POLICIES + ACTIVITY_POLICIES + STANDALONE_POLICIES,
                            NEW_DEFINER_FUNCTIONS + ACTIVITY_DEFINER_FUNCTIONS)


# The account-deletion migration adds one client-callable definer function.
ACCOUNT_DEFINER_FUNCTIONS = ["public.delete_my_account(text)"]


def account_monitor() -> str:
    return extended_monitor(NEW_POLICIES + ACTIVITY_POLICIES + STANDALONE_POLICIES,
                            NEW_DEFINER_FUNCTIONS + ACTIVITY_DEFINER_FUNCTIONS + ACCOUNT_DEFINER_FUNCTIONS)


# The order-workflow migration: read policies for kitchen staff and cashiers,
# items/history visible with their order, admin read of the location
# history, and the client workflow functions (signatures without spaces).
ORDER_POLICIES = [
    "driver_location_points|driver_locations_admin_read|PERMISSIVE|{authenticated}|SELECT|( SELECT public.has_staff_role(''admin''::text) AS has_staff_role)|-",
    "order_items|order_items_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_items.order_id)))|-",
    "order_status_updates|order_status_read_with_order|PERMISSIVE|{authenticated}|SELECT|(EXISTS ( SELECT 1 FROM public.orders o WHERE (o.id = order_status_updates.order_id)))|-",
    "orders|orders_cashier_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''cashier''::text, kitchen_id))|-",
    "orders|orders_kitchen_staff_read|PERMISSIVE|{authenticated}|SELECT|((workflow_version IS NOT NULL) AND public.has_kitchen_role(''kitchen_staff''::text, kitchen_id))|-",
]
ORDER_DEFINER_FUNCTIONS = [
    "public.order_confirm(uuid)",
    "public.order_kitchen_update(uuid,text)",
    "public.order_assign_driver(uuid,uuid)",
    "public.order_driver_update(uuid,text)",
    "public.order_cancel(uuid,text)",
    "public.order_set_payment(uuid,text)",
    "public.driver_report_location(uuid,doubleprecision,doubleprecision,real,timestampwithtimezone)",
]


def order_monitor() -> str:
    return extended_monitor(NEW_POLICIES + ACTIVITY_POLICIES + STANDALONE_POLICIES + ORDER_POLICIES,
                            NEW_DEFINER_FUNCTIONS + ACTIVITY_DEFINER_FUNCTIONS + ACCOUNT_DEFINER_FUNCTIONS
                            + ORDER_DEFINER_FUNCTIONS)


def function_from(path: pathlib.Path, name: str) -> str:
    """One function definition of a migration, as CREATE OR REPLACE."""
    text = path.read_text()
    starts = [text.find(f"create {k}function public.{name}(") for k in ("", "or replace ")]
    starts = [s for s in starts if s >= 0]
    assert len(starts) == 1, f"{name}: expected exactly one definition in {path.name}"
    start = starts[0]
    body = text.index("as $$", start) + len("as $$")
    end = text.index("$$;\n", body) + len("$$;\n")
    head = text[start:end]
    return "create or replace" + head[len("create or replace"):] if head.startswith("create or replace") \
        else "create or replace" + head[len("create"):]


def activity_functions() -> str:
    return "".join(function_from(ACTIVITY_MIGRATION, n) for n in STANDALONE_REPLACED)


FN_BEGIN, FN_END = "-- BEGIN GENERATED ACTIVITY FUNCTIONS\n", "-- END GENERATED ACTIVITY FUNCTIONS\n"


LOG_BEGIN, LOG_END = "-- BEGIN GENERATED NUTRITION LOG TRIGGER\n", "-- END GENERATED NUTRITION LOG TRIGGER\n"


def original_log_trigger() -> str:
    """The nutrition migration's nutrition_log_entry_prepare(), as CREATE OR REPLACE
    (restored by the activity rollback)."""
    text = MIGRATION.read_text()
    start = text.index("create function public.nutrition_log_entry_prepare()")
    end = text.index("$$;\n", text.index("as $$", start) + len("as $$")) + len("$$;\n")
    return "create or replace" + text[start + len("create"):end]


def render(path: pathlib.Path, body: str) -> str:
    return render_string(path.read_text(), body)


def render_string(text: str, body: str, begin: str = BEGIN, end: str = END) -> str:
    head, rest = text.split(begin, 1)
    _, tail = rest.split(end, 1)
    return head + begin + body + end + tail


def main() -> int:
    rendered = {
        MIGRATION: render(MIGRATION, extended_monitor()),
        ROLLBACK: render(ROLLBACK, original_monitor()),
        ACTIVITY_MIGRATION: render(ACTIVITY_MIGRATION, activity_monitor()),
    }
    # The activity rollback restores both the nutrition monitor and the
    # nutrition migration's log trigger.
    activity_rb = render(ACTIVITY_ROLLBACK, extended_monitor())
    activity_rb = render_string(activity_rb, original_log_trigger(), LOG_BEGIN, LOG_END)
    rendered[ACTIVITY_ROLLBACK] = activity_rb
    rendered[STANDALONE_MIGRATION] = render(STANDALONE_MIGRATION, standalone_monitor())
    standalone_rb = render(STANDALONE_ROLLBACK, activity_monitor())
    rendered[STANDALONE_ROLLBACK] = render_string(standalone_rb, activity_functions(), FN_BEGIN, FN_END)
    rendered[ACCOUNT_MIGRATION] = render(ACCOUNT_MIGRATION, account_monitor())
    rendered[ACCOUNT_ROLLBACK] = render(ACCOUNT_ROLLBACK, standalone_monitor())
    rendered[ORDER_MIGRATION] = render(ORDER_MIGRATION, order_monitor())
    rendered[ORDER_ROLLBACK] = render(ORDER_ROLLBACK, account_monitor())
    check = "--check" in sys.argv
    stale = []
    for path, new in rendered.items():
        if path.read_text() != new:
            if check:
                stale.append(str(path.relative_to(ROOT)))
            else:
                path.write_text(new)
    if stale:
        print("stale generated monitor block in: " + ", ".join(stale))
        return 1
    print("generated monitor blocks are up to date" if check else "generated monitor blocks written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
