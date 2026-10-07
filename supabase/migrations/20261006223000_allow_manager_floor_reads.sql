drop policy if exists floors_manager_read on public.floors;
create policy floors_manager_read on public.floors for select to authenticated
  using (private.has_restaurant_role(restaurant_id, ARRAY['owner'::app_role, 'manager'::app_role]));

drop policy if exists tables_manager_read on public.restaurant_tables;
create policy tables_manager_read on public.restaurant_tables for select to authenticated
  using (exists (select 1 from public.floors f where f.id = restaurant_tables.floor_id and private.has_restaurant_role(f.restaurant_id, ARRAY['owner'::app_role, 'manager'::app_role])));
