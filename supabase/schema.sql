create schema if not exists private;

do $$ begin
  create type public.app_role as enum ('superadmin', 'owner', 'manager', 'waiter');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.table_status as enum ('available', 'held', 'occupied', 'billing', 'cleaning', 'unavailable');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.queue_status as enum ('waiting', 'notified', 'seated', 'missed', 'cancelled');
exception when duplicate_object then null;
end $$;

create table if not exists private.superadmin_emails (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

insert into private.superadmin_emails (email)
values ('igmohit6@gmail.com')
on conflict (email) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  global_role public.app_role,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_memberships (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null check (role <> 'superadmin'),
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id)
);

create table if not exists public.floors (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  width integer not null default 1000 check (width between 320 and 3000),
  height integer not null default 700 check (height between 320 and 3000),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  floor_id uuid not null references public.floors(id) on delete cascade,
  code text not null,
  seats integer not null check (seats between 1 and 30),
  shape text not null check (shape in ('round', 'square', 'long')),
  x numeric(6,2) not null check (x between 0 and 100),
  y numeric(6,2) not null check (y between 0 and 100),
  rotation numeric(6,2) not null default 0,
  unique (floor_id, code)
);

create table if not exists public.table_states (
  table_id uuid primary key references public.restaurant_tables(id) on delete cascade,
  status public.table_status not null default 'available',
  hold_until timestamptz,
  version bigint not null default 1,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_entries (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  guest_name text not null,
  phone text,
  party_size integer not null check (party_size between 1 and 30),
  status public.queue_status not null default 'waiting',
  assigned_table_id uuid references public.restaurant_tables(id) on delete set null,
  joined_at timestamptz not null default now(),
  notified_at timestamptz,
  hold_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists queue_entries_active_idx
  on public.queue_entries (restaurant_id, status, joined_at)
  where status in ('waiting', 'notified');
create index if not exists floors_restaurant_id_idx on public.floors (restaurant_id);
create index if not exists memberships_user_id_idx on public.restaurant_memberships (user_id);
create index if not exists queue_entries_customer_id_idx on public.queue_entries (customer_id);
create index if not exists queue_entries_assigned_table_id_idx on public.queue_entries (assigned_table_id);
create index if not exists table_states_updated_by_idx on public.table_states (updated_by);

create table if not exists public.table_events (
  id bigint generated always as identity primary key,
  table_id uuid not null references public.restaurant_tables(id) on delete cascade,
  from_status public.table_status,
  to_status public.table_status not null,
  actor_id uuid references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists table_events_table_id_idx on public.table_events (table_id);
create index if not exists table_events_actor_id_idx on public.table_events (actor_id);

create or replace function private.is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from private.superadmin_emails
    where email = lower(coalesce((select auth.jwt()) ->> 'email', ''))
  );
$$;

create or replace function private.has_restaurant_role(target_restaurant uuid, allowed_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and (
    private.is_superadmin() or exists (
      select 1 from public.restaurant_memberships membership
      where membership.restaurant_id = target_restaurant
        and membership.user_id = (select auth.uid())
        and membership.role = any(allowed_roles)
    )
  );
$$;

revoke all on function private.is_superadmin() from public;
revoke all on function private.has_restaurant_role(uuid, public.app_role[]) from public;
grant usage on schema private to authenticated;
grant execute on function private.is_superadmin() to authenticated;
grant execute on function private.has_restaurant_role(uuid, public.app_role[]) to authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, global_role)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)),
    case when exists (
      select 1 from private.superadmin_emails where email = lower(coalesce(new.email, ''))
    ) then 'superadmin'::public.app_role else null end
  )
  on conflict (id) do update set
    email = excluded.email,
    global_role = coalesce(public.profiles.global_role, excluded.global_role),
    updated_at = now();
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute function private.handle_new_user();

