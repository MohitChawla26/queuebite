create or replace function private.release_exited_queue_table()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.status='notified' and new.status in ('missed','cancelled') and old.assigned_table_id is not null then
    update public.table_states set status='available',updated_by=auth.uid(),updated_at=now(),version=version+1
      where table_id=old.assigned_table_id and status='occupied';
  end if;
  return new;
end $$;
revoke all on function private.release_exited_queue_table() from public, anon, authenticated;
drop trigger if exists queue_release_on_exit on public.queue_entries;
create trigger queue_release_on_exit after update of status on public.queue_entries
  for each row execute function private.release_exited_queue_table();

create or replace function private.expire_old_queue_on_join()
returns trigger language plpgsql security definer set search_path = '' as $$
declare restaurant_timezone text;
begin
  select timezone into restaurant_timezone from public.restaurants where id=new.restaurant_id;
  update public.queue_entries q set status='missed',updated_at=now()
    where q.restaurant_id=new.restaurant_id and q.status in ('waiting','notified')
      and (q.joined_at at time zone restaurant_timezone)::date < (now() at time zone restaurant_timezone)::date;
  return new;
end $$;
revoke all on function private.expire_old_queue_on_join() from public, anon, authenticated;
drop trigger if exists queue_expire_old_on_join on public.queue_entries;
create trigger queue_expire_old_on_join before insert on public.queue_entries
  for each row execute function private.expire_old_queue_on_join();
