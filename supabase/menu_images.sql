insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('queuebite-images','queuebite-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy queuebite_image_upload on storage.objects for insert to authenticated
with check (bucket_id='queuebite-images' and exists (
  select 1 from public.restaurants r where r.id::text=(storage.foldername(name))[1]
  and private.has_restaurant_role(r.id,array['owner','manager']::public.app_role[])
));
create policy queuebite_image_manage on storage.objects for update to authenticated
using (bucket_id='queuebite-images' and exists (
  select 1 from public.restaurants r where r.id::text=(storage.foldername(name))[1]
  and private.has_restaurant_role(r.id,array['owner','manager']::public.app_role[])
)) with check (bucket_id='queuebite-images' and exists (
  select 1 from public.restaurants r where r.id::text=(storage.foldername(name))[1]
  and private.has_restaurant_role(r.id,array['owner','manager']::public.app_role[])
));
create policy queuebite_image_delete on storage.objects for delete to authenticated
using (bucket_id='queuebite-images' and exists (
  select 1 from public.restaurants r where r.id::text=(storage.foldername(name))[1]
  and private.has_restaurant_role(r.id,array['owner','manager']::public.app_role[])
));
create policy queuebite_image_select on storage.objects for select to authenticated
using (bucket_id='queuebite-images' and exists (
  select 1 from public.restaurants r where r.id::text=(storage.foldername(name))[1]
  and private.has_restaurant_role(r.id,array['owner','manager']::public.app_role[])
));
