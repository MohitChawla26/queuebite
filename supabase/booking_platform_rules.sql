-- Follow-up rules for customer menus, pre-orders, tenant-safe operations, and bills.
create policy menu_items_customer_read on public.menu_items for select to anon,authenticated
using (exists(select 1 from public.restaurants r where r.id=restaurant_id and r.active));
create policy restaurants_owner_manager_update on public.restaurants for update to authenticated
using (private.has_restaurant_role(id,array['owner','manager']::public.app_role[]))
with check (private.has_restaurant_role(id,array['owner','manager']::public.app_role[]));
create policy invitations_manager_waiter_insert on public.restaurant_invitations for insert to authenticated
with check (invited_by=auth.uid() and role='waiter' and private.has_restaurant_role(restaurant_id,array['manager']::public.app_role[]));
revoke update on public.bookings from authenticated;
grant update(status) on public.bookings to authenticated;
grant select on public.menu_items to anon;

create or replace function public.save_preorder(target_booking uuid, lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.bookings%rowtype; line jsonb; item public.menu_items%rowtype; portion text; qty integer; price numeric; preorder_id uuid; running_total integer := 0;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into b from public.bookings where id=target_booking and customer_id=auth.uid() and status='pending' and expires_at>now() for update;
  if not found then raise exception 'Booking hold expired'; end if;
  if jsonb_typeof(lines)<>'array' or jsonb_array_length(lines)>50 then raise exception 'Invalid pre-order'; end if;
  delete from public.preorders where booking_id=b.id;
  insert into public.preorders (booking_id,total_paise) values (b.id,0) returning id into preorder_id;
  for line in select value from jsonb_array_elements(lines) loop
    select * into item from public.menu_items where id=(line->>'menu_item_id')::uuid and restaurant_id=b.restaurant_id and available;
    if not found then raise exception 'Dish unavailable'; end if;
    portion := line->>'portion'; qty := (line->>'quantity')::integer;
    if qty<1 or qty>99 then raise exception 'Invalid quantity'; end if;
    price := case portion when 'normal' then item.price when 'half' then item.half_price when 'full' then item.full_price else null end;
    if price is null then raise exception 'Portion unavailable'; end if;
    insert into public.preorder_items (preorder_id,menu_item_id,portion,quantity,unit_price_paise)
    values (preorder_id,item.id,portion,qty,round(price*100)::integer);
    running_total := running_total+round(price*100)::integer*qty;
  end loop;
  update public.preorders set total_paise=running_total where id=preorder_id;
  return preorder_id;
end $$;
revoke all on function public.save_preorder(uuid,jsonb) from public;
grant execute on function public.save_preorder(uuid,jsonb) to authenticated;

create or replace function public.cancel_my_booking(target_booking uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  update public.bookings set status='cancelled' where id=target_booking and customer_id=auth.uid() and status in ('pending','confirmed');
  if not found then raise exception 'Booking cannot be cancelled'; end if;
end $$;
revoke all on function public.cancel_my_booking(uuid) from public;
grant execute on function public.cancel_my_booking(uuid) to authenticated;

create or replace function private.validate_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.table_id is not null and private.restaurant_for_table(new.table_id) is distinct from new.restaurant_id then raise exception 'Table belongs to another restaurant'; end if;
  if new.booking_id is not null and not exists(select 1 from public.bookings b where b.id=new.booking_id and b.restaurant_id=new.restaurant_id) then raise exception 'Booking belongs to another restaurant'; end if;
  return new;
end $$;
drop trigger if exists validate_order on public.orders;
create trigger validate_order before insert or update on public.orders for each row execute function private.validate_order();

create or replace function private.validate_order_item() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o public.orders%rowtype; item public.menu_items%rowtype; amount numeric;
begin
  select * into o from public.orders where id=new.order_id;
  select * into item from public.menu_items where id=new.menu_item_id and restaurant_id=o.restaurant_id and available;
  if not found then raise exception 'Dish unavailable at this restaurant'; end if;
  amount := case new.portion when 'normal' then item.price when 'half' then item.half_price when 'full' then item.full_price else null end;
  if amount is null then raise exception 'Portion unavailable'; end if;
  new.unit_price_paise := round(amount*100)::integer;
  return new;
end $$;
drop trigger if exists validate_order_item on public.order_items;
create trigger validate_order_item before insert or update on public.order_items for each row execute function private.validate_order_item();

create or replace function private.calculate_bill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare linked_booking uuid;
begin
  select booking_id into linked_booking from public.orders where id=new.order_id;
  select coalesce(sum(quantity*unit_price_paise),0) into new.subtotal_paise from public.order_items where order_id=new.order_id;
  new.deposit_deducted_paise := case when linked_booking is not null and exists(select 1 from public.payments p where p.booking_id=linked_booking and p.status='paid') then 5000 else 0 end;
  new.total_paise := greatest(0,new.subtotal_paise+new.tax_paise+new.service_paise-new.discount_paise-new.deposit_deducted_paise);
  return new;
end $$;
drop trigger if exists calculate_bill on public.bills;
create trigger calculate_bill before insert or update on public.bills for each row execute function private.calculate_bill();

create policy profiles_staff_read on public.profiles for select to authenticated
using (exists(select 1 from public.restaurant_memberships member join public.restaurant_memberships viewer on viewer.restaurant_id=member.restaurant_id and viewer.user_id=auth.uid() and viewer.role in ('owner','manager') where member.user_id=id));

do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='bookings') then alter publication supabase_realtime add table public.bookings; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then alter publication supabase_realtime add table public.orders; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='menu_items') then alter publication supabase_realtime add table public.menu_items; end if;
end $$;
