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
      where a.merge_group is not null group by a.floor_id, a.merge_group having sum(a.seats)>=guests
    )
  from slots s order by s.local_slot;
$$;
