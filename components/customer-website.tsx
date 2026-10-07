"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  CalendarDays,
  Clock3,
  MapPin,
  Search,
  Star,
  Users,
  UtensilsCrossed,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { GoogleMark } from "@/components/google-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import {
  prettyDate,
  rupees,
  type Booking,
  type Floor,
  type MapElement,
  type MenuItem,
  type Restaurant,
  type Table,
} from "@/lib/platform-types";

type CartLine = {
  item: MenuItem;
  portion: "half" | "full";
  quantity: number;
};
type Hours = {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  closed: boolean;
};
type Available = { table_id: string };
type RazorpayCheckout = new (options: Record<string, unknown>) => {
  open: () => void;
};

function timeOptions(hours: Hours | undefined, duration: number) {
  if (!hours || hours.closed || !hours.opens_at || !hours.closes_at) return [];
  const [openH, openM] = hours.opens_at.split(":").map(Number);
  const [closeH, closeM] = hours.closes_at.split(":").map(Number);
  const options: string[] = [];
  for (
    let minute = openH * 60 + openM;
    minute + duration <= closeH * 60 + closeM;
    minute += 30
  ) {
    options.push(
      `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`,
    );
  }
  return options;
}

function loadRazorpay() {
  return new Promise<void>((resolve, reject) => {
    if ((window as Window & { Razorpay?: RazorpayCheckout }).Razorpay)
      return resolve();
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Payment checkout could not load"));
    document.head.appendChild(script);
  });
}

