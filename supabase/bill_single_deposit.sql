alter table public.bills add column if not exists deposit_booking_id uuid unique references public.bookings(id);

create or replace function private.calculate_bill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare linked_booking uuid;
begin
  select booking_id into linked_booking from public.orders where id=new.order_id;
  select coalesce(sum(quantity*unit_price_paise),0) into new.subtotal_paise from public.order_items where order_id=new.order_id;
  new.deposit_booking_id := null;
  if linked_booking is not null
    and exists(select 1 from public.payments p where p.booking_id=linked_booking and p.status='paid')
    and not exists(select 1 from public.bills other where other.deposit_booking_id=linked_booking and other.id<>new.id and other.status<>'void') then
    new.deposit_booking_id := linked_booking;
  end if;
  new.deposit_deducted_paise := case when new.deposit_booking_id is null then 0 else 5000 end;
  new.total_paise := greatest(0,new.subtotal_paise+new.tax_paise+new.service_paise-new.discount_paise-new.deposit_deducted_paise);
  return new;
end $$;
