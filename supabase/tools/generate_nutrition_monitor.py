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
]
ACTIVITY_DEFINER_FUNCTIONS: list = []


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


def render(path: pathlib.Path, body: str) -> str:
    text = path.read_text()
    head, rest = text.split(BEGIN, 1)
    _, tail = rest.split(END, 1)
    return head + BEGIN + body + END + tail


def main() -> int:
    targets = {
        MIGRATION: extended_monitor(),
        ROLLBACK: original_monitor(),
        ACTIVITY_MIGRATION: activity_monitor(),
        ACTIVITY_ROLLBACK: extended_monitor(),
    }
    check = "--check" in sys.argv
    stale = []
    for path, body in targets.items():
        new = render(path, body)
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
