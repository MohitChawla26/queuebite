import { authenticatedPaymentClients, jsonError, razorpayAuthorization, razorpayKeyId } from "@/lib/payment-server";

export async function POST(request: Request) {
  try {
    const { config, admin, user } = await authenticatedPaymentClients(request);
    const body = await request.json() as { bookingId?: string };
    if (!body.bookingId || !/^[0-9a-f-]{36}$/i.test(body.bookingId)) return jsonError("Invalid booking reference.");
    const { data: booking, error: bookingError } = await admin.from("bookings").select("id,customer_id,status,expires_at,deposit_paise").eq("id", body.bookingId).single();
    if (bookingError || !booking || booking.customer_id !== user.id) return jsonError("Booking not found.", 404);
    if (booking.status !== "pending" || !booking.expires_at || new Date(booking.expires_at).getTime() <= Date.now()) return jsonError("This booking hold has expired.");
    const { data: existing } = await admin.from("payments").select("provider_order_id,status").eq("booking_id", booking.id).maybeSingle();
    if (existing?.provider_order_id && existing.status === "created") return Response.json({ keyId: razorpayKeyId, orderId: existing.provider_order_id });
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", { method: "POST", headers: { "Content-Type": "application/json", Authorization: razorpayAuthorization(config.razorpaySecret) }, body: JSON.stringify({ amount: 5000, currency: "INR", receipt: booking.id.slice(0, 40), payment_capture: 1, notes: { booking_id: booking.id } }) });
    if (!razorpayResponse.ok) throw new Error("Razorpay could not create the deposit order.");
    const order = await razorpayResponse.json() as { id: string; amount: number; currency: string };
    if (order.amount !== 5000 || order.currency !== "INR" || !order.id) throw new Error("Invalid payment order returned.");
    const { error: saveError } = await admin.from("payments").upsert({ booking_id: booking.id, provider: "razorpay", provider_order_id: order.id, amount_paise: 5000, status: "created" }, { onConflict: "booking_id" });
    if (saveError) throw new Error("Could not save the payment order.");
    return Response.json({ keyId: razorpayKeyId, orderId: order.id });
  } catch (cause) { return jsonError(cause); }
}
