alter table public.bills
  add column tax_unit text not null default 'rupees' check (tax_unit in ('rupees', 'percent')),
  add column tax_value numeric(12,2) not null default 0 check (tax_value >= 0),
  add column service_unit text not null default 'rupees' check (service_unit in ('rupees', 'percent')),
  add column service_value numeric(12,2) not null default 0 check (service_value >= 0),
  add column discount_unit text not null default 'rupees' check (discount_unit in ('rupees', 'percent')),
  add column discount_value numeric(12,2) not null default 0 check (discount_value >= 0);

update public.bills
set tax_value = tax_paise / 100.0,
    service_value = service_paise / 100.0,
    discount_value = discount_paise / 100.0;
