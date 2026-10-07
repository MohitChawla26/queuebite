-- QueueBite booking and operations extension. Apply to the connected Supabase project.
create extension if not exists btree_gist;

alter table public.restaurants add column if not exists cuisine text;
alter table public.restaurants add column if not exists location text;
alter table public.restaurants add column if not exists image_url text;
alter table public.restaurants add column if not exists rating numeric(2,1);
alter table public.restaurants add column if not exists timezone text not null default 'Asia/Kolkata';
alter table public.restaurants add column if not exists booking_duration_minutes integer not null default 90 check (booking_duration_minutes between 30 and 360);
alter table public.restaurants add column if not exists buffer_minutes integer not null default 15 check (buffer_minutes between 0 and 120);
alter table public.restaurants add column if not exists advance_days integer not null default 30 check (advance_days between 1 and 365);
alter table public.restaurants add column if not exists minimum_notice_minutes integer not null default 60 check (minimum_notice_minutes between 0 and 10080);
alter table public.restaurants add column if not exists temporarily_closed boolean not null default false;
alter table public.restaurants add constraint restaurants_rating_range check (rating is null or rating between 0 and 5);

alter table public.restaurant_tables add column if not exists online_bookable boolean not null default true;
alter table public.restaurant_tables add column if not exists merge_group text;
alter table public.restaurant_tables add column if not exists width numeric(6,2) not null default 12;
alter table public.restaurant_tables add column if not exists height numeric(6,2) not null default 12;

