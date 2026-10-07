import { createClient } from "@supabase/supabase-js";

export const razorpayKeyId =
  process.env.RAZORPAY_KEY_ID || "rzp_test_TJpwHKcnf9FVnh";

export function paymentConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const razorpaySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!url || !publishable || !service || !razorpaySecret) return null;
  return { url, publishable, service, razorpaySecret };
}

export async function authenticatedPaymentClients(request: Request) {
  const config = paymentConfig();
  if (!config)
    throw new Error(
      "Payments are not configured yet. Ask the site owner to add the server-side keys.",
    );
  const jwt = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Please sign in.");
  const publicClient = createClient(config.url, config.publishable, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await publicClient.auth.getUser(jwt);
  if (error || !data.user)
    throw new Error("Your sign-in has expired. Please sign in again.");
  const admin = createClient(config.url, config.service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { config, admin, user: data.user };
}

export function razorpayAuthorization(secret: string) {
  return `Basic ${btoa(`${razorpayKeyId}:${secret}`)}`;
}

export function jsonError(cause: unknown, status = 400) {
  return Response.json(
    {
      error:
        cause instanceof Error
          ? cause.message
          : typeof cause === "string"
            ? cause
            : "Request failed.",
    },
    { status },
  );
}

export async function verifyRazorpaySignature(
  secret: string,
  orderId: string,
  paymentId: string,
  signature: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${orderId}|${paymentId}`),
    ),
  );
  const expected = Array.from(digest, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (expected.length !== signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index++)
    mismatch |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return mismatch === 0;
}
