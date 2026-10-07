-- Existing public-read policies call these guarded helpers even for anonymous requests.
grant usage on schema private to anon;
grant execute on function private.is_superadmin() to anon;
grant execute on function private.has_restaurant_role(uuid, public.app_role[]) to anon;
