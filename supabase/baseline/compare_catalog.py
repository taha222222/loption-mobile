#!/usr/bin/env python3
"""Compare a catalog export taken from a disposable database with the staging
evidence, restricted to what the baseline is meant to reproduce.

Usage: compare_catalog.py EVIDENCE.json LOCAL.json [--after-migration]

Compared (public schema only): tables + RLS flags, columns, constraints,
indexes, policies, functions (definition, SECURITY DEFINER, config,
anon/authenticated EXECUTE), triggers, effective anon/authenticated table
privileges, column ACLs, enums, views, Realtime publication, extensions.

Not compared, with reason:
  storage.* objects, storage buckets - platform-managed, absent from the
      bare supabase/postgres image;
  default_privileges, roles - cluster-level Supabase configuration, printed
      for information (they come from the image, not from the baseline);
  generated_at, server_version - expected to differ.

Exit 0 when every compared section is identical.
"""
import json
import sys


def load(path):
    with open(path) as fh:
        return json.load(fh)


def public_only(rows, key="schema"):
    return [r for r in (rows or []) if r.get(key, "public") == "public"]


def norm_constraints(rows):
    # conrelid::regclass renders without "public." when public is on the path.
    out = []
    for r in rows or []:
        r = dict(r)
        r["table"] = r["table"].removeprefix("public.")
        out.append(r)
    return out


SECTIONS = {
    "tables": lambda d: public_only(d.get("tables")),
    "columns": lambda d: d.get("columns") or [],
    "constraints": lambda d: norm_constraints(d.get("constraints")),
    "indexes": lambda d: d.get("indexes") or [],
    "policies": lambda d: public_only(d.get("policies")),
    "functions": lambda d: public_only(d.get("functions")),
    "triggers": lambda d: public_only(d.get("triggers")),
    "effective_table_privileges": lambda d: public_only(d.get("effective_table_privileges")),
    "column_level_acls": lambda d: d.get("column_level_acls") or [],
    "enums": lambda d: d.get("enums") or [],
    "views": lambda d: d.get("views") or [],
    "realtime_publication": lambda d: d.get("realtime_publication") or [],
    "extensions": lambda d: sorted(d.get("extensions") or [], key=lambda e: e["name"]),
}


def canon(rows):
    return sorted(json.dumps(r, sort_keys=True) for r in rows)


def main():
    ev, local = load(sys.argv[1]), load(sys.argv[2])
    failed = 0
    for name, get in SECTIONS.items():
        a, b = canon(get(ev)), canon(get(local))
        if a == b:
            print(f"  identical  {name} ({len(a)} items)")
            continue
        failed += 1
        only_ev = sorted(set(a) - set(b))
        only_local = sorted(set(b) - set(a))
        print(f"  DIFFERENT  {name}: {len(only_ev)} only in evidence, {len(only_local)} only in local")
        for x in only_ev[:10]:
            print("     - evidence:", x[:400])
        for x in only_local[:10]:
            print("     + local:   ", x[:400])
    same_defaults = canon(ev.get("default_privileges") or []) == canon(local.get("default_privileges") or [])
    print(f"  info       default_privileges {'identical' if same_defaults else 'differ'} (image configuration, not baseline)")
    print("RESULT:", "baseline reproduces the evidence" if failed == 0 else f"{failed} section(s) differ")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
