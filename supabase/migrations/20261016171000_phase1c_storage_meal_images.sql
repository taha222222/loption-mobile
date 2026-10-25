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
-- CHANGE (CTO-approved 2026-10-17):
--   * the three write policies are replaced by admin-staff-only policies;
--   * (CTO decision 2026-10-25: restrict listing if public reads keep
--     working) "Public Access" (SELECT for anyone) is replaced by an
--     admin-only SELECT policy. Public object URLs (/object/public/meal-images/...)
--     do not use RLS and keep working; what anonymous users and customers
--     lose is LISTING the bucket (object names, ids, metadata). Admin
--     staff keep SELECT, which upload/upsert/delete need (tested);
--   * bucket meal-images: file_size_limit = 5242880 bytes (5 MiB) and
--     allowed_mime_types = {image/jpeg, image/png, image/webp}; SVG and
--     every other type is rejected by the Storage API. public stays true.
--     The previous values (NULL in the evidence) are written to
--     security_audit_log first; the rollback restores them exactly.
--   No object row is changed or deleted.
-- LIMITATION: the Storage API checks the DECLARED Content-Type and the
--   byte length only. It does not prove the bytes are a valid image (an
--   SVG or HTML body declared as image/png is accepted). Byte-level
--   validation needs a trusted server-side path (see the plan, section 6).
-- PERMISSION: storage.objects is owned by supabase_storage_admin. The
--   migration role (postgres) may manage its policies only through
--   Supabase's supautils.policy_grants (or ownership); the preflight checks
--   this and aborts otherwise.
-- Transaction: this file contains its own BEGIN ... COMMIT and the same
--   execution guards as the core migration (role postgres; deferred commit
--   gate that fails COMMIT unless preflight and postcondition completed).
--   Supported procedure: `supabase db push` (see the plan). Re-runnable
--   (tested).
-- =====================================================================

begin;

set local lock_timeout = '10s';

do $role$
begin
  if current_user <> 'postgres' then
    raise exception 'Phase 1C storage: must run as role postgres (current_user=%, session_user=%); aborting before any change',
      current_user, session_user using errcode = '42501';
  end if;
end
$role$;

create temp table phase1c_storage_gate_ok (step text primary key) on commit drop;
create temp table phase1c_storage_gate (
  step text constraint phase1c_storage_guard_did_not_pass references phase1c_storage_gate_ok deferrable initially deferred
) on commit drop;
insert into phase1c_storage_gate values ('storage preflight'), ('storage postcondition');

do $preflight$
declare
  problems text[] := '{}';
  missing text;
  v record;
  bucket record;
  approved_size  bigint := 5242880;
  approved_types text[] := array['image/jpeg','image/png','image/webp'];
  known text[] := array[
    -- evidence
    'Authenticated users can upload','Public Access','Users can delete own uploads','Users can update own uploads',
    -- created here
    'staff_admin_select_meal_images','staff_admin_insert_meal_images','staff_admin_update_meal_images',
    'staff_admin_delete_meal_images'];
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
  -- meal-images bucket must be in a reviewed state: the evidence state
  -- (public, no limits) or, on a re-run, exactly the approved state.
  if to_regclass('storage.buckets') is not null then
    select b.public, b.file_size_limit, b.allowed_mime_types into bucket
      from storage.buckets b where b.id = 'meal-images';
    if found then
      if bucket.public is distinct from true then
        problems := problems || 'bucket meal-images is not public (unexpected state)'::text;
      end if;
      if not ((bucket.file_size_limit is null and bucket.allowed_mime_types is null)
              or (bucket.file_size_limit = approved_size and bucket.allowed_mime_types = approved_types)) then
        problems := problems || format('bucket meal-images has unexpected limits: file_size_limit=%s allowed_mime_types=%s',
                                       coalesce(bucket.file_size_limit::text, 'NULL'),
                                       coalesce(bucket.allowed_mime_types::text, 'NULL'));
      end if;
    end if;
  end if;
  if to_regprocedure('public.containment_violations()') is not null then
    for v in select * from public.containment_violations() c where c.category = 'drift' loop
      problems := problems || ('drift: ' || v.object || ' - ' || v.problem);
    end loop;
  end if;
  if cardinality(problems) > 0 then
    raise exception 'Phase 1C storage preflight failed; aborting the migration transaction (its COMMIT cannot succeed): %',
      array_to_string(problems, ' | ') using errcode = 'P0001';
  end if;
  insert into pg_temp.phase1c_storage_gate_ok values ('storage preflight');
end
$preflight$;

drop policy if exists "Authenticated users can upload" on storage.objects;  -- INSERT into meal-images for ANY signed-in user
drop policy if exists "Users can update own uploads"   on storage.objects;  -- UPDATE by uploader, no staff check
drop policy if exists "Users can delete own uploads"   on storage.objects;  -- DELETE by uploader, no staff check
drop policy if exists "Public Access"                  on storage.objects;  -- SELECT (listing) for anyone

drop policy if exists staff_admin_select_meal_images on storage.objects;
create policy staff_admin_select_meal_images on storage.objects for select to authenticated
  using (bucket_id = 'meal-images' and (select public.has_staff_role('admin')));

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

-- Bucket limits (approved): record the exact previous values first
-- (JSON null when the column was NULL), then set the approved values.
-- On a re-run the bucket is already approved: nothing is changed or logged.
with old as (
  select b.id, b.file_size_limit, b.allowed_mime_types
    from storage.buckets b
   where b.id = 'meal-images'
     and (b.file_size_limit is distinct from 5242880
          or b.allowed_mime_types is distinct from array['image/jpeg','image/png','image/webp']::text[])
), logged as (
  insert into public.security_audit_log (actor_id, action, target_user_id, details)
  select null, 'storage.bucket.limits_set', null,
         jsonb_build_object('bucket', o.id,
                            'old_file_size_limit', o.file_size_limit,
                            'old_allowed_mime_types', to_jsonb(o.allowed_mime_types),
                            'new_file_size_limit', 5242880,
                            'new_allowed_mime_types', to_jsonb(array['image/jpeg','image/png','image/webp']),
                            'migration', '20261016171000')
    from old o
  returning details ->> 'bucket' as bucket_id
)
update storage.buckets b
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']::text[]
  from logged l
 where b.id = l.bucket_id;

-- Postcondition: containment is complete only with ZERO violations of
-- every category (drift, containment, storage).
do $post$
declare
  bad text;
begin
  select string_agg(v.category || ': ' || v.object || ' - ' || v.problem, ' | ') into bad
    from public.containment_violations() v;
  if bad is not null then
    raise exception 'Phase 1C storage postcondition failed; aborting the migration transaction (its COMMIT cannot succeed): %', bad;
  end if;
  insert into pg_temp.phase1c_storage_gate_ok values ('storage postcondition');
end
$post$;

commit;
