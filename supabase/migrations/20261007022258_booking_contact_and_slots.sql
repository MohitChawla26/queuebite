alter table public.bookings
  add column if not exists customer_name text,
  add column if not exists customer_phone text;

alter table public.bookings
  add constraint bookings_customer_name_length check (customer_name is null or length(trim(customer_name)) between 2 and 80),
  add constraint bookings_customer_phone_format check (customer_phone is null or customer_phone ~ '^\+?[0-9]{10,15}$');

create or replace function public.create_booking_with_contact(
  target_restaurant uuid, target_start timestamptz, guests integer,
  selected_tables uuid[], customer_name text, customer_phone text,
  request_note text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.restaurants%rowtype; new_id uuid; selected_count integer; seat_count integer;
begin
  if auth.uid() is null then raise exception 'Sign in to book'; end if;
  customer_name := trim(coalesce(customer_name, ''));
  customer_phone := trim(coalesce(customer_phone, ''));
  if length(customer_name) not between 2 and 80 then raise exception 'Enter your name (2–80 characters)'; end if;
  if customer_phone !~ '^\+?[0-9]{10,15}$' then raise exception 'Enter a valid phone number'; end if;
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
  insert into public.bookings (restaurant_id,customer_id,customer_name,customer_phone,guest_count,starts_at,ends_at,blocked_until,expires_at,special_request)
  values (r.id,auth.uid(),customer_name,customer_phone,guests,target_start,target_start+make_interval(mins=>r.booking_duration_minutes),target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),now()+interval '10 minutes',left(request_note,1000)) returning id into new_id;
  insert into public.booking_tables (booking_id,table_id,blocked_range,status)
  select new_id,x,tstzrange(target_start,target_start+make_interval(mins=>r.booking_duration_minutes+r.buffer_minutes),'[)'),'pending' from unnest(selected_tables) x;
  return new_id;
end $$;
revoke all on function public.create_booking_with_contact(uuid,timestamptz,integer,uuid[],text,text,text) from public;
grant execute on function public.create_booking_with_contact(uuid,timestamptz,integer,uuid[],text,text,text) to authenticated;

create or replace function public.booking_slot_availability(target_restaurant uuid, target_day date, guests integer)
returns table (slot_time time, available boolean)
language sql stable security invoker set search_path = '' as $$
  with restaurant as (
    select r.id, r.timezone, r.booking_duration_minutes, h.opens_at, h.closes_at
    from public.restaurants r join public.restaurant_hours h on h.restaurant_id=r.id
    where r.id=target_restaurant and r.active and not r.temporarily_closed
      and h.weekday=extract(dow from target_day)::integer and not h.closed
      and not exists (select 1 from public.restaurant_closures c where c.restaurant_id=r.id and c.closed_on=target_day)
  ), slots as (
    select restaurant.*, (opens_at + (n * interval '30 minutes'))::time as local_slot
    from restaurant cross join generate_series(0,47) n
    where n * 30 + booking_duration_minutes <= extract(epoch from closes_at - opens_at) / 60
  )
  select s.local_slot,
    coalesce((select bool_or(a.seats>=guests) from public.available_tables(s.id,(target_day+s.local_slot) at time zone s.timezone,1) a),false)
    or exists (
      select 1 from public.available_tables(s.id,(target_day+s.local_slot) at time zone s.timezone,1) a
      where a.merge_group is not null group by a.merge_group having sum(a.seats)>=guests
    )
  from slots s order by s.local_slot;
$$;
revoke all on function public.booking_slot_availability(uuid,date,integer) from public;
grant execute on function public.booking_slot_availability(uuid,date,integer) to anon, authenticated;
