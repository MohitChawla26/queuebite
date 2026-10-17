"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { Clock3, Phone, Ticket, Users, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { GoogleMark } from "@/components/google-mark";
import { QueuePageSkeleton } from "@/components/loading-skeletons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import type { Restaurant } from "@/lib/platform-types";

type QueueOverview = {
  parties_waiting: number;
  people_waiting: number;
  queue_open: boolean;
};
type MyPlace = {
  id: string;
  status: "waiting" | "notified" | "seated" | "missed" | "cancelled";
  party_size: number;
  joined_at: string;
  queue_position: number | null;
  assigned_table_code: string | null;
};

export function CustomerQueue({ restaurant, user }: { restaurant: Restaurant; user: User | null }) {
  const client = getSupabaseBrowserClient();
  const [overview, setOverview] = useState<QueueOverview | null>(null);
  const [place, setPlace] = useState<MyPlace | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!client) return;
    const [overviewResult, placeResult] = await Promise.all([
      client.rpc("queue_overview", { target_restaurant: restaurant.id }),
      user ? client.rpc("my_queue_status", { target_restaurant: restaurant.id }) : Promise.resolve(null),
    ]);
    if (overviewResult.error) toast.error(overviewResult.error.message, { id: "queue-overview-error" });
    else setOverview(((overviewResult.data ?? []) as QueueOverview[])[0] ?? null);
    if (placeResult) {
      if (placeResult.error) toast.error(placeResult.error.message, { id: "queue-status-error" });
      else setPlace(((placeResult.data ?? []) as MyPlace[])[0] ?? null);
    } else setPlace(null);
    setLoading(false);
  }, [client, restaurant.id, user]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
    const timer = window.setInterval(() => void refresh(), 8_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  async function join() {
    if (!client || !user || !overview?.queue_open || busy) return;
    setBusy(true);
    const { error } = await client.rpc("join_queue", {
      target_restaurant: restaurant.id,
      guest_name: name.trim(),
      phone: phone.trim(),
      party_size: partySize,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("You're in the queue. Your position will update here.");
      await refresh();
    }
  }

  async function cancel() {
    if (!client || !place || busy) return;
    setBusy(true);
    const { error } = await client.rpc("cancel_my_queue", { target_entry: place.id });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success("You left the queue.");
      await refresh();
    }
  }

  async function sendOtp() {
    if (!client || !email.trim()) return;
    setBusy(true);
    const { error } = await client.auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) toast.error(error.message);
    else { setCodeSent(true); toast.success("Check your email for a sign-in code."); }
  }

  async function verifyOtp() {
    if (!client || !otp.trim()) return;
    setBusy(true);
    const { error } = await client.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: "email" });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Signed in. You can join the queue now.");
  }

  const waiting = place?.status === "waiting";
  const called = place?.status === "notified";
  const seated = place?.status === "seated";
  const active = waiting || called || seated;
  const phoneValid = /^\+?[0-9]{10,15}$/.test(phone.trim());

  if (loading && !overview) return <QueuePageSkeleton />;

  return (
    <div className="qb-queue-layout">
      <section className="qb-panel qb-queue-main">
        <p className="qb-kicker">LIVE WALK-IN QUEUE</p>
        <h2>{active ? called ? "Your table is ready" : seated ? "Enjoy your visit" : "You're in line" : "Join the queue for today"}</h2>
        <p className="qb-queue-intro">Join from your phone. The restaurant will assign a table that fits your group when your turn comes.</p>

        {active ? (
          <div className="qb-queue-ticket">
            <div className="qb-queue-ticket-top"><Ticket size={22} /><span>{called ? "PLEASE HEAD TO THE RESTAURANT" : seated ? "SEATED" : "YOUR LIVE POSITION"}</span></div>
            {waiting ? <><strong className="qb-queue-position">#{place?.queue_position ?? "–"}</strong>
              <p>{Math.max((place?.queue_position ?? 1) - 1, 0)} {place?.queue_position === 2 ? "party" : "parties"} ahead of you</p></>
              : <><strong className="qb-queue-table">{place?.assigned_table_code ? `Table ${place.assigned_table_code}` : "Table assigned"}</strong>
                <p>{called ? "Please check in with the restaurant team." : "Your queue place has been completed."}</p></>}
            <span className="qb-queue-party"><Users size={16} /> Party of {place?.party_size}</span>
          </div>
        ) : <>
          <div className="qb-queue-form">
            <label>Full name<Input autoComplete="name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>
            <label>Phone number<Input type="tel" autoComplete="tel" inputMode="tel" value={phone}
              onChange={(event) => setPhone(event.target.value.replace(/[^+0-9]/g, ""))} placeholder="10 to 15 digits" /></label>
            <label>Number of guests<Input type="number" min={1} max={30} value={partySize}
              onChange={(event) => setPartySize(Math.max(1, Math.min(30, Number(event.target.value))))} /></label>
          </div>
          {phone && !phoneValid && <p className="qb-field-error">Enter 10 to 15 digits, with an optional + prefix.</p>}
          {!user && <div className="qb-login qb-queue-login">
            <h3>Sign in to keep your place</h3>
            <Button className="qb-google-button" variant="outline" onClick={() => void client?.auth.signInWithOAuth({
              provider: "google", options: { redirectTo: window.location.href },
            })}><GoogleMark /> Continue with Google</Button>
            <p>Or sign in with an email code</p>
            <Input type="email" autoComplete="email" placeholder="Email address" value={email} onChange={(event) => setEmail(event.target.value)} />
            <Button variant="outline" disabled={busy || !email.trim()} onClick={() => void sendOtp()}>Send code</Button>
            {codeSent && <div className="qb-otp"><Input inputMode="numeric" placeholder="6-digit code" value={otp} onChange={(event) => setOtp(event.target.value)} />
              <Button disabled={busy || !otp.trim()} onClick={() => void verifyOtp()}>Verify</Button></div>}
          </div>}
          <Button className="qb-queue-join-button" disabled={busy || loading || !user || !overview?.queue_open || name.trim().length < 2 || !phoneValid || partySize < 1}
            onClick={() => void join()}>{busy ? "Joining…" : loading ? "Checking queue…" : overview?.queue_open ? "Join queue" : "Queue is closed now"}</Button>
          <p className="qb-help"><Clock3 size={15} /> No reservation or deposit is needed. Join while the restaurant is open.</p>
        </>}
        {(waiting || called) && <Button variant="outline" className="qb-queue-leave" disabled={busy} onClick={() => void cancel()}>Leave queue</Button>}
      </section>

      <aside className="qb-panel qb-queue-summary">
        <span className="qb-queue-summary-icon"><UtensilsCrossed size={22} /></span>
        <h2>Queue right now</h2>
        <div className="qb-queue-metric"><strong>{loading ? "–" : overview?.people_waiting ?? 0}</strong><span>people waiting</span></div>
        <div className="qb-queue-metric"><strong>{loading ? "–" : overview?.parties_waiting ?? 0}</strong><span>groups in line</span></div>
        <p className="qb-queue-live"><span className={overview?.queue_open ? "qb-live-dot" : "qb-live-dot closed"} />{overview?.queue_open ? "Queue is open" : "Queue is closed"}</p>
        <p className="qb-help"><Phone size={15} /> The restaurant can call your number when a table is assigned.</p>
      </aside>
    </div>
  );
}
