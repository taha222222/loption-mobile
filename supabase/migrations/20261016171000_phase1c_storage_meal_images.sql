-- =====================================================================
-- L'OPTION V1 — Phase 1C (storage): meal-images writes for admin staff only
--
-- STATUS: FOR CTO REVIEW. Not applied to any remote database.
-- TARGET: staging only, after approval, immediately after
--         20261016170000_phase1c_security_containment.sql (same db push).
-- EVIDENCE (2026-10-15 catalog): bucket 'meal-images' is PUBLIC with no
--   size or MIME limit; storage.objects policies:
--     "Authenticated users can upload"  INSERT  any signed-in user
--     "Users can update own uploads"    UPDATE  uploader (owner) only
--     "Users can delete own uploads"    DELETE  uploader (owner) only
--     "Public Access"                   SELECT  anyone
--   Verified against the real Storage API (supabase/storage-api v1.79.30,
--   local): with these policies a signed-in CUSTOMER can upload into the
--   public bucket (HTTP 200).
-- CHANGE: the three write policies are replaced by admin-staff-only
--   policies. "Public Access" (read) is kept: the app serves menu images by
--   public URL. No object or bucket row is changed; bucket settings
--   (public flag, size/MIME limits) are NOT changed here (CTO decision).
-- PERMISSION: storage.objects is owned by supabase_storage_admin. The
--   migration role (postgres) may manage its policies only through
--   Supabase's supautils.policy_grants (or ownership); the preflight checks
--   this and aborts otherwise.
-- Transaction: one transaction; re-runnable (tested).
-- =====================================================================

set lock_timeout = '10s';

do $preflight$
declare
  problems text[] := '{}';
  missing text;
  v record;
  known text[] := array[
    -- evidence
    'Authenticated users can upload','Public Access','Users can delete own uploads','Users can update own uploads',
    -- created here
    'staff_admin_insert_meal_images','staff_admin_update_meal_images','staff_admin_delete_meal_images'];
begin
  if to_regprocedure('public.has_staff_role(text)') is null
     or to_regprocedure('public.containment_violations()') is null then
    problems := problems || 'core containment migration 20261016170000 is not applied'::text;
  end if;
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    problems := problems || 'storage.objects / storage.buckets missing'::text;
  else
    if not exists (select 1 from storage.buckets where id = 'meal-images') then
      problems := problems || 'bucket meal-images missing'::text;
    end if;
    select string_agg(policyname, '; ') into missing
      from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and policyname <> all (known);
    if missing is not null then
      problems := problems || ('unreviewed storage.objects policies: ' || missing);
    end if;
    if not (pg_has_role(current_user, (select relowner from pg_class where oid = 'storage.objects'::regclass), 'USAGE')
            or coalesce(current_setting('supautils.policy_grants', true), '') ~ 'storage\.objects') then
      problems := problems || ('role ' || current_user || ' cannot manage storage.objects policies (not owner, not in supautils.policy_grants)');
    end if;
  end if;
  if to_regprocedure('public.containment_violations()') is not null then
    for v in select * from public.containment_violations() c where c.category = 'drift' loop
      problems := problems || ('drift: ' || v.object || ' - ' || v.problem);
    end loop;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Phase 1C storage preflight failed; nothing was changed: %', array_to_string(problems, ' | ')
      using errcode = 'P0001';
  end if;
end
$preflight$;

drop policy if exists "Authenticated users can upload" on storage.objects;  -- INSERT into meal-images for ANY signed-in user
drop policy if exists "Users can update own uploads"   on storage.objects;  -- UPDATE by uploader, no staff check
drop policy if exists "Users can delete own uploads"   on storage.objects;  -- DELETE by uploader, no staff check

drop policy if exists staff_admin_insert_meal_images on storage.objects;
create policy staff_admin_insert_meal_images on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-images' and (select public.has_staff_role('admin')));
drop policy if exists staff_admin_update_meal_images on storage.objects;
create policy staff_admin_update_meal_images on storage.objects for update to authenticated
  using (bucket_id = 'meal-images' and (select public.has_staff_role('admin')))
  with check (bucket_id = 'meal-images' and (select public.has_staff_role('admin')));
drop policy if exists staff_admin_delete_meal_images on storage.objects;
create policy staff_admin_delete_meal_images on storage.objects for delete to authenticated
  using (bucket_id = 'meal-images' and (select public.has_staff_role('admin')));

-- Postcondition: containment is complete only with ZERO violations of
-- every category (drift, containment, storage).
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v;
  if bad is not null then
    raise exception 'Phase 1C storage postcondition failed (rolled back): %', bad;
  end if;
end
$post$;

reset lock_timeout;
