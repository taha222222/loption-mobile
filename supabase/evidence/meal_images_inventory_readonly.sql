-- =====================================================================
-- READ-ONLY per-object inventory of the public `meal-images` bucket.
-- Run in the Supabase SQL Editor of STAGING (or a local test database).
-- It only SELECTs from storage.objects, storage.buckets and
-- public.user_profiles; it changes nothing and downloads no bytes.
--
-- Output: one JSON document listing every object with
--   id, path, declared MIME type, size, created/updated/last-accessed
--   timestamps, cache control, the storage backend's ETag, the file
--   extension, review flags, and the CLASS of uploader.
-- Privacy: no user id, e-mail, name or phone is printed. The uploader is
-- reported only as a class: 'none (service role / dashboard)',
-- 'legacy admin profile' (role=admin and is_admin=true), or
-- 'other signed-in account' (any customer, driver or the flagged
-- account; such uploads are a provenance concern on their own).
-- Hashes: `etag_backend` is whatever the storage backend recorded. For
-- single-part uploads on the S3/file backends it is usually the MD5 of the
-- bytes, but it is NOT a verified content hash. Verified SHA-256 hashes come
-- from supabase/tools/meal_images_scan.py, which downloads and checks the
-- bytes.
-- Feed the output to: supabase/tools/meal_images_scan.py --inventory <file>
-- =====================================================================
with objs as (
  select o.id, o.name, o.owner, o.created_at, o.updated_at, o.last_accessed_at,
         o.metadata ->> 'mimetype'     as declared_mimetype,
         (o.metadata ->> 'size')::bigint as size_bytes,
         o.metadata ->> 'eTag'         as etag_backend,
         o.metadata ->> 'cacheControl' as cache_control,
         lower(substring(o.name from '\.([A-Za-z0-9]{1,8})$')) as extension
    from storage.objects o
   where o.bucket_id = 'meal-images'
),
classified as (
  select o.*,
         case when o.owner is null then 'none (service role / dashboard)'
              when exists (select 1 from public.user_profiles p
                            where p.user_id = o.owner and p.role = 'admin' and p.is_admin)
                then 'legacy admin profile'
              else 'other signed-in account' end as uploader_class
    from objs o
)
select jsonb_pretty(jsonb_build_object(
  'generated_at', now(),
  'bucket', (select jsonb_build_object('id', b.id, 'public', b.public,
                                       'file_size_limit', b.file_size_limit,
                                       'allowed_mime_types', b.allowed_mime_types)
               from storage.buckets b where b.id = 'meal-images'),
  'approved', jsonb_build_object('max_bytes', 5242880,
                                 'mime_types', jsonb_build_array('image/jpeg', 'image/png', 'image/webp')),
  'object_count', (select count(*) from classified),
  'objects', coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'path', c.name,
      'public_url_path', '/object/public/meal-images/' || c.name,
      'declared_mimetype', c.declared_mimetype,
      'size_bytes', c.size_bytes,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'last_accessed_at', c.last_accessed_at,
      'cache_control', c.cache_control,
      'etag_backend', c.etag_backend,
      'extension', c.extension,
      'uploader_class', c.uploader_class,
      'flags', jsonb_build_object(
          'declared_type_not_approved', coalesce(c.declared_mimetype, '') not in ('image/jpeg', 'image/png', 'image/webp'),
          'over_5_mib', coalesce(c.size_bytes, 0) > 5242880,
          'extension_mismatch', not coalesce(
              (c.extension in ('jpg', 'jpeg') and c.declared_mimetype = 'image/jpeg')
           or (c.extension = 'png' and c.declared_mimetype = 'image/png')
           or (c.extension = 'webp' and c.declared_mimetype = 'image/webp'), false),
          'non_staff_uploader', c.uploader_class = 'other signed-in account'))
      order by c.name) from classified c), '[]'::jsonb)
)) as meal_images_inventory;