insert into public.profiles (id, email, display_name, global_role)
select users.id, lower(users.email), split_part(users.email, '@', 1),
  case when lower(users.email) = 'igmohit6@gmail.com' then 'superadmin'::public.app_role else null end
from auth.users users where users.email is not null
on conflict (id) do update set
  email = excluded.email,
  global_role = coalesce(public.profiles.global_role, excluded.global_role),
  updated_at = now();

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_memberships enable row level security;
alter table public.floors enable row level security;
alter table public.restaurant_tables enable row level security;
alter table public.table_states enable row level security;
alter table public.queue_entries enable row level security;
alter table public.table_events enable row level security;

drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles for select to authenticated
using ((select auth.uid()) = id or private.is_superadmin());

drop policy if exists restaurants_public_read on public.restaurants;
create policy restaurants_public_read on public.restaurants for select to anon, authenticated
using (active or private.is_superadmin() or private.has_restaurant_role(id, array['owner','manager','waiter']::public.app_role[]));

drop policy if exists restaurants_superadmin_write on public.restaurants;
drop policy if exists restaurants_superadmin_insert on public.restaurants;
drop policy if exists restaurants_superadmin_update on public.restaurants;
drop policy if exists restaurants_superadmin_delete on public.restaurants;
create policy restaurants_superadmin_insert on public.restaurants for insert to authenticated with check (private.is_superadmin());
create policy restaurants_superadmin_update on public.restaurants for update to authenticated using (private.is_superadmin()) with check (private.is_superadmin());
create policy restaurants_superadmin_delete on public.restaurants for delete to authenticated using (private.is_superadmin());

drop policy if exists memberships_staff_read on public.restaurant_memberships;
create policy memberships_staff_read on public.restaurant_memberships for select to authenticated
using (user_id = (select auth.uid()) or private.is_superadmin() or private.has_restaurant_role(restaurant_id, array['owner','manager']::public.app_role[]));

drop policy if exists memberships_owner_write on public.restaurant_memberships;
drop policy if exists memberships_owner_insert on public.restaurant_memberships;
drop policy if exists memberships_owner_update on public.restaurant_memberships;
drop policy if exists memberships_owner_delete on public.restaurant_memberships;
create policy memberships_owner_insert on public.restaurant_memberships for insert to authenticated with check (private.is_superadmin() or private.has_restaurant_role(restaurant_id, array['owner']::public.app_role[]));
create policy memberships_owner_update on public.restaurant_memberships for update to authenticated using (private.is_superadmin() or private.has_restaurant_role(restaurant_id, array['owner']::public.app_role[])) with check (private.is_superadmin() or private.has_restaurant_role(restaurant_id, array['owner']::public.app_role[]));
create policy memberships_owner_delete on public.restaurant_memberships for delete to authenticated using (private.is_superadmin() or private.has_restaurant_role(restaurant_id, array['owner']::public.app_role[]));

drop policy if exists floors_public_read on public.floors;
create policy floors_public_read on public.floors for select to anon, authenticated
using (active and exists (select 1 from public.restaurants r where r.id = restaurant_id and r.active));

drop policy if exists floors_manager_write on public.floors;
drop policy if exists floors_manager_insert on public.floors;
drop policy if exists floors_manager_update on public.floors;
drop policy if exists floors_manager_delete on public.floors;
create policy floors_manager_insert on public.floors for insert to authenticated with check (private.has_restaurant_role(restaurant_id, array['owner','manager']::public.app_role[]));
create policy floors_manager_update on public.floors for update to authenticated using (private.has_restaurant_role(restaurant_id, array['owner','manager']::public.app_role[])) with check (private.has_restaurant_role(restaurant_id, array['owner','manager']::public.app_role[]));
create policy floors_manager_delete on public.floors for delete to authenticated using (private.has_restaurant_role(restaurant_id, array['owner','manager']::public.app_role[]));

drop policy if exists tables_public_read on public.restaurant_tables;
create policy tables_public_read on public.restaurant_tables for select to anon, authenticated
using (exists (select 1 from public.floors f join public.restaurants r on r.id = f.restaurant_id where f.id = floor_id and f.active and r.active));

