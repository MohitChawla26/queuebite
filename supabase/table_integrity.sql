create or replace function private.validate_booking_merge() returns trigger
language plpgsql security definer set search_path = '' as $$
declare table_count integer; grouped_count integer; group_count integer;
begin
  select count(*),count(t.merge_group),count(distinct t.merge_group)
  into table_count,grouped_count,group_count
  from public.booking_tables bt join public.restaurant_tables t on t.id=bt.table_id
  where bt.booking_id=new.booking_id;
  if table_count>1 and (grouped_count<>table_count or group_count<>1) then
    raise exception 'Selected tables cannot be merged';
  end if;
  return new;
end $$;
drop trigger if exists validate_booking_merge on public.booking_tables;
create trigger validate_booking_merge after insert or update on public.booking_tables
for each row execute function private.validate_booking_merge();

create or replace function private.validate_blocked_table() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.booking_tables bt where bt.table_id=new.table_id
    and bt.status in ('pending','confirmed','arrived','seated') and bt.blocked_range && new.blocked_range) then
    raise exception 'An active booking already uses this table';
  end if;
  return new;
end $$;
drop trigger if exists validate_blocked_table on public.blocked_tables;
create trigger validate_blocked_table before insert or update on public.blocked_tables
for each row execute function private.validate_blocked_table();
