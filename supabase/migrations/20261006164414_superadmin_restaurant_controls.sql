-- Restaurant creation is a platform operation, not an owner self-signup flow.
drop policy if exists restaurants_create on public.restaurants;
create policy restaurants_create on public.restaurants
for insert to authenticated
with check (private.is_superadmin() and created_by = (select auth.uid()));

-- TRUNCATE bypasses row-level policies and must not be exposed to web roles.
revoke truncate on public.restaurants from anon, authenticated;
