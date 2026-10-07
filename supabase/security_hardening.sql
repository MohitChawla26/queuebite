revoke execute on function public.create_booking(uuid,timestamptz,integer,uuid[],text) from anon;
revoke execute on function public.save_preorder(uuid,jsonb) from anon;
revoke execute on function public.cancel_my_booking(uuid) from anon;

create schema if not exists extensions;
alter extension btree_gist set schema extensions;

create index if not exists map_elements_floor_idx on public.map_elements(floor_id);
create index if not exists menu_items_category_idx on public.menu_items(category_id);
create index if not exists order_items_order_idx on public.order_items(order_id);
create index if not exists order_items_menu_idx on public.order_items(menu_item_id);
create index if not exists orders_booking_idx on public.orders(booking_id);
create index if not exists orders_table_idx on public.orders(table_id);
create index if not exists orders_creator_idx on public.orders(created_by);
create index if not exists preorder_items_preorder_idx on public.preorder_items(preorder_id);
create index if not exists preorder_items_menu_idx on public.preorder_items(menu_item_id);
create index if not exists kot_order_idx on public.kot(order_id);
create index if not exists blocked_tables_creator_idx on public.blocked_tables(created_by);
create index if not exists audit_logs_restaurant_idx on public.audit_logs(restaurant_id);
create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
