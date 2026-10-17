-- A customer may have only one waiting or called place per restaurant.
create unique index if not exists queue_one_active_place_per_customer
  on public.queue_entries (restaurant_id, customer_id)
  where customer_id is not null and status in ('waiting', 'notified');

-- All queue mutations pass through validated RPCs below.
revoke insert, update on public.queue_entries from authenticated;

create or replace function public.queue_overview(target_restaurant uuid)
returns table (parties_waiting integer, people_waiting integer, queue_open boolean)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer from public.queue_entries q
      where q.restaurant_id=r.id and q.status='waiting'
        and (q.joined_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date),
    (select coalesce(sum(q.party_size),0)::integer from public.queue_entries q
      where q.restaurant_id=r.id and q.status='waiting'
        and (q.joined_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date),
    (r.active and not r.temporarily_closed
      and exists (select 1 from public.restaurant_hours h where h.restaurant_id=r.id
        and h.weekday=extract(dow from now() at time zone r.timezone)::integer
        and not h.closed and (now() at time zone r.timezone)::time >= h.opens_at
        and (now() at time zone r.timezone)::time < h.closes_at)
      and not exists (select 1 from public.restaurant_closures c where c.restaurant_id=r.id
        and c.closed_on=(now() at time zone r.timezone)::date))
  from public.restaurants r where r.id=target_restaurant;
$$;
revoke all on function public.queue_overview(uuid) from public, anon, authenticated;
grant execute on function public.queue_overview(uuid) to anon, authenticated;

create or replace function public.my_queue_status(target_restaurant uuid)
returns table (id uuid, status public.queue_status, party_size integer,
  joined_at timestamptz, queue_position integer, assigned_table_code text)
language sql stable security definer set search_path = '' as $$
  select q.id,q.status,q.party_size,q.joined_at,
    case when q.status='waiting' then
      (select count(*)::integer+1 from public.queue_entries ahead
        where ahead.restaurant_id=q.restaurant_id and ahead.status='waiting'
          and (ahead.joined_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date
          and (ahead.joined_at,ahead.id)<(q.joined_at,q.id))
    else null end,
    t.code
  from public.queue_entries q join public.restaurants r on r.id=q.restaurant_id
  left join public.restaurant_tables t on t.id=q.assigned_table_id
  where q.restaurant_id=target_restaurant and q.customer_id=(select auth.uid())
    and (q.joined_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date
  order by q.joined_at desc,q.id desc limit 1;
$$;
revoke all on function public.my_queue_status(uuid) from public, anon, authenticated;
grant execute on function public.my_queue_status(uuid) to authenticated;

create or replace function public.join_queue(target_restaurant uuid, guest_name text, phone text, party_size integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.restaurants%rowtype; existing_id uuid; new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to join the queue'; end if;
  guest_name := trim(coalesce(guest_name,''));
  phone := trim(coalesce(phone,''));
  if length(guest_name) not between 2 and 80 then raise exception 'Enter your name (2–80 characters)'; end if;
  if phone !~ '^\+?[0-9]{10,15}$' then raise exception 'Enter a valid phone number'; end if;
  if party_size not between 1 and 30 then raise exception 'Enter a valid guest count'; end if;
  select * into r from public.restaurants where id=target_restaurant and active and not temporarily_closed;
  if not found then raise exception 'Restaurant unavailable'; end if;
  if not exists (select 1 from public.restaurant_hours h where h.restaurant_id=r.id
    and h.weekday=extract(dow from now() at time zone r.timezone)::integer and not h.closed
    and (now() at time zone r.timezone)::time>=h.opens_at
    and (now() at time zone r.timezone)::time<h.closes_at)
    or exists (select 1 from public.restaurant_closures c where c.restaurant_id=r.id
      and c.closed_on=(now() at time zone r.timezone)::date)
  then raise exception 'The queue is closed right now'; end if;
  if not exists (select 1 from public.restaurant_tables t join public.floors f on f.id=t.floor_id
    where f.restaurant_id=r.id and f.active and t.seats>=party_size)
  then raise exception 'No table can seat this party size'; end if;
  -- Old entries never carry over into a new restaurant day.
  update public.queue_entries q set status='missed',updated_at=now()
    where q.restaurant_id=r.id and q.customer_id=auth.uid()
      and q.status in ('waiting','notified')
      and (q.joined_at at time zone r.timezone)::date<(now() at time zone r.timezone)::date;
  select q.id into existing_id from public.queue_entries q
    where q.restaurant_id=r.id and q.customer_id=auth.uid()
      and q.status in ('waiting','notified')
    order by q.joined_at desc limit 1;
  if existing_id is not null then return existing_id; end if;
  insert into public.queue_entries(restaurant_id,customer_id,guest_name,phone,party_size)
    values (r.id,auth.uid(),guest_name,phone,party_size) returning id into new_id;
  return new_id;
end $$;
revoke all on function public.join_queue(uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.join_queue(uuid,text,text,integer) to authenticated;

create or replace function public.call_next_queue(target_restaurant uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.restaurants%rowtype; next_entry public.queue_entries%rowtype;
  chosen_table uuid; claimed_table uuid;
begin
  if auth.uid() is null or not private.has_restaurant_role(target_restaurant,array['owner','manager','waiter']::public.app_role[])
  then raise exception 'Restaurant staff access required'; end if;
  select * into r from public.restaurants where id=target_restaurant for update;
  if not found then raise exception 'Restaurant unavailable'; end if;
  select q.* into next_entry from public.queue_entries q
    where q.restaurant_id=r.id and q.status='waiting'
      and (q.joined_at at time zone r.timezone)::date=(now() at time zone r.timezone)::date
    order by q.joined_at,q.id limit 1 for update;
  if not found then raise exception 'No parties are waiting'; end if;
  select t.id into chosen_table from public.restaurant_tables t
    join public.floors f on f.id=t.floor_id
    left join public.table_states s on s.table_id=t.id
    where f.restaurant_id=r.id and f.active and t.seats>=next_entry.party_size
      and coalesce(s.status,'available'::public.table_status)='available'
      and not exists (select 1 from public.booking_tables bt where bt.table_id=t.id
        and bt.status in ('pending','confirmed','arrived','seated')
        and bt.blocked_range && tstzrange(now(),now()+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'))
      and not exists (select 1 from public.blocked_tables b where b.table_id=t.id
        and b.blocked_range && tstzrange(now(),now()+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'))
    order by t.seats,t.code limit 1 for update of t;
  if chosen_table is null then raise exception 'No suitable table is available for the next party'; end if;
  insert into public.table_states(table_id,status,updated_by,updated_at)
    values(chosen_table,'occupied',auth.uid(),now())
    on conflict(table_id) do update set status='occupied',updated_by=auth.uid(),updated_at=now(),
      version=public.table_states.version+1
      where public.table_states.status='available'
    returning table_id into claimed_table;
  if claimed_table is null then raise exception 'That table was just taken; try again'; end if;
  update public.queue_entries set status='notified',assigned_table_id=chosen_table,
    notified_at=now(),hold_expires_at=null,updated_at=now()
    where id=next_entry.id;
  return next_entry.id;
end $$;
revoke all on function public.call_next_queue(uuid) from public, anon, authenticated;
grant execute on function public.call_next_queue(uuid) to authenticated;

create or replace function public.update_queue_place(target_entry uuid, next_status public.queue_status)
returns void language plpgsql security definer set search_path = '' as $$
declare entry public.queue_entries%rowtype;
begin
  select * into entry from public.queue_entries where id=target_entry for update;
  if not found then raise exception 'Queue place not found'; end if;
  if auth.uid() is null or not private.has_restaurant_role(entry.restaurant_id,array['owner','manager','waiter']::public.app_role[])
  then raise exception 'Restaurant staff access required'; end if;
  if next_status='seated' and entry.status='notified' then
    update public.queue_entries set status='seated',updated_at=now() where id=entry.id;
  elsif next_status='missed' and entry.status in ('waiting','notified') then
    update public.queue_entries set status='missed',updated_at=now() where id=entry.id;
    if entry.assigned_table_id is not null then
      update public.table_states set status='available',updated_by=auth.uid(),updated_at=now(),version=version+1
        where table_id=entry.assigned_table_id and status='occupied';
    end if;
  else raise exception 'Invalid queue status change'; end if;
end $$;
revoke all on function public.update_queue_place(uuid,public.queue_status) from public, anon, authenticated;
grant execute on function public.update_queue_place(uuid,public.queue_status) to authenticated;

create or replace function public.cancel_my_queue(target_entry uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare entry public.queue_entries%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in to cancel'; end if;
  select * into entry from public.queue_entries where id=target_entry and customer_id=auth.uid() for update;
  if not found then raise exception 'Queue place not found'; end if;
  if entry.status not in ('waiting','notified') then raise exception 'This queue place cannot be cancelled'; end if;
  update public.queue_entries set status='cancelled',updated_at=now() where id=entry.id;
  if entry.assigned_table_id is not null then
    update public.table_states set status='available',updated_by=auth.uid(),updated_at=now(),version=version+1
      where table_id=entry.assigned_table_id and status='occupied';
  end if;
end $$;
revoke all on function public.cancel_my_queue(uuid) from public, anon, authenticated;
grant execute on function public.cancel_my_queue(uuid) to authenticated;
