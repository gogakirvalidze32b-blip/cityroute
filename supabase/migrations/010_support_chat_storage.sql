-- =====================================================================
-- CityRoute — Support Chat: private Storage bucket + Storage RLS
-- =====================================================================
-- Run AFTER 009_support_chat_schema.sql.
--
-- Bucket "support-attachments" is PRIVATE (public = false). Files are only
-- ever shown through short-lived signed URLs created by a user who passes
-- the SELECT policy below (conversation owner or support admin).
--
-- Object path convention (enforced by the INSERT policy and by
-- send_support_message): <conversation_id>/<random-uuid>.<jpg|png|webp>
--
-- No UPDATE / DELETE policies exist for clients: a user cannot overwrite or
-- delete files. Orphan clean-up is a server-side job (see
-- support_orphan_uploads() below and the support-cleanup-orphans function).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'support-attachments',
  'support-attachments',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Upload: only into a folder named after a conversation you own, with a
-- strictly shaped file name.
drop policy if exists support_attachments_insert_own on storage.objects;
create policy support_attachments_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'support-attachments'
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and exists (
      select 1
      from public.support_conversations c
      where c.user_id = (select auth.uid())
        and c.id::text = (storage.foldername(name))[1]
    )
  );

-- Read (needed to create signed URLs): conversation owner or support admin.
drop policy if exists support_attachments_select_participants on storage.objects;
create policy support_attachments_select_participants
  on storage.objects for select to authenticated
  using (
    bucket_id = 'support-attachments'
    and (
      (select public.is_support_admin())
      or exists (
        select 1
        from public.support_conversations c
        where c.user_id = (select auth.uid())
          and c.id::text = (storage.foldername(name))[1]
      )
    )
  );

-- ---------------------------------------------------------------------
-- Orphan detection: uploaded files that never got attached to a message
-- (abandoned / failed sends) or whose message was deleted. Server-side only.
-- Removing the rows is done through the Storage API by the
-- support-cleanup-orphans Edge Function (deleting from storage.objects with
-- SQL would leave the underlying file behind).
-- ---------------------------------------------------------------------
create or replace function public.support_orphan_uploads(
  p_older_than interval default interval '1 day',
  p_limit integer default 500
)
returns table (name text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'support-attachments'
    and o.created_at < now() - p_older_than
    and not exists (
      select 1 from public.support_message_attachments a
      where a.storage_path = o.name
    )
  order by o.created_at
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.support_orphan_uploads(interval, integer) from public, anon, authenticated;
grant execute on function public.support_orphan_uploads(interval, integer) to service_role;