drop policy if exists tables_manager_write on public.restaurant_tables;
drop policy if exists tables_manager_insert on public.restaurant_tables;
drop policy if exists tables_manager_update on public.restaurant_tables;
drop policy if exists tables_manager_delete on public.restaurant_tables;
create policy tables_manager_insert on public.restaurant_tables for insert to authenticated with check (exists (select 1 from public.floors f where f.id = floor_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager']::public.app_role[])));
create policy tables_manager_update on public.restaurant_tables for update to authenticated using (exists (select 1 from public.floors f where f.id = floor_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager']::public.app_role[]))) with check (exists (select 1 from public.floors f where f.id = floor_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager']::public.app_role[])));
create policy tables_manager_delete on public.restaurant_tables for delete to authenticated using (exists (select 1 from public.floors f where f.id = floor_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager']::public.app_role[])));

drop policy if exists states_public_read on public.table_states;
create policy states_public_read on public.table_states for select to anon, authenticated using (true);

drop policy if exists states_staff_write on public.table_states;
drop policy if exists states_staff_insert on public.table_states;
drop policy if exists states_staff_update on public.table_states;
drop policy if exists states_staff_delete on public.table_states;
create policy states_staff_insert on public.table_states for insert to authenticated with check (exists (select 1 from public.restaurant_tables t join public.floors f on f.id = t.floor_id where t.id = table_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager','waiter']::public.app_role[])));
create policy states_staff_update on public.table_states for update to authenticated using (exists (select 1 from public.restaurant_tables t join public.floors f on f.id = t.floor_id where t.id = table_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager','waiter']::public.app_role[]))) with check (exists (select 1 from public.restaurant_tables t join public.floors f on f.id = t.floor_id where t.id = table_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager','waiter']::public.app_role[])));
create policy states_staff_delete on public.table_states for delete to authenticated using (exists (select 1 from public.restaurant_tables t join public.floors f on f.id = t.floor_id where t.id = table_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager','waiter']::public.app_role[])));

drop policy if exists queue_customer_read on public.queue_entries;
create policy queue_customer_read on public.queue_entries for select to authenticated
using (customer_id = (select auth.uid()) or private.has_restaurant_role(restaurant_id, array['owner','manager','waiter']::public.app_role[]));

drop policy if exists queue_customer_join on public.queue_entries;
create policy queue_customer_join on public.queue_entries for insert to authenticated
with check (customer_id = (select auth.uid()));

drop policy if exists queue_staff_update on public.queue_entries;
create policy queue_staff_update on public.queue_entries for update to authenticated
using (private.has_restaurant_role(restaurant_id, array['owner','manager','waiter']::public.app_role[]))
with check (private.has_restaurant_role(restaurant_id, array['owner','manager','waiter']::public.app_role[]));

drop policy if exists events_staff_read on public.table_events;
create policy events_staff_read on public.table_events for select to authenticated
using (exists (select 1 from public.restaurant_tables t join public.floors f on f.id = t.floor_id where t.id = table_id and private.has_restaurant_role(f.restaurant_id, array['owner','manager']::public.app_role[])));

grant select on public.restaurants, public.floors, public.restaurant_tables, public.table_states to anon, authenticated;
grant select on public.profiles, public.restaurant_memberships, public.queue_entries, public.table_events to authenticated;
grant insert on public.queue_entries to authenticated;
grant insert, update, delete on public.restaurants, public.restaurant_memberships, public.floors, public.restaurant_tables, public.table_states to authenticated;
grant update on public.queue_entries to authenticated;
grant usage, select on sequence public.table_events_id_seq to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'table_states') then
    alter publication supabase_realtime add table public.table_states;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'queue_entries') then
    alter publication supabase_realtime add table public.queue_entries;
  end if;
end $$;