export function CustomerWebsite() {
  const client = getSupabaseBrowserClient();
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [selected, setSelected] = useState<Restaurant | null>(null);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [elements, setElements] = useState<MapElement[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [closedDates, setClosedDates] = useState<string[]>([]);
  const [available, setAvailable] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [menuSearch, setMenuSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [guests, setGuests] = useState(2);
  const [chosenTables, setChosenTables] = useState<string[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [request, setRequest] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [myBookings, setMyBookings] = useState<Booking[]>([]);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmed, setConfirmed] = useState("");

  const reloadRestaurants = useCallback(async () => {
    if (!client) {
      setError("Supabase connection is not configured.");
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await client
      .from("restaurants")
      .select(
        "id,name,slug,cuisine,location,image_url,rating,timezone,booking_duration_minutes,advance_days,minimum_notice_minutes,temporarily_closed,active",
      )
      .eq("active", true)
      .order("name");
    if (queryError) setError(queryError.message);
    else setRestaurants((data ?? []) as Restaurant[]);
    setLoading(false);
  }, [client]);

  useEffect(() => {
    void reloadRestaurants();
    if (!client) return;
    void client.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: auth } = client.auth.onAuthStateChange((_event, session) =>
      setUser(session?.user ?? null),
    );
    return () => auth.subscription.unsubscribe();
  }, [client, reloadRestaurants]);

  useEffect(() => {
    if (!client || !user) {
      setMyBookings([]);
      return;
    }
    let active = true;
    const load = async () => {
      const { data } = await client
        .from("bookings")
        .select("*")
        .eq("customer_id", user.id)
        .order("starts_at", { ascending: false })
        .limit(20);
      if (active) setMyBookings((data ?? []) as Booking[]);
    };
    void load();
    const channel = client
      .channel(`my-bookings-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `customer_id=eq.${user.id}`,
        },
        () => void load(),
      )
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, user]);

  useEffect(() => {
    if (!selected || !client) return;
    let active = true;
    setError("");
    setFloors([]);
    setTables([]);
    setElements([]);
    setMenu([]);
    setHours([]);
    setChosenTables([]);
    setCart([]);
    setTime("");
    Promise.all([
      client
        .from("floors")
        .select("*")
        .eq("restaurant_id", selected.id)
        .eq("active", true),
      client
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", selected.id)
        .order("name"),
      client
        .from("restaurant_hours")
        .select("weekday,opens_at,closes_at,closed")
        .eq("restaurant_id", selected.id),
      client
        .from("restaurant_closures")
        .select("closed_on")
        .eq("restaurant_id", selected.id),
    ]).then(async ([floorResult, menuResult, hoursResult, closuresResult]) => {
      if (!active) return;
      const failure = [
        floorResult,
        menuResult,
        hoursResult,
        closuresResult,
      ].find((result) => result.error)?.error;
      if (failure) {
        setError(failure.message);
        return;
      }
      const nextFloors = (floorResult.data ?? []) as Floor[];
      setFloors(nextFloors);
      setMenu((menuResult.data ?? []) as MenuItem[]);
      setHours((hoursResult.data ?? []) as Hours[]);
      setClosedDates((closuresResult.data ?? []).map((row) => row.closed_on));
      if (nextFloors.length) {
        const floorIds = nextFloors.map((floor) => floor.id);
        const [tableResult, elementResult] = await Promise.all([
          client
            .from("restaurant_tables")
            .select("*")
            .in("floor_id", floorIds)
            .order("code"),
          client.from("map_elements").select("*").in("floor_id", floorIds),
        ]);
        if (!active) return;
        if (tableResult.error || elementResult.error)
          setError(
            tableResult.error?.message ??
              elementResult.error?.message ??
              "Could not load the floor plan.",
          );
        else {
          setTables((tableResult.data ?? []) as Table[]);
          setElements((elementResult.data ?? []) as MapElement[]);
        }
      }
    });
    const channel = client
      .channel(`customer-${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "menu_items",
          filter: `restaurant_id=eq.${selected.id}`,
        },
        () => {
          void client
            .from("menu_items")
            .select("*")
            .eq("restaurant_id", selected.id)
            .order("name")
            .then(({ data }) => {
              if (active) setMenu((data ?? []) as MenuItem[]);
            });
        },
      )
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, selected]);

  const weekday = date ? new Date(`${date}T12:00:00`).getDay() : -1;
  const allSlots = timeOptions(
    hours.find((hour) => hour.weekday === weekday),
    selected?.booking_duration_minutes ?? 90,
  );
  const restaurantToday = selected
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: selected.timezone || "Asia/Kolkata",
      }).format(new Date())
    : "";
  const minimumBookingTime =
    Date.now() + (selected?.minimum_notice_minutes ?? 0) * 60_000;
  const slots = allSlots.filter((slot) => {
    if (!selected || date !== restaurantToday) return true;
    return new Date(`${date}T${slot}:00+05:30`).getTime() >= minimumBookingTime;
  });
  useEffect(() => {
    if (time && !slots.includes(time)) {
      setTime("");
      setChosenTables([]);
    }
  }, [time, slots.join(",")]);
  const startsAt =
    date && time ? new Date(`${date}T${time}:00+05:30`).toISOString() : "";
  const chosenFloor = floors[0];
  const floorTables = tables.filter(
    (table) => table.floor_id === chosenFloor?.id,
  );
  const floorElements = elements.filter(
    (element) => element.floor_id === chosenFloor?.id,
  );
  const filteredRestaurants = restaurants.filter((restaurant) =>
    `${restaurant.name} ${restaurant.cuisine ?? ""} ${restaurant.location ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const categories = [
    "All",
    ...Array.from(new Set(menu.map((item) => item.category))),
  ];
  const filteredMenu = menu.filter(
    (item) =>
      (category === "All" || item.category === category) &&
      `${item.name} ${item.description ?? ""}`
        .toLowerCase()
        .includes(menuSearch.toLowerCase()),
  );
  const cartTotal = cart.reduce(
    (sum, line) =>
      sum +
      Number(
        line.portion === "half" ? line.item.half_price : line.item.full_price,
      ) *
        100 *
        line.quantity,
    0,
  );
  const totalSeats = chosenTables.reduce(
    (sum, id) => sum + (tables.find((table) => table.id === id)?.seats ?? 0),
    0,
  );

  useEffect(() => {
    if (!selected || !client || !startsAt || closedDates.includes(date)) {
      setAvailable([]);
      return;
    }
    let active = true;
    setAvailabilityLoading(true);
    void client
      .rpc("available_tables", {
        target_restaurant: selected.id,
        target_start: startsAt,
        guests: 1,
      })
      .then(({ data, error: queryError }) => {
        if (!active) return;
        setAvailabilityLoading(false);
        if (queryError) {
          setError(queryError.message);
          setAvailable([]);
        } else {
          const ids = ((data ?? []) as Available[]).map((row) => row.table_id);
          setAvailable(ids);
          setChosenTables((previous) =>
            previous.filter((id) => ids.includes(id)),
          );
        }
      });
    return () => {
      active = false;
    };
  }, [selected, client, startsAt, date, closedDates]);

  function selectTable(table: Table) {
    if (!available.includes(table.id)) return;
    setChosenTables((previous) => {
      if (previous.includes(table.id))
        return previous.filter((id) => id !== table.id);
      if (!previous.length) return [table.id];
      const first = tables.find((item) => item.id === previous[0]);
      if (
        !first?.merge_group ||
        table.merge_group !== first.merge_group ||
        previous.length >= 4
      )
        return [table.id];
      return [...previous, table.id];
    });
  }

  function addToCart(item: MenuItem, portion: CartLine["portion"]) {
    if (!item.available) return;
    setCart((previous) => {
      const match = previous.find(
        (line) => line.item.id === item.id && line.portion === portion,
      );
      return match
        ? previous.map((line) =>
            line === match ? { ...line, quantity: line.quantity + 1 } : line,
          )
        : [...previous, { item, portion, quantity: 1 }];
    });
  }

  async function sendOtp() {
    if (!client || !email.trim()) return;
    setBusy(true);
    setError("");
    const { error: authError } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (authError) setError(authError.message);
    else setNotice("Check your email for a sign-in code.");
  }

  async function verifyOtp() {
    if (!client) return;
    setBusy(true);
    setError("");
    const { error: authError } = await client.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: "email",
    });
    setBusy(false);
    if (authError) setError(authError.message);
    else setNotice("Signed in. Your selection is ready.");
  }

  async function book() {
    if (
      !client ||
      !selected ||
      !user ||
      !startsAt ||
      !chosenTables.length ||
      totalSeats < guests
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    let pendingBookingId: string | null = null;
    try {
      const { data: bookingId, error: bookingError } = await client.rpc(
        "create_booking",
        {
          target_restaurant: selected.id,
          target_start: startsAt,
          guests,
          selected_tables: chosenTables,
          request_note: request,
        },
      );
      if (bookingError || !bookingId)
        throw new Error(
          bookingError?.message ?? "Could not reserve your table.",
        );
      pendingBookingId = bookingId;
      if (cart.length) {
        const { error: preorderError } = await client.rpc("save_preorder", {
          target_booking: bookingId,
          lines: cart.map((line) => ({
            menu_item_id: line.item.id,
            portion: line.portion,
            quantity: line.quantity,
          })),
        });
        if (preorderError) throw new Error(preorderError.message);
      }
      const { data: session } = await client.auth.getSession();
      const token = session.session?.access_token;
      if (!token) throw new Error("Please sign in again.");
      const response = await fetch("/api/payments/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bookingId }),
      });
      const order = (await response.json()) as {
        error?: string;
        keyId?: string;
        orderId?: string;
      };
      if (!response.ok)
        throw new Error(order.error ?? "Payment could not start.");
      await loadRazorpay();
      const Razorpay = (window as Window & { Razorpay?: RazorpayCheckout })
        .Razorpay;
      if (!Razorpay) throw new Error("Payment checkout is unavailable.");
      let paymentReturned = false;
      new Razorpay({
        key: order.keyId,
        amount: 5000,
        currency: "INR",
        name: "QueueBite",
        description: "Table booking security deposit",
        order_id: order.orderId,
        handler: async (payment: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          paymentReturned = true;
          const verify = await fetch("/api/payments/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ bookingId, ...payment }),
          });
          const result = (await verify.json()) as { error?: string };
          if (!verify.ok)
            setError(
              result.error ??
                "Payment verification failed. Your booking is not confirmed.",
            );
          else {
            setConfirmed(bookingId);
            setNotice("Your table is confirmed.");
          }
          setBusy(false);
        },
        payment_failed: (failure: { error?: { description?: string } }) => {
          setError(
            failure.error?.description ??
              "Razorpay could not complete the payment.",
          );
          setBusy(false);
        },
        modal: {
          ondismiss: () => {
            if (!paymentReturned) {
              void client.rpc("cancel_my_booking", {
                target_booking: bookingId,
              });
              setNotice("Payment was closed. The table hold was released.");
            }
            setBusy(false);
          },
        },
      }).open();
    } catch (cause) {
      if (pendingBookingId)
        void client.rpc("cancel_my_booking", {
          target_booking: pendingBookingId,
        });
      setError(cause instanceof Error ? cause.message : "Booking failed.");
      setBusy(false);
    }
  }

  return (
    <div className="qb-site">
      <header className="qb-topbar">
        <a className="qb-logo" href="/" onClick={() => setSelected(null)}>
          <span className="qb-logo-mark">
            <UtensilsCrossed size={19} />
          </span>{" "}
          QueueBite
        </a>
        <nav aria-label="Main navigation">
          <a className="active" href="/">Explore restaurants</a>
          <a href="/manage">For restaurants <ArrowRight size={14} /></a>
        </nav>
        <div className="qb-user">
          {user ? (
            <>
              <span>{user.email}</span>
              <Button
                variant="ghost"
                onClick={() => void client?.auth.signOut()}
              >
                Sign out
              </Button>
            </>
          ) : (
            <span className="qb-guest-pill">No account needed to browse</span>
          )}
        </div>
      </header>
      <main className="qb-main">
        {confirmed ? (
          <section className="qb-panel qb-success">
            <p className="qb-kicker">Booking confirmed</p>
            <h1>Your table is ready for you.</h1>
            <p>
              Booking reference: <strong>{confirmed}</strong>
            </p>
            <p>
              {selected?.name} · {startsAt && prettyDate(startsAt)} · {guests}{" "}
              guests
            </p>
            <Button
              onClick={() => {
                setConfirmed("");
                setSelected(null);
              }}
            >
              Find another table
            </Button>
          </section>
        ) : !selected ? (
          <>
            <section className="qb-hero">
              <div className="qb-hero-copy">
                <p className="qb-hero-eyebrow"><Sparkles size={15} /> A BETTER WAY TO DINE OUT</p>
                <h1>Your table is <em>waiting.</em></h1>
                <p>Discover a place you’ll love, pick the exact table you want, and make the evening yours.</p>
                <div className="qb-hero-points">
                  <span><CalendarDays size={17} /> Book in a few taps</span>
                  <span><MapPin size={17} /> Choose your own table</span>
                </div>
              </div>
              <div className="qb-hero-art" aria-hidden="true">
                <div className="qb-art-orbit qb-art-orbit-one" />
                <div className="qb-art-orbit qb-art-orbit-two" />
                <div className="qb-art-plate"><div className="qb-art-food"><span /><span /><span /></div></div>
                <div className="qb-art-label">GOOD FOOD<br /><strong>GREAT COMPANY</strong></div>
              </div>
            </section>
            <div className="qb-discover-head">
              <div>
                <p className="qb-kicker">EXPLORE & RESERVE</p>
                <h2>Find your next favourite spot</h2>
                <p>Browse restaurants and see what’s available.</p>
              </div>
              <div className="qb-search">
                <Search size={20} />
                <Input
                  aria-label="Search restaurants"
                  placeholder="Search name, cuisine, or location"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <p className="qb-state">Loading restaurants…</p>
            ) : error ? (
              <p className="qb-error" role="alert">
                {error}
              </p>
            ) : !filteredRestaurants.length ? (
              <div className="qb-empty-state">
                <span><UtensilsCrossed size={26} /></span>
                <h3>{restaurants.length ? "No matching restaurants" : "The table is being set"}</h3>
                <p>{restaurants.length ? "Try a different name, cuisine, or location." : "Restaurants will appear here as soon as they’re ready to welcome guests."}</p>
                {restaurants.length > 0 && search && <Button variant="outline" onClick={() => setSearch("")}>Clear search</Button>}
              </div>
            ) : (
              <div className="qb-restaurant-grid">
                {filteredRestaurants.map((restaurant) => (
                  <button
                    className="qb-restaurant-card"
                    key={restaurant.id}
                    onClick={() => setSelected(restaurant)}
                  >
                    <div className="qb-restaurant-photo">
                      {restaurant.image_url ? (
                        <img src={restaurant.image_url} alt="" />
                      ) : (
                        <UtensilsCrossed size={42} />
                      )}
                    </div>
                    <div className="qb-card-body">
                      <div className="qb-card-title">
                        <h2>{restaurant.name}</h2>
                        {restaurant.rating != null && (
                          <span>
                            <Star size={15} fill="currentColor" />{" "}
                            {restaurant.rating}
                          </span>
                        )}
                      </div>
                      <p>{restaurant.cuisine || "Cuisine not added"}</p>
                      <p>
                        <MapPin size={15} />{" "}
                        {restaurant.location || "Location not added"}
                      </p>
                      <span
                        className={
                          restaurant.temporarily_closed
                            ? "qb-closed"
                            : "qb-open"
                        }
                      >
                        {restaurant.temporarily_closed
                          ? "Temporarily closed"
                          : <>Explore tables <ArrowRight size={15} /></>}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {user && myBookings.length > 0 && (
              <section className="qb-panel qb-my-bookings">
                <h2>Your bookings</h2>
                {myBookings.map((booking) => (
                  <div className="qb-list-row" key={booking.id}>
                    <strong>
                      {restaurants.find(
                        (item) => item.id === booking.restaurant_id,
                      )?.name ?? "Restaurant"}
                    </strong>
                    <span>
                      {prettyDate(booking.starts_at)} · {booking.guest_count}{" "}
                      guests
                    </span>
                    <span>{booking.status}</span>
                    {["pending", "confirmed"].includes(booking.status) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          if (
                            !window.confirm(
                              "Cancel this booking? A paid deposit requires a refund through the restaurant.",
                            )
                          )
                            return;
                          const { error: cancelError } = (await client?.rpc(
                            "cancel_my_booking",
                            { target_booking: booking.id },
                          )) ?? { error: new Error("Connection unavailable") };
                          if (cancelError) setError(cancelError.message);
                          else
                            setMyBookings((current) =>
                              current.map((item) =>
                                item.id === booking.id
                                  ? { ...item, status: "cancelled" }
                                  : item,
                              ),
                            );
                        }}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                ))}
              </section>
            )}
            <div className="qb-how-it-works">
              <div><span>01</span><strong>Discover a place</strong><p>Find the restaurant that fits your plans.</p></div>
              <div><span>02</span><strong>Pick your spot</strong><p>See the floor plan and choose your table.</p></div>
              <div><span>03</span><strong>Make it yours</strong><p>Confirm your booking and look forward to it.</p></div>
            </div>
          </>
        ) : (
          <>
            <button className="qb-back" onClick={() => setSelected(null)}>
              ← All restaurants
            </button>
            <div className="qb-restaurant-heading">
              <div>
                <p className="qb-kicker">TABLE RESERVATION</p>
                <h1>{selected.name}</h1>
                <p>
                  {selected.cuisine || "Restaurant"} ·{" "}
                  {selected.location || "Location not added"}
                </p>
              </div>
              {selected.image_url && <img src={selected.image_url} alt="" />}
            </div>
            {error && (
              <p className="qb-error" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="qb-notice" role="status">
                {notice}
              </p>
            )}
            <div className="qb-booking-grid">
              <div className="qb-booking-main">
                <section className="qb-panel">
                  <h2>1. Choose a time</h2>
                  <div className="qb-fields">
                    <label>
                      <CalendarDays size={17} /> Date
                      <Input
                        type="date"
                        min={new Date().toISOString().slice(0, 10)}
                        max={new Date(
                          Date.now() + selected.advance_days * 86400000,
                        )
                          .toISOString()
                          .slice(0, 10)}
                        value={date}
                        onChange={(event) => {
                          setDate(event.target.value);
                          setTime("");
                          setChosenTables([]);
                        }}
                      />
                    </label>
                    <label>
                      <Users size={17} /> Guests
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        value={guests}
                        onChange={(event) => {
                          setGuests(
                            Math.max(
                              1,
                              Math.min(30, Number(event.target.value)),
                            ),
                          );
                          setChosenTables([]);
                        }}
                      />
                    </label>
                  </div>
                  {date &&
                    (closedDates.includes(date) || !slots.length ? (
                      <p className="qb-state">
                        {closedDates.includes(date)
                          ? "This restaurant is closed on the selected date."
                          : "There are no future time slots left today. Choose another date."}
                      </p>
                    ) : (
                      <>
                        <p className="qb-field-label">
                          <Clock3 size={17} /> Available time slots
                        </p>
                        <div className="qb-chip-row">
                          {slots.map((slot) => (
                            <button
                              className={
                                time === slot ? "qb-chip active" : "qb-chip"
                              }
                              key={slot}
                              onClick={() => {
                                setTime(slot);
                                setChosenTables([]);
                              }}
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      </>
                    ))}
                </section>
                <section className="qb-panel">
                  <h2>2. Select your table</h2>
                  <p className="qb-help">
                    {!time
                      ? "Choose a date and time to see availability."
                      : availabilityLoading
                        ? "Checking tables…"
                        : "Select a suitable table. Connected tables can be merged when the restaurant allows it."}
                  </p>
                  {chosenFloor ? (
                    <div className="qb-map-scroll">
                    <div
                      className="qb-map"
                      role="group"
                      aria-label="Restaurant table map"
                    >
                      {floorElements.map((element) => (
                        <div
                          key={element.id}
                          className={`qb-map-element ${element.kind}`}
                          style={{
                            left: `${element.x}%`,
                            top: `${element.y}%`,
                            width: `${element.width}%`,
                            height: `${element.height}%`,
                            transform: `translate(-50%,-50%) rotate(${element.rotation}deg)`,
                          }}
                        >
                          {element.kind === "wall" ? "" : element.kind}
                        </div>
                      ))}
                      {floorTables.map((table) => {
                        const chosen = chosenTables.includes(table.id);
                        const canUse = available.includes(table.id);
                        const suitable =
                          table.seats >= guests ||
                          (table.merge_group &&
                            tables
                              .filter(
                                (other) =>
                                  other.merge_group === table.merge_group &&
                                  available.includes(other.id),
                              )
                              .reduce((sum, other) => sum + other.seats, 0) >=
                              guests);
                        return (
                          <button
                            key={table.id}
                            type="button"
                            disabled={!time || !canUse}
                            aria-pressed={chosen}
                            title={`${table.code} · ${table.seats} seats · ${chosen ? "selected" : !canUse ? "reserved or unavailable" : suitable ? "available" : "too small alone"}`}
                            className={`qb-map-table ${table.shape} ${chosen ? "selected" : canUse ? (suitable ? "available" : "unsuitable") : "unavailable"}`}
                            style={{
                              left: `${table.x}%`,
                              top: `${table.y}%`,
                              width: `${table.width}%`,
                              height: `${table.height}%`,
                              minWidth: 0,
                              minHeight: 0,
                              transform: `translate(-50%,-50%) rotate(${table.rotation}deg)`,
                            }}
                            onClick={() => selectTable(table)}
                          >
                            <strong>{table.code}</strong>
                            <small>{table.seats} seats</small>
                          </button>
                        );
                      })}
                    </div>
                    </div>
                  ) : (
                    <p className="qb-state">
                      The restaurant has not published a floor map yet.
                    </p>
                  )}
                  <div className="qb-legend">
                    <span>● Available</span>
                    <span>● Selected</span>
                    <span>● Unavailable</span>
                  </div>
                  {chosenTables.length > 0 && (
                    <p className="qb-selection">
                      {chosenTables
                        .map(
                          (id) => tables.find((table) => table.id === id)?.code,
                        )
                        .join(" + ")}{" "}
                      · {totalSeats} seats{" "}
                      {totalSeats < guests && (
                        <span>— add a mergeable table for {guests} guests</span>
                      )}
                    </p>
                  )}
                </section>
                <section className="qb-panel">
                  <h2>3. Add food, if you like</h2>
                  <div className="qb-search qb-menu-search">
                    <Search size={17} />
                    <Input
                      placeholder="Search dishes"
                      aria-label="Search dishes"
                      value={menuSearch}
                      onChange={(event) => setMenuSearch(event.target.value)}
                    />
                  </div>
                  <div className="qb-chip-row">
                    {categories.map((name) => (
                      <button
                        key={name}
                        className={
                          category === name ? "qb-chip active" : "qb-chip"
                        }
                        onClick={() => setCategory(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {!filteredMenu.length ? (
                    <p className="qb-state">
                      {menu.length
                        ? "No dishes match this search."
                        : "No menu has been published yet. You can still book a table."}
                    </p>
                  ) : (
                    <div className="qb-menu-list">
                      {filteredMenu.map((item) => (
                        <div className="qb-menu-item" key={item.id}>
                          {item.image_url ? (
                            <img src={item.image_url} alt="" />
                          ) : (
                            <div className="qb-food-placeholder">
                              <UtensilsCrossed size={22} />
                            </div>
                          )}
                          <div>
                            <strong>{item.name}</strong>
                            <span>
                              {item.is_veg ? "Veg" : "Non-veg"} ·{" "}
                              {item.category}
                            </span>
                            <div className="qb-portion-row">
                              {(["half", "full"] as const).map((portion) => {
                                const price =
                                  portion === "half"
                                    ? item.half_price
                                    : item.full_price;
                                return price == null ? null : (
                                  <button
                                    key={portion}
                                    disabled={!item.available}
                                    onClick={() => addToCart(item, portion)}
                                  >
                                    {portion} · ₹
                                    {Number(price).toLocaleString("en-IN")}
                                  </button>
                                );
                              })}
                            </div>
                            {!item.available && <small>Sold out</small>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
              <aside className="qb-panel qb-checkout">
                <h2>Your booking</h2>
                <div className="qb-receipt-row">
                  <span>Restaurant</span>
                  <strong>{selected.name}</strong>
                </div>
                <div className="qb-receipt-row">
                  <span>Date & time</span>
                  <strong>
                    {startsAt ? prettyDate(startsAt) : "Choose a slot"}
                  </strong>
                </div>
                <div className="qb-receipt-row">
                  <span>Guests</span>
                  <strong>{guests}</strong>
                </div>
                <div className="qb-receipt-row">
                  <span>Table</span>
                  <strong>
                    {chosenTables.length
                      ? chosenTables
                          .map(
                            (id) =>
                              tables.find((table) => table.id === id)?.code,
                          )
                          .join(" + ")
                      : "Choose a table"}
                  </strong>
                </div>
                <h3>Pre-order</h3>
                {cart.length ? (
                  cart.map((line) => (
                    <div
                      className="qb-cart-line"
                      key={`${line.item.id}-${line.portion}`}
                    >
                      <div>
                        <strong>{line.item.name}</strong>
                        <span>
                          {line.portion} ·{" "}
                          {rupees(
                            Number(
                              line.portion === "half"
                                ? line.item.half_price
                                : line.item.full_price,
                            ) * 100,
                          )}
                        </span>
                      </div>
                      <div className="qb-qty">
                        <button
                          aria-label="Decrease quantity"
                          onClick={() =>
                            setCart((previous) =>
                              previous.flatMap((entry) =>
                                entry === line
                                  ? entry.quantity <= 1
                                    ? []
                                    : [
                                        {
                                          ...entry,
                                          quantity: entry.quantity - 1,
                                        },
                                      ]
                                  : [entry],
                              ),
                            )
                          }
                        >
                          −
                        </button>
                        {line.quantity}
                        <button
                          aria-label="Increase quantity"
                          onClick={() =>
                            setCart((previous) =>
                              previous.map((entry) =>
                                entry === line
                                  ? { ...entry, quantity: entry.quantity + 1 }
                                  : entry,
                              ),
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="qb-help">No food added</p>
                )}
                <div className="qb-receipt-row">
                  <span>Food subtotal</span>
                  <strong>{rupees(cartTotal)}</strong>
                </div>
                <div className="qb-receipt-row">
                  <span>Security deposit due now</span>
                  <strong>₹50</strong>
                </div>
                <p className="qb-help">
                  The ₹50 deposit is deducted from your restaurant bill once.
                </p>
                <label className="qb-note-label">
                  Special request
                  <textarea
                    value={request}
                    maxLength={1000}
                    onChange={(event) => setRequest(event.target.value)}
                    placeholder="Optional notes for the restaurant"
                  />
                </label>
                {!user && (
                  <div className="qb-login">
                    <h3>Sign in to confirm</h3>
                    <Button
                      className="qb-google-button"
                      variant="outline"
                      onClick={() =>
                        void client?.auth.signInWithOAuth({
                          provider: "google",
                          options: { redirectTo: window.location.href },
                        })
                      }
                    >
                      <GoogleMark /> Continue with Google
                    </Button>
                    <p>Or sign in with an email code</p>
                    <Input
                      type="email"
                      placeholder="Email address"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void sendOtp()}
                      disabled={busy || !email}
                    >
                      Send code
                    </Button>
                    {notice.includes("email") && (
                      <div className="qb-otp">
                        <Input
                          inputMode="numeric"
                          placeholder="6-digit code"
                          value={otp}
                          onChange={(event) => setOtp(event.target.value)}
                        />
                        <Button
                          onClick={() => void verifyOtp()}
                          disabled={busy || !otp}
                        >
                          Verify
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                <Button
                  className="qb-book-button"
                  disabled={
                    busy ||
                    !user ||
                    !startsAt ||
                    !chosenTables.length ||
                    totalSeats < guests ||
                    selected.temporarily_closed
                  }
                  onClick={() => void book()}
                >
                  {busy ? "Preparing booking…" : "Pay ₹50 & confirm"}
                </Button>
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
