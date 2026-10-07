create policy memberships_manager_remove_waiter on public.restaurant_memberships for delete to authenticated
using (role='waiter' and private.has_restaurant_role(restaurant_id,array['manager']::public.app_role[]));
create policy invitations_manager_remove_waiter on public.restaurant_invitations for delete to authenticated
using (role='waiter' and private.has_restaurant_role(restaurant_id,array['manager']::public.app_role[]));
