-- The old RPC did not collect contact details. New reservations use create_booking_with_contact.
revoke execute on function public.create_booking(uuid,timestamptz,integer,uuid[],text) from authenticated, anon;
