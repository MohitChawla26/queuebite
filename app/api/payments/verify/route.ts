import { authenticatedPaymentClients, jsonError, razorpayAuthorization, verifyRazorpaySignature } from "@/lib/payment-server";

export async function POST(request: Request) {
  try {
    const { config, admin, user } = await authenticatedPaymentClients(request);
    const body = await request.json() as { bookingId?: string; razorpay_order_id?: string; razorpay_payment_id?: string; razorpay_signature?: string };
    if (!body.bookingId || !body.razorpay_order_id || !body.razorpay_payment_id || !body.razorpay_signature) return jsonError("Missing payment details.");
    const { data: booking } = await admin.from("bookings").select("id,customer_id,status,expires_at,payment_status").eq("id", body.bookingId).single();
    if (!booking || booking.customer_id !== user.id) return jsonError("Booking not found.", 404);
    const { data: payment } = await admin.from("payments").select("id,provider_order_id,amount_paise,status").eq("booking_id", booking.id).single();
    if (!payment || payment.provider_order_id !== body.razorpay_order_id || payment.amount_paise !== 5000) return jsonError("Payment order does not match the booking.");
    if (payment.status === "paid" && booking.payment_status === "paid") return Response.json({ confirmed: true });
    if (booking.status !== "pending" || !booking.expires_at || new Date(booking.expires_at).getTime() <= Date.now()) return jsonError("The booking hold expired. Contact the restaurant if a payment was captured.");
    if (!await verifyRazorpaySignature(config.razorpaySecret, payment.provider_order_id, body.razorpay_payment_id, body.razorpay_signature)) return jsonError("Payment signature verification failed.");
    const razorpayResponse = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(body.razorpay_payment_id)}`, { headers: { Authorization: razorpayAuthorization(config.razorpaySecret) } });
    if (!razorpayResponse.ok) throw new Error("Could not verify the payment with Razorpay.");
    const remote = await razorpayResponse.json() as { id: string; order_id: string; amount: number; currency: string; status: string };
    if (remote.id !== body.razorpay_payment_id || remote.order_id !== payment.provider_order_id || remote.amount !== 5000 || remote.currency !== "INR" || remote.status !== "captured") return jsonError("The ₹50 deposit has not been captured yet.");
    const { error: paymentError } = await admin.from("payments").update({ status: "paid", provider_payment_id: remote.id, verified_at: new Date().toISOString() }).eq("id", payment.id).eq("status", "created");
    if (paymentError) throw new Error(paymentError.message);
    const { data: confirmed, error: bookingError } = await admin.from("bookings").update({ status: "confirmed", payment_status: "paid", expires_at: null }).eq("id", booking.id).eq("status", "pending").gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
    if (bookingError) throw new Error(bookingError.message);
    if (!confirmed) return jsonError("Payment was captured but the table hold expired. Contact the restaurant for help.", 409);
    return Response.json({ confirmed: true });
  } catch (cause) { return jsonError(cause); }
}