create table if not exists public.restaurant_hours (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  opens_at time,
  closes_at time,
  closed boolean not null default false,
  primary key (restaurant_id, weekday),
  check (closed or (opens_at is not null and closes_at is not null and closes_at > opens_at))
);
create table if not exists public.restaurant_closures (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  closed_on date not null,
  reason text,
  unique (restaurant_id, closed_on)
);
create table if not exists public.map_elements (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  kind text not null check (kind in ('wall','entry','exit','washroom')),
  x numeric(6,2) not null check (x between 0 and 100),
  y numeric(6,2) not null check (y between 0 and 100),
  width numeric(6,2) not null default 10,
  height numeric(6,2) not null default 10,
  rotation numeric(6,2) not null default 0
);
create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  unique (restaurant_id, name)
);
alter table public.menu_items add column if not exists category_id uuid references public.menu_categories(id) on delete set null;
alter table public.menu_items add column if not exists image_url text;
alter table public.menu_items add column if not exists is_veg boolean not null default true;
alter table public.menu_items add column if not exists half_price numeric(10,2) check (half_price >= 0);
alter table public.menu_items add column if not exists full_price numeric(10,2) check (full_price >= 0);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  customer_id uuid not null references public.profiles(id),
  guest_count integer not null check (guest_count between 1 and 30),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  expires_at timestamptz,
  status text not null default 'pending' check (status in ('pending','confirmed','arrived','seated','completed','cancelled','no_show')),
  deposit_paise integer not null default 5000 check (deposit_paise = 5000),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','paid','refunded')),
  special_request text,
  source text not null default 'online' check (source in ('online','walk_in','staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and blocked_until >= ends_at)
);
create index if not exists bookings_restaurant_start_idx on public.bookings (restaurant_id, starts_at);
create index if not exists bookings_customer_idx on public.bookings (customer_id, created_at desc);
create table if not exists public.booking_tables (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id),
  blocked_range tstzrange not null,
  status text not null check (status in ('pending','confirmed','arrived','seated','completed','cancelled','no_show')),
  primary key (booking_id, table_id),
  exclude using gist (table_id with =, blocked_range with &&) where (status in ('pending','confirmed','arrived','seated'))
);
create index if not exists booking_tables_table_idx on public.booking_tables (table_id);
create table if not exists public.blocked_tables (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  blocked_range tstzrange not null,
  reason text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  exclude using gist (table_id with =, blocked_range with &&)
);
create table if not exists public.preorders (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  total_paise integer not null default 0 check (total_paise >= 0),
  created_at timestamptz not null default now()
);
create table if not exists public.preorder_items (
  id uuid primary key default gen_random_uuid(),
  preorder_id uuid not null references public.preorders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  portion text not null check (portion in ('normal','half','full')),
  quantity integer not null check (quantity between 1 and 99),
  unit_price_paise integer not null check (unit_price_paise >= 0)
);
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id),
  provider text not null default 'razorpay',
  provider_order_id text unique,
  provider_payment_id text unique,
  amount_paise integer not null check (amount_paise = 5000),
  status text not null default 'created' check (status in ('created','paid','failed','refunded')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id),
  booking_id uuid references public.bookings(id),
  table_id uuid references public.restaurant_tables(id),
  status text not null default 'placed' check (status in ('placed','accepted','preparing','ready','served','cancelled')),
  source text not null default 'walk_in' check (source in ('walk_in','preorder','table')),
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_restaurant_created_idx on public.orders (restaurant_id, created_at desc);
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id),
  portion text not null check (portion in ('normal','half','full')),
  quantity integer not null check (quantity between 1 and 99),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  notes text
);
create table if not exists public.kot (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  printed_at timestamptz not null default now(),
  printed_by uuid references public.profiles(id)
);
create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  subtotal_paise integer not null default 0,
  tax_paise integer not null default 0,
  service_paise integer not null default 0,
  discount_paise integer not null default 0,
  deposit_deducted_paise integer not null default 0 check (deposit_deducted_paise in (0,5000)),
  total_paise integer not null default 0 check (total_paise >= 0),
  status text not null default 'open' check (status in ('open','paid','void')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants(id),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.restaurant_for_table(target_table uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select f.restaurant_id from public.restaurant_tables t join public.floors f on f.id=t.floor_id where t.id=target_table
$$;
revoke all on function private.restaurant_for_table(uuid) from public;
grant execute on function private.restaurant_for_table(uuid) to anon, authenticated;

create or replace function private.sync_booking_tables() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_tables set status=new.status where booking_id=new.id;
  new.updated_at=now();
  return new;
end $$;
drop trigger if exists booking_status_sync on public.bookings;
create trigger booking_status_sync before update of status on public.bookings
for each row execute function private.sync_booking_tables();

create or replace function public.available_tables(target_restaurant uuid, target_start timestamptz, guests integer)
returns table (table_id uuid, code text, seats integer, floor_id uuid, x numeric, y numeric, shape text, merge_group text)
language sql stable security definer set search_path = '' as $$
  select t.id,t.code,t.seats,t.floor_id,t.x,t.y,t.shape,t.merge_group
  from public.restaurant_tables t join public.floors f on f.id=t.floor_id
  join public.restaurants r on r.id=f.restaurant_id
  where f.restaurant_id=target_restaurant and f.active and r.active and not r.temporarily_closed
    and t.online_bookable and t.seats>=guests
    and target_start >= now()+make_interval(mins=>r.minimum_notice_minutes)
    and target_start <= now()+make_interval(days=>r.advance_days)
    and exists (select 1 from public.restaurant_hours h where h.restaurant_id=r.id
      and h.weekday=extract(dow from target_start at time zone r.timezone)::integer and not h.closed
      and (target_start at time zone r.timezone)::time >= h.opens_at
      and ((target_start+make_interval(mins=>r.booking_duration_minutes)) at time zone r.timezone)::time <= h.closes_at)
    and not exists (select 1 from public.restaurant_closures c where c.restaurant_id=r.id and c.closed_on=(target_start at time zone r.timezone)::date)
    and not exists (select 1 from public.booking_tables bt where bt.table_id=t.id
      and bt.status in ('pending','confirmed','arrived','seated')
      and bt.blocked_range && tstzrange(target_start,target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'))
    and not exists (select 1 from public.blocked_tables b where b.table_id=t.id
      and b.blocked_range && tstzrange(target_start,target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'))
    and not exists (select 1 from public.table_states s where s.table_id=t.id and s.status in ('occupied','billing','cleaning','unavailable') and target_start<now()+interval '2 hours')
  order by t.code;
$$;
revoke all on function public.available_tables(uuid,timestamptz,integer) from public;
grant execute on function public.available_tables(uuid,timestamptz,integer) to anon, authenticated;

create or replace function public.create_booking(target_restaurant uuid, target_start timestamptz, guests integer, selected_tables uuid[], request_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.restaurants%rowtype; new_id uuid; selected_count integer; seat_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to book'; end if;
  if guests<1 or guests>30 or coalesce(array_length(selected_tables,1),0)<1 or coalesce(array_length(selected_tables,1),0)>4 then raise exception 'Invalid party or tables'; end if;
  select * into r from public.restaurants where id=target_restaurant and active and not temporarily_closed;
  if not found then raise exception 'Restaurant unavailable'; end if;
  if target_start<now()+make_interval(mins=>r.minimum_notice_minutes) or target_start>now()+make_interval(days=>r.advance_days) then raise exception 'Outside booking window'; end if;
  if not exists (select 1 from public.restaurant_hours h where h.restaurant_id=r.id and h.weekday=extract(dow from target_start at time zone r.timezone)::integer and not h.closed and (target_start at time zone r.timezone)::time>=h.opens_at and ((target_start+make_interval(mins=>r.booking_duration_minutes)) at time zone r.timezone)::time<=h.closes_at) then raise exception 'Restaurant is closed at this time'; end if;
  if exists (select 1 from public.restaurant_closures c where c.restaurant_id=r.id and c.closed_on=(target_start at time zone r.timezone)::date) then raise exception 'Restaurant is closed on this date'; end if;
  update public.bookings set status='cancelled' where restaurant_id=r.id and status='pending' and expires_at<now();
  select count(*),coalesce(sum(t.seats),0) into selected_count,seat_count from public.restaurant_tables t join public.floors f on f.id=t.floor_id where t.id=any(selected_tables) and f.restaurant_id=r.id and f.active and t.online_bookable;
  if selected_count<>array_length(selected_tables,1) or selected_count<>(select count(distinct x) from unnest(selected_tables) x) or seat_count<guests then raise exception 'Invalid table selection'; end if;
  if selected_count>1 and (select count(distinct t.merge_group) from public.restaurant_tables t where t.id=any(selected_tables) and t.merge_group is not null)<>1 then raise exception 'Tables cannot be merged'; end if;
  if exists (select 1 from public.restaurant_tables t join public.table_states s on s.table_id=t.id where t.id=any(selected_tables) and s.status in ('occupied','billing','cleaning','unavailable') and target_start<now()+interval '2 hours') then raise exception 'Table unavailable'; end if;
  if exists (select 1 from public.blocked_tables b where b.table_id=any(selected_tables) and b.blocked_range && tstzrange(target_start,target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)')) then raise exception 'Table blocked'; end if;
  insert into public.bookings (restaurant_id,customer_id,guest_count,starts_at,ends_at,blocked_until,expires_at,special_request)
  values (r.id,auth.uid(),guests,target_start,target_start+make_interval(mins=>r.booking_duration_minutes),target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),now()+interval '10 minutes',left(request_note,1000)) returning id into new_id;
  insert into public.booking_tables (booking_id,table_id,blocked_range,status)
  select new_id,x,tstzrange(target_start,target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'),'pending' from unnest(selected_tables) x;
  return new_id;
end $$;
revoke all on function public.create_booking(uuid,timestamptz,integer,uuid[],text) from public;
grant execute on function public.create_booking(uuid,timestamptz,integer,uuid[],text) to authenticated;

-- Public discovery; write access is tied to memberships, not the client UI.
alter table public.restaurant_hours enable row level security;
alter table public.restaurant_closures enable row level security;
alter table public.map_elements enable row level security;
alter table public.menu_categories enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_tables enable row level security;
alter table public.blocked_tables enable row level security;
alter table public.preorders enable row level security;
alter table public.preorder_items enable row level security;
alter table public.payments enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.kot enable row level security;
alter table public.bills enable row level security;
alter table public.audit_logs enable row level security;

create policy hours_read on public.restaurant_hours for select to anon,authenticated using (true);
create policy closures_read on public.restaurant_closures for select to anon,authenticated using (true);
create policy map_read on public.map_elements for select to anon,authenticated using (true);
create policy categories_read on public.menu_categories for select to anon,authenticated using (true);
create policy hours_manage on public.restaurant_hours for all to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[]));
create policy closures_manage on public.restaurant_closures for all to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[]));
create policy categories_manage on public.menu_categories for all to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[]));
create policy map_manage on public.map_elements for all to authenticated using (exists(select 1 from public.floors f where f.id=floor_id and private.has_restaurant_role(f.restaurant_id,array['owner','manager']::public.app_role[]))) with check (exists(select 1 from public.floors f where f.id=floor_id and private.has_restaurant_role(f.restaurant_id,array['owner','manager']::public.app_role[])));
create policy bookings_read on public.bookings for select to authenticated using (customer_id=auth.uid() or private.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.app_role[]));
create policy bookings_staff_update on public.bookings for update to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id,array['owner','manager']::public.app_role[]));
create policy booking_tables_read on public.booking_tables for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (b.customer_id=auth.uid() or private.has_restaurant_role(b.restaurant_id,array['owner','manager','waiter']::public.app_role[]))));
create policy blocks_read on public.blocked_tables for select to authenticated using (private.has_restaurant_role(private.restaurant_for_table(table_id),array['owner','manager','waiter']::public.app_role[]));
create policy blocks_manage on public.blocked_tables for all to authenticated using (private.has_restaurant_role(private.restaurant_for_table(table_id),array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(private.restaurant_for_table(table_id),array['owner','manager']::public.app_role[]));
create policy preorders_read on public.preorders for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (b.customer_id=auth.uid() or private.has_restaurant_role(b.restaurant_id,array['owner','manager','waiter']::public.app_role[]))));
create policy preorder_items_read on public.preorder_items for select to authenticated using (exists(select 1 from public.preorders p join public.bookings b on b.id=p.booking_id where p.id=preorder_id and (b.customer_id=auth.uid() or private.has_restaurant_role(b.restaurant_id,array['owner','manager','waiter']::public.app_role[]))));
create policy payments_read on public.payments for select to authenticated using (exists(select 1 from public.bookings b where b.id=booking_id and (b.customer_id=auth.uid() or private.has_restaurant_role(b.restaurant_id,array['owner','manager']::public.app_role[]))));
create policy orders_read on public.orders for select to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.app_role[]));
create policy orders_write on public.orders for all to authenticated using (private.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id,array['owner','manager','waiter']::public.app_role[]));
create policy order_items_read on public.order_items for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager','waiter']::public.app_role[])));
create policy order_items_write on public.order_items for all to authenticated using (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager','waiter']::public.app_role[]))) with check (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager','waiter']::public.app_role[])));
create policy kot_read on public.kot for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager','waiter']::public.app_role[])));
create policy kot_write on public.kot for insert to authenticated with check (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager','waiter']::public.app_role[])));
create policy bills_read on public.bills for select to authenticated using (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager']::public.app_role[])));
create policy bills_manage on public.bills for all to authenticated using (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager']::public.app_role[]))) with check (exists(select 1 from public.orders o where o.id=order_id and private.has_restaurant_role(o.restaurant_id,array['owner','manager']::public.app_role[])));
create policy audit_read on public.audit_logs for select to authenticated using (private.has_restaurant_role(restaurant_id,array['owner']::public.app_role[]));

grant select on public.restaurant_hours,public.restaurant_closures,public.map_elements,public.menu_categories to anon,authenticated;
grant insert,update,delete on public.restaurant_hours,public.restaurant_closures,public.map_elements,public.menu_categories to authenticated;
grant select on public.bookings,public.booking_tables,public.blocked_tables,public.preorders,public.preorder_items,public.payments,public.orders,public.order_items,public.kot,public.bills,public.audit_logs to authenticated;
grant update on public.bookings to authenticated;
grant insert,update,delete on public.blocked_tables,public.orders,public.order_items,public.bills to authenticated;
grant insert on public.kot to authenticated;
