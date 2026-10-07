"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { User } from "@supabase/supabase-js";
import {
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  LayoutGrid,
  Settings2,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { OrderBillPanel } from "@/components/order-bill-panel";
import { GoogleMark } from "@/components/google-mark";
import {
  prettyDate,
  rupees,
  type Booking,
  type Floor,
  type MapElement,
  type Membership,
  type MenuItem,
  type Order,
  type Restaurant,
  type Table,
} from "@/lib/platform-types";

type View =
  | "restaurants"
  | "dashboard"
  | "tables"
  | "map"
  | "menu"
  | "bookings"
  | "staff"
  | "settings";
type TableState = { table_id: string; status: string };
type Category = {
  id: string;
  restaurant_id: string;
  name: string;
  sort_order: number;
};
type Staff = {
  restaurant_id: string;
  user_id: string;
  role: string;
  profiles: { email: string; display_name: string | null } | null;
};
type Hours = {
  restaurant_id: string;
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  closed: boolean;
};
type Closure = {
  id: string;
  restaurant_id: string;
  closed_on: string;
  reason: string | null;
};
type BillSummary = {
  order_id: string;
  total_paise: number;
  status: string;
  paid_at: string | null;
};
type DragTarget = {
  kind: "table" | "element";
  id: string;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function ManagementWebsite() {
  const client = getSupabaseBrowserClient();
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [newRestaurant, setNewRestaurant] = useState({
    name: "",
    cuisine: "",
    location: "",
  });
  const [restaurantId, setRestaurantId] = useState("");
  const [floors, setFloors] = useState<Floor[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [elements, setElements] = useState<MapElement[]>([]);
  const [states, setStates] = useState<TableState[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [pendingPreorders, setPendingPreorders] = useState(0);
  const [popularDishIds, setPopularDishIds] = useState<string[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [hours, setHours] = useState<Hours[]>([]);
  const [closures, setClosures] = useState<Closure[]>([]);
  const [closureDate, setClosureDate] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [selectedElement, setSelectedElement] = useState<MapElement | null>(
    null,
  );
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null);
  const [menuSearch, setMenuSearch] = useState("");
  const [orderQty, setOrderQty] = useState(1);
  const [orderPortion, setOrderPortion] = useState<"half" | "full">("full");
  const [orderNote, setOrderNote] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [menuForm, setMenuForm] = useState({
    name: "",
    category: "",
    half_price: "",
    full_price: "",
    is_veg: true,
    available: true,
    image_url: "",
  });
  const [newStaffEmail, setNewStaffEmail] = useState("");
  const [newStaffRole, setNewStaffRole] = useState<
    "waiter" | "manager" | "owner"
  >("waiter");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget | null>(null);

  useEffect(() => {
    if (!client) {
      setError("Supabase connection is not configured.");
      setLoading(false);
      return;
    }
    void client.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null),
    );
    return () => subscription.subscription.unsubscribe();
  }, [client]);

  const loadAccess = useCallback(async () => {
    if (!client || !user) {
      setMemberships([]);
      setIsSuperadmin(false);
      setRestaurants([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const [membershipResult, profileResult] = await Promise.all([
      client
        .from("restaurant_memberships")
        .select("restaurant_id,role")
        .eq("user_id", user.id),
      client
        .from("profiles")
        .select("global_role")
        .eq("id", user.id)
        .maybeSingle(),
    ]);
    if (membershipResult.error || profileResult.error) {
      setError(
        membershipResult.error?.message ??
          profileResult.error?.message ??
          "Access failed.",
      );
      setLoading(false);
      return;
    }
    const memberRows = (membershipResult.data ?? []) as Membership[];
    setMemberships(memberRows);
    const isAdmin = profileResult.data?.global_role === "superadmin";
    setIsSuperadmin(isAdmin);
    const query = client.from("restaurants").select("*").order("name");
    const { data, error: restaurantError } = await (isAdmin
      ? query
      : query.in(
          "id",
          memberRows.map((row) => row.restaurant_id).length
            ? memberRows.map((row) => row.restaurant_id)
            : ["00000000-0000-0000-0000-000000000000"],
        ));
    if (restaurantError) setError(restaurantError.message);
    const rows = (data ?? []) as Restaurant[];
    setRestaurants(rows);
    setRestaurantId((current) =>
      rows.some((row) => row.id === current) ? current : (rows[0]?.id ?? ""),
    );
    setLoading(false);
  }, [client, user]);

  useEffect(() => {
    void loadAccess();
  }, [loadAccess]);

  const reload = useCallback(async () => {
    if (!client || !restaurantId) return;
    const [
      floorResult,
      menuResult,
      categoryResult,
      bookingResult,
      orderResult,
      staffResult,
      hourResult,
      closureResult,
      restaurantResult,
    ] = await Promise.all([
      client.from("floors").select("*").eq("restaurant_id", restaurantId),
      client
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("name"),
      client
        .from("menu_categories")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("sort_order"),
      client
        .from("bookings")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("starts_at", { ascending: false })
        .limit(100),
      client
        .from("orders")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("created_at", { ascending: false })
        .limit(100),
      client
        .from("restaurant_memberships")
        .select("restaurant_id,user_id,role,profiles(email,display_name)")
        .eq("restaurant_id", restaurantId),
      client
        .from("restaurant_hours")
        .select("*")
        .eq("restaurant_id", restaurantId),
      client
        .from("restaurant_closures")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .order("closed_on"),
      client.from("restaurants").select("*").eq("id", restaurantId).single(),
    ]);
    const nextFloors = (floorResult.data ?? []) as Floor[];
    setFloors(nextFloors);
    if (!menuResult.error) setMenu((menuResult.data ?? []) as MenuItem[]);
    if (!categoryResult.error)
      setCategories((categoryResult.data ?? []) as Category[]);
    if (!bookingResult.error)
      setBookings((bookingResult.data ?? []) as Booking[]);
    if (!orderResult.error) setOrders((orderResult.data ?? []) as Order[]);
    if (!staffResult.error)
      setStaff((staffResult.data ?? []) as unknown as Staff[]);
    if (!hourResult.error) setHours((hourResult.data ?? []) as Hours[]);
    if (!closureResult.error)
      setClosures((closureResult.data ?? []) as Closure[]);
    if (!restaurantResult.error && restaurantResult.data)
      setRestaurants((current) =>
        current.map((item) =>
          item.id === restaurantId
            ? (restaurantResult.data as Restaurant)
            : item,
        ),
      );
    const firstError = [
      floorResult,
      menuResult,
      categoryResult,
      bookingResult,
      orderResult,
      staffResult,
      hourResult,
      closureResult,
      restaurantResult,
    ].find((result) => result.error)?.error;
    if (firstError) setError(firstError.message);
    const orderIds = (orderResult.data ?? []).map((order) => order.id);
    if (orderIds.length) {
      const { data: billRows } = await client
        .from("bills")
        .select("order_id,total_paise,status,paid_at")
        .in("order_id", orderIds);
      setBills((billRows ?? []) as BillSummary[]);
      const { data: itemRows } = await client
        .from("order_items")
        .select("menu_item_id,quantity")
        .in("order_id", orderIds);
      const scores = new Map<string, number>();
      for (const row of itemRows ?? [])
        scores.set(
          row.menu_item_id,
          (scores.get(row.menu_item_id) ?? 0) + row.quantity,
        );
      setPopularDishIds(
        [...scores.keys()]
          .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))
          .slice(0, 5),
      );
    } else {
      setBills([]);
      setPopularDishIds([]);
    }
    const pendingIds = ((bookingResult.data ?? []) as Booking[])
      .filter(
        (booking) =>
          booking.status === "confirmed" || booking.status === "pending",
      )
      .map((booking) => booking.id);
    if (pendingIds.length) {
      const { count } = await client
        .from("preorders")
        .select("id", { count: "exact", head: true })
        .in("booking_id", pendingIds);
      setPendingPreorders(count ?? 0);
    } else setPendingPreorders(0);
    if (nextFloors.length) {
      const floorIds = nextFloors.map((floor) => floor.id);
      const [tableResult, elementResult] = await Promise.all([
        client.from("restaurant_tables").select("*").in("floor_id", floorIds),
        client.from("map_elements").select("*").in("floor_id", floorIds),
      ]);
      if (tableResult.error || elementResult.error)
        setError(
          tableResult.error?.message ??
            elementResult.error?.message ??
            "Map unavailable.",
        );
      else {
        const nextTables = (tableResult.data ?? []) as Table[];
        setTables(nextTables);
        setElements((elementResult.data ?? []) as MapElement[]);
        if (nextTables.length) {
          const { data: stateRows } = await client
            .from("table_states")
            .select("table_id,status")
            .in(
              "table_id",
              nextTables.map((table) => table.id),
            );
          setStates((stateRows ?? []) as TableState[]);
        } else setStates([]);
      }
    } else {
      setTables([]);
      setElements([]);
      setStates([]);
    }
  }, [client, restaurantId]);

  useEffect(() => {
    void reload();
    if (!client || !restaurantId) return;
    const channel = client
      .channel(`management-${restaurantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => void reload(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => void reload(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "menu_items",
          filter: `restaurant_id=eq.${restaurantId}`,
        },
        () => void reload(),
      )
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [client, restaurantId, reload]);

  const restaurant = restaurants.find((item) => item.id === restaurantId);
  const role = isSuperadmin
    ? "superadmin"
    : (memberships.find((item) => item.restaurant_id === restaurantId)?.role ??
      "waiter");
  const canManage = role !== "waiter";
  const canStaff =
    role === "superadmin" || role === "owner" || role === "manager";
  useEffect(() => {
    if (role === "waiter" && view !== "tables") setView("tables");
  }, [role, view]);
  const chosenTable = tables.find((table) => table.id === selectedTable);
  const chosenOrder = orders.find((order) => order.id === selectedOrder);
  const timezone = restaurant?.timezone || "Asia/Kolkata";
  const localDay = (value: string | Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const today = localDay(new Date());
  const todayOrders = orders.filter(
    (order) => localDay(order.created_at) === today,
  );
  const upcoming = bookings.filter(
    (booking) =>
      ["confirmed", "pending"].includes(booking.status) &&
      new Date(booking.starts_at).getTime() >= Date.now(),
  );
  const counts = {
    available: states.filter((state) => state.status === "available").length,
    occupied: states.filter((state) =>
      ["occupied", "billing"].includes(state.status),
    ).length,
    reserved: bookings.filter(
      (booking) =>
        ["confirmed", "arrived"].includes(booking.status) &&
        localDay(booking.starts_at) === today,
    ).length,
  };
  const revenue = bills
    .filter(
      (bill) =>
        bill.status === "paid" &&
        bill.paid_at &&
        localDay(bill.paid_at) === today,
    )
    .reduce((sum, bill) => sum + bill.total_paise, 0);

  async function action(
    task: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await task();
      if (result.error) throw new Error(result.error.message);
      setNotice(success);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  async function sendOtp() {
    if (!client) return;
    await action(
      () =>
        client.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        }),
      "Check your email for a sign-in code.",
    );
  }

  async function addTable() {
    if (!client || !floors[0]) return;
    const code = window.prompt("Table ID (for example T12)")?.trim();
    const seats = Number(window.prompt("Number of seats", "4"));
    if (!code || !Number.isInteger(seats) || seats < 1 || seats > 30) return;
    await action(
      () =>
        client.from("restaurant_tables").insert({
          floor_id: floors[0].id,
          code,
          seats,
          shape: "square",
          x: 50,
          y: 50,
          online_bookable: true,
        }),
      "Table added. Position it on the map.",
    );
  }

  async function saveTable(table: Table, patch: Partial<Table>) {
    if (!client) return;
    await action(
      () => client.from("restaurant_tables").update(patch).eq("id", table.id),
      "Table saved.",
    );
  }

  function beginDrag(
    kind: DragTarget["kind"],
    id: string,
    originX: number,
    originY: number,
    event: ReactPointerEvent,
  ) {
    if (!mapRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setDragTarget({
      kind,
      id,
      startX: event.clientX,
      startY: event.clientY,
      originX,
      originY,
    });
  }

  useEffect(() => {
    if (!dragTarget) return;
    const move = (event: PointerEvent) => {
      const bounds = mapRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const x = Math.max(
        0,
        Math.min(
          100,
          dragTarget.originX +
            ((event.clientX - dragTarget.startX) / bounds.width) * 100,
        ),
      );
      const y = Math.max(
        0,
        Math.min(
          100,
          dragTarget.originY +
            ((event.clientY - dragTarget.startY) / bounds.height) * 100,
        ),
      );
      if (dragTarget.kind === "table")
        setTables((current) =>
          current.map((item) =>
            item.id === dragTarget.id ? { ...item, x, y } : item,
          ),
        );
      else
        setElements((current) =>
          current.map((item) =>
            item.id === dragTarget.id ? { ...item, x, y } : item,
          ),
        );
    };
    const up = () => {
      const target = dragTarget;
      const item =
        target.kind === "table"
          ? tables.find((entry) => entry.id === target.id)
          : elements.find((entry) => entry.id === target.id);
      setDragTarget(null);
      if (!item || !client) return;
      void (target.kind === "table"
        ? client
            .from("restaurant_tables")
            .update({ x: item.x, y: item.y })
            .eq("id", target.id)
        : client
            .from("map_elements")
            .update({ x: item.x, y: item.y })
            .eq("id", target.id));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [client, dragTarget, elements, tables]);

  async function addElement(kind: MapElement["kind"]) {
    if (!client || !floors[0]) return;
    await action(
      () =>
        client.from("map_elements").insert({
          floor_id: floors[0].id,
          kind,
          x: 50,
          y: 50,
          width: kind === "wall" ? 18 : 10,
          height: kind === "wall" ? 2 : 10,
          rotation: 0,
        }),
      "Map element added.",
    );
  }

  async function blockSelectedTable() {
    if (!client || !chosenTable || !user) return;
    const start = window.prompt("Block from (YYYY-MM-DDTHH:mm)");
    const end = window.prompt("Block until (YYYY-MM-DDTHH:mm)");
    if (
      !start ||
      !end ||
      !Number.isFinite(Date.parse(start)) ||
      !Number.isFinite(Date.parse(end)) ||
      Date.parse(end) <= Date.parse(start)
    ) {
      setError("Enter a valid start and end time.");
      return;
    }
    const reason = window.prompt("Reason (optional)") ?? "";
    await action(
      () =>
        client.from("blocked_tables").insert({
          table_id: chosenTable.id,
          blocked_range: `[${new Date(start).toISOString()},${new Date(end).toISOString()})`,
          reason,
          created_by: user.id,
        }),
      "Table blocked for this time.",
    );
  }

  async function saveMenu() {
    if (
      !client ||
      !restaurantId ||
      !menuForm.name.trim() ||
      (!menuForm.half_price && !menuForm.full_price)
    )
      return;
    const halfPrice = menuForm.half_price ? Number(menuForm.half_price) : null;
    const fullPrice = menuForm.full_price ? Number(menuForm.full_price) : null;
    const payload = {
      restaurant_id: restaurantId,
      name: menuForm.name.trim(),
      description: null,
      category: menuForm.category || "Menu",
      category_id:
        categories.find(
          (item) =>
            item.name.toLowerCase() === menuForm.category.trim().toLowerCase(),
        )?.id ?? null,
      price: fullPrice ?? halfPrice ?? 0,
      half_price: halfPrice,
      full_price: fullPrice,
      is_veg: menuForm.is_veg,
      available: menuForm.available,
      image_url: menuForm.image_url || null,
    };
    await action(
      () =>
        editingMenu
          ? client.from("menu_items").update(payload).eq("id", editingMenu.id)
          : client.from("menu_items").insert(payload),
      "Dish saved.",
    );
    setEditingMenu(null);
    setMenuForm({
      name: "",
      category: "",
      half_price: "",
      full_price: "",
      is_veg: true,
      available: true,
      image_url: "",
    });
  }

  async function uploadImage(file: File, target: "dish" | "restaurant") {
    if (!client || !restaurantId) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a JPG, PNG, or WebP image under 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const path = `${restaurantId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage
      .from("queuebite-images")
      .upload(path, file, { contentType: file.type });
    if (uploadError) {
      setError(uploadError.message);
      setBusy(false);
      return;
    }
    const url = client.storage.from("queuebite-images").getPublicUrl(path)
      .data.publicUrl;
    if (target === "dish")
      setMenuForm((current) => ({ ...current, image_url: url }));
    else {
      const { error: updateError } = await client
        .from("restaurants")
        .update({ image_url: url })
        .eq("id", restaurantId);
      if (updateError) setError(updateError.message);
      else {
        setRestaurants((current) =>
          current.map((item) =>
            item.id === restaurantId ? { ...item, image_url: url } : item,
          ),
        );
        setNotice("Restaurant image saved.");
      }
    }
    setBusy(false);
  }

  async function startOrder() {
    if (!client || !chosenTable) return;
    const active = orders.find(
      (order) =>
        order.table_id === chosenTable.id &&
        !["served", "cancelled"].includes(order.status),
    );
    if (active) {
      setSelectedOrder(active.id);
      return;
    }
    setBusy(true);
    setError("");
    const { data: bookingLinks } = await client
      .from("booking_tables")
      .select("booking_id")
      .eq("table_id", chosenTable.id);
    const linkedIds = new Set(
      (bookingLinks ?? []).map((link) => link.booking_id),
    );
    const booking = bookings.find(
      (item) =>
        linkedIds.has(item.id) &&
        ["confirmed", "arrived", "seated"].includes(item.status) &&
        new Date(item.starts_at).getTime() <= Date.now() &&
        new Date(item.ends_at).getTime() >= Date.now(),
    );
    const { data, error: queryError } = await client
      .from("orders")
      .insert({
        restaurant_id: restaurantId,
        table_id: chosenTable.id,
        booking_id: booking?.id ?? null,
        source: booking ? "table" : "walk_in",
        created_by: user?.id,
      })
      .select("id")
      .single();
    setBusy(false);
    if (queryError) setError(queryError.message);
    else {
      setSelectedOrder(data.id);
      await reload();
    }
  }

  async function addOrderItem(item: MenuItem) {
    if (!client || !chosenOrder || !item.available) return;
    const price = orderPortion === "half" ? item.half_price : item.full_price;
    if (price == null) return;
    await action(
      () =>
        client.from("order_items").insert({
          order_id: chosenOrder.id,
          menu_item_id: item.id,
          portion: orderPortion,
          quantity: orderQty,
          unit_price_paise: Math.round(Number(price) * 100),
          notes: orderNote || null,
        }),
      "Item added to order.",
    );
  }

  async function createRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!client || !user || !isSuperadmin) return;
    const name = newRestaurant.name.trim();
    if (name.length < 2) {
      setError("Enter a restaurant name with at least 2 characters.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const slug = `${
      name
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "restaurant"
    }-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error: createError } = await client
      .from("restaurants")
      .insert({
        name,
        slug,
        cuisine: newRestaurant.cuisine.trim() || null,
        location: newRestaurant.location.trim() || null,
        created_by: user.id,
        active: false,
      })
      .select("id")
      .single();
    if (createError) setError(createError.message);
    else {
      setNewRestaurant({ name: "", cuisine: "", location: "" });
      await loadAccess();
      setRestaurantId(data.id);
      setView("settings");
      setNotice(
        "Restaurant created as unpublished. Add its real details, hours, menu, and map before publishing it.",
      );
    }
    setBusy(false);
  }

  async function setRestaurantPublished(target: Restaurant, active: boolean) {
    if (!client || !isSuperadmin) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { data, error: updateError } = await client
      .from("restaurants")
      .update({ active })
      .eq("id", target.id)
      .select("id")
      .maybeSingle();
    if (updateError || !data)
      setError(updateError?.message ?? "Restaurant was not updated.");
    else {
      await loadAccess();
      setNotice(
        active
          ? `${target.name} is visible on the customer website.`
          : `${target.name} was removed from the customer website.`,
      );
    }
    setBusy(false);
  }

  async function deleteRestaurant(target: Restaurant) {
    if (!client || !isSuperadmin) return;
    if (target.active) {
      setError("Unpublish this restaurant before deleting it.");
      return;
    }
    const typedName = window.prompt(
      `Permanently delete ${target.name} and its related setup data? Type the restaurant name to confirm.`,
    );
    if (typedName !== target.name) return;
    setBusy(true);
    setError("");
    setNotice("");
    const { data, error: deleteError } = await client
      .from("restaurants")
      .delete()
      .eq("id", target.id)
      .select("id")
      .maybeSingle();
    if (deleteError || !data)
      setError(
        deleteError?.code === "23503"
          ? "This restaurant has bookings, orders, or other history. Keep it unpublished instead of deleting those records."
          : (deleteError?.message ?? "Restaurant was not deleted."),
      );
    else {
      await loadAccess();
      setNotice(`${target.name} was permanently deleted.`);
    }
    setBusy(false);
  }

  const restaurantAdmin = (
    <section className="qb-panel qb-restaurant-admin">
      <div className="qb-admin-heading">
        <div>
          <p className="qb-kicker">SUPERADMIN</p>
          <h2>
            {restaurants.length
              ? "Manage restaurants"
              : "Add your first restaurant"}
          </h2>
          <p>
            New restaurants stay unpublished until their real details and
            availability are ready.
          </p>
        </div>
        <Building2 size={30} aria-hidden="true" />
      </div>
      <form
        className="qb-admin-form"
        onSubmit={(event) => void createRestaurant(event)}
      >
        <label>
          Restaurant name
          <Input
            required
            minLength={2}
            maxLength={100}
            value={newRestaurant.name}
            onChange={(event) =>
              setNewRestaurant((current) => ({
                ...current,
                name: event.target.value,
              }))
            }
            placeholder="Restaurant name"
          />
        </label>
        <label>
          Cuisine
          <Input
            maxLength={100}
            value={newRestaurant.cuisine}
            onChange={(event) =>
              setNewRestaurant((current) => ({
                ...current,
                cuisine: event.target.value,
              }))
            }
            placeholder="Optional"
          />
        </label>
        <label>
          Location
          <Input
            maxLength={160}
            value={newRestaurant.location}
            onChange={(event) =>
              setNewRestaurant((current) => ({
                ...current,
                location: event.target.value,
              }))
            }
            placeholder="Optional"
          />
        </label>
        <Button
          type="submit"
          disabled={busy || newRestaurant.name.trim().length < 2}
        >
          {busy ? "Saving…" : "Add restaurant"}
        </Button>
      </form>
      {restaurants.length > 0 && (
        <div className="qb-admin-restaurants">
          <h3>All restaurants</h3>
          {restaurants.map((item) => (
            <div className="qb-admin-restaurant" key={item.id}>
              <div>
                <strong>{item.name}</strong>
                <span>
                  {item.location || "Location not added"} ·{" "}
                  {item.active ? "Published" : "Unpublished"}
                </span>
              </div>
              <div className="qb-actions">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRestaurantId(item.id);
                    setView("settings");
                  }}
                >
                  Manage
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void setRestaurantPublished(item, !item.active)
                  }
                >
                  {item.active ? "Unpublish" : "Publish"}
                </Button>
                {!item.active && (
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void deleteRestaurant(item)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  if (!client)
    return (
      <div className="qb-manage-auth">
        <h1>QueueBite management</h1>
        <p className="qb-error">Supabase connection is not configured.</p>
      </div>
    );
  if (!user)
    return (
      <div className="qb-manage-auth">
        <a className="qb-logo" href="/">
          <span className="qb-logo-mark">
            <UtensilsCrossed size={19} />
          </span>{" "}
          QueueBite
        </a>
        <div className="qb-panel qb-auth-card">
          <p className="qb-kicker">RESTAURANT MANAGEMENT</p>
          <h1>Sign in to manage your restaurant</h1>
          <p>Everything your team needs to run a great service, all in one place.</p>
          {error && <p className="qb-error">{error}</p>}
          {notice && <p className="qb-notice">{notice}</p>}
          <Button
            className="qb-google-button"
            variant="outline"
            onClick={() =>
              void client.auth.signInWithOAuth({
                provider: "google",
                options: { redirectTo: window.location.href },
              })
            }
          >
            <GoogleMark /> Continue with Google
          </Button>
          <div className="qb-auth-divider"><span>or continue with email</span></div>
          <div className="qb-auth-fields">
            <Input
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() => void sendOtp()}
              disabled={!email || busy}
            >
              Send email code
            </Button>
            <Input
              inputMode="numeric"
              placeholder="Code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
            />
            <Button
              variant="outline"
              onClick={() =>
                void action(
                  () =>
                    client.auth.verifyOtp({ email, token: otp, type: "email" }),
                  "Signed in.",
                )
              }
              disabled={!otp || busy}
            >
              Verify code
            </Button>
          </div>
        </div>
      </div>
    );
  if (loading)
    return <div className="qb-manage-auth">Loading your restaurants…</div>;
  if (!restaurants.length && isSuperadmin)
    return (
      <div className="qb-admin-setup">
        <header>
          <a className="qb-logo" href="/">
            <span className="qb-logo-mark">
              <UtensilsCrossed size={19} />
            </span>{" "}
            QueueBite
          </a>
          <Button variant="outline" onClick={() => void client.auth.signOut()}>
            Sign out
          </Button>
        </header>
        <main>
          <p className="qb-kicker">RESTAURANT WORKSPACE</p>
          <h1>Set up your first restaurant</h1>
          <p>
            Your superadmin account is ready. Start by adding a real restaurant.
          </p>
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
          {restaurantAdmin}
        </main>
      </div>
    );
  if (!restaurants.length)
    return (
      <div className="qb-manage-auth">
        <a href="/" className="qb-logo">
          QueueBite
        </a>
        <div className="qb-panel">
          <h1>No restaurant access</h1>
          <p>
            Your account has not been assigned to a restaurant. Ask an owner to
            invite you.
          </p>
          {error && <p className="qb-error">{error}</p>}
          <Button variant="outline" onClick={() => void client.auth.signOut()}>
            Sign out
          </Button>
        </div>
      </div>
    );

  const navigation: {
    id: View;
    label: string;
    icon: React.ReactNode;
    allowed: boolean;
  }[] = [
    {
      id: "restaurants",
      label: "Restaurants",
      icon: <Building2 size={19} />,
      allowed: isSuperadmin,
    },
    {
      id: "dashboard",
      label: "Dashboard",
      icon: <ChartNoAxesCombined size={19} />,
      allowed: canManage,
    },
    {
      id: "tables",
      label: "Orders / Tables",
      icon: <LayoutGrid size={19} />,
      allowed: true,
    },
    {
      id: "map",
      label: "Map",
      icon: <LayoutGrid size={19} />,
      allowed: canManage,
    },
    {
      id: "menu",
      label: "Menu",
      icon: <UtensilsCrossed size={19} />,
      allowed: canManage,
    },
    {
      id: "bookings",
      label: "Bookings",
      icon: <ClipboardList size={19} />,
      allowed: canManage,
    },
    {
      id: "staff",
      label: "Staff",
      icon: <ClipboardList size={19} />,
      allowed: canStaff,
    },
    {
      id: "settings",
      label: "Restaurant settings",
      icon: <Settings2 size={19} />,
      allowed: canManage,
    },
  ];

  return (
    <div className="qb-management">
      <aside className="qb-sidebar">
        <a className="qb-logo" href="/">
          <span className="qb-logo-mark">
            <UtensilsCrossed size={19} />
          </span>{" "}
          QueueBite
        </a>
        <span className="qb-sidebar-label">RESTAURANT WORKSPACE</span>
        <select
          aria-label="Restaurant"
          value={restaurantId}
          onChange={(event) => {
            setRestaurantId(event.target.value);
            setSelectedTable(null);
            setSelectedOrder(null);
          }}
          className="qb-select"
        >
          {restaurants.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <nav>
          {navigation
            .filter((item) => item.allowed)
            .map((item) => (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
        </nav>
        <div className="qb-sidebar-bottom">
          <small>
            {role} · {user.email}
          </small>
          <Button variant="ghost" onClick={() => void client.auth.signOut()}>
            Sign out
          </Button>
          <a href="/">Customer website</a>
        </div>
      </aside>
      <main className="qb-manage-main">
        <div className="qb-manage-top">
          <div>
            <p className="qb-kicker">
              {view === "restaurants" ? "SUPERADMIN" : restaurant?.name}
            </p>
            <h1>{navigation.find((item) => item.id === view)?.label}</h1>
          </div>
          <span className="qb-role-pill">{role}</span>
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
        {view === "restaurants" && restaurantAdmin}
        {(view === "menu" || view === "settings") && (
          <div className="qb-upload">
            <label>
              {view === "menu" ? "Dish image" : "Restaurant image"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void uploadImage(
                      file,
                      view === "menu" ? "dish" : "restaurant",
                    );
                }}
              />
            </label>
            <span>
              {view === "menu"
                ? "Upload, then save the dish."
                : "Image appears on the customer listing."}
            </span>
          </div>
        )}
        {view === "tables" && chosenOrder && (
          <OrderBillPanel
            order={chosenOrder}
            table={chosenTable}
            menu={menu}
            canManage={canManage}
            onChange={reload}
          />
        )}
        {view === "tables" && chosenTable && canManage && (
          <div className="qb-actions">
            <Button variant="outline" onClick={() => void blockSelectedTable()}>
              Block {chosenTable.code} for a time
            </Button>
          </div>
        )}
        {view === "map" && chosenTable && (
          <section className="qb-panel qb-map-inspector">
            <h2>Table {chosenTable.code} layout</h2>
            <div className="qb-fields qb-inspector-fields">
              {(["width", "height"] as const).map((field) => (
                <label key={field}>
                  {field} %
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    defaultValue={chosenTable[field]}
                    key={`${chosenTable.id}-${field}`}
                    onBlur={(event) =>
                      void saveTable(chosenTable, {
                        [field]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
              <label>
                Shape
                <select
                  className="qb-select"
                  value={chosenTable.shape}
                  onChange={(event) =>
                    void saveTable(chosenTable, {
                      shape: event.target.value as Table["shape"],
                    })
                  }
                >
                  <option value="round">Round</option>
                  <option value="square">Square</option>
                  <option value="long">Long</option>
                </select>
              </label>
            </div>
          </section>
        )}
        {view === "map" && elements.length > 0 && (
          <section className="qb-panel qb-map-inspector">
            <h2>Map elements</h2>
            <div className="qb-chip-row">
              {elements.map((element) => (
                <button
                  key={element.id}
                  className={
                    selectedElement?.id === element.id
                      ? "qb-chip active"
                      : "qb-chip"
                  }
                  onClick={() => setSelectedElement(element)}
                >
                  {element.kind}
                </button>
              ))}
            </div>
            {selectedElement && (
              <div className="qb-fields qb-inspector-fields">
                {(["x", "y", "width", "height", "rotation"] as const).map(
                  (field) => (
                    <label key={field}>
                      {field}
                      <Input
                        type="number"
                        min={field === "rotation" ? undefined : 0}
                        max={field === "rotation" ? undefined : 100}
                        defaultValue={selectedElement[field]}
                        key={`${selectedElement.id}-${field}`}
                        onBlur={(event) =>
                          void action(
                            () =>
                              client
                                .from("map_elements")
                                .update({ [field]: Number(event.target.value) })
                                .eq("id", selectedElement.id),
                            "Map element saved.",
                          )
                        }
                      />
                    </label>
                  ),
                )}
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (window.confirm("Delete this map element?")) {
                      void action(
                        () =>
                          client
                            .from("map_elements")
                            .delete()
                            .eq("id", selectedElement.id),
                        "Map element deleted.",
                      );
                      setSelectedElement(null);
                    }
                  }}
                >
                  Delete element
                </Button>
              </div>
            )}
          </section>
        )}
        {view === "staff" && (
          <section className="qb-panel">
            <h2>Manage access</h2>
            {staff
              .filter(
                (person) =>
                  person.user_id !== user.id &&
                  (role !== "manager" || person.role === "waiter"),
              )
              .map((person) => (
                <div className="qb-list-row" key={person.user_id}>
                  <strong>{person.profiles?.email ?? person.user_id}</strong>
                  <span>{person.role}</span>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Remove this staff member?"))
                        void action(
                          () =>
                            client
                              .from("restaurant_memberships")
                              .delete()
                              .eq("restaurant_id", restaurantId)
                              .eq("user_id", person.user_id),
                          "Staff access removed.",
                        );
                    }}
                  >
                    Remove
                  </Button>
                </div>
              ))}
          </section>
        )}
        {view === "menu" && categories.length > 0 && (
          <section className="qb-panel">
            <h2>Categories</h2>
            {categories.map((item) => (
              <div className="qb-list-row" key={item.id}>
                <strong>{item.name}</strong>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const name = window
                      .prompt("Category name", item.name)
                      ?.trim();
                    if (name && name !== item.name)
                      void action(
                        () =>
                          client
                            .from("menu_categories")
                            .update({ name })
                            .eq("id", item.id),
                        "Category renamed.",
                      );
                  }}
                >
                  Rename
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete ${item.name}? Dishes will remain on the menu.`,
                      )
                    )
                      void action(
                        () =>
                          client
                            .from("menu_categories")
                            .delete()
                            .eq("id", item.id),
                        "Category deleted.",
                      );
                  }}
                >
                  Delete
                </Button>
              </div>
            ))}
          </section>
        )}
        {view === "settings" && (
          <section className="qb-panel">
            <h2>Holidays & closures</h2>
            <div className="qb-actions">
              <Input
                type="date"
                aria-label="Closed date"
                value={closureDate}
                onChange={(event) => setClosureDate(event.target.value)}
              />
              <Input
                placeholder="Reason (optional)"
                aria-label="Closure reason"
                value={closureReason}
                onChange={(event) => setClosureReason(event.target.value)}
              />
              <Button
                disabled={!closureDate}
                onClick={() =>
                  void action(
                    () =>
                      client.from("restaurant_closures").insert({
                        restaurant_id: restaurantId,
                        closed_on: closureDate,
                        reason: closureReason || null,
                      }),
                    "Closure saved.",
                  )
                }
              >
                Add closure
              </Button>
            </div>
            {closures.length ? (
              closures.map((item) => (
                <div className="qb-list-row" key={item.id}>
                  <strong>{item.closed_on}</strong>
                  <span>{item.reason || "Closed"}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void action(
                        () =>
                          client
                            .from("restaurant_closures")
                            .delete()
                            .eq("id", item.id),
                        "Closure removed.",
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))
            ) : (
              <p className="qb-state">No holiday closures added.</p>
            )}
          </section>
        )}
        {view === "map" && !floors.length && (
          <section className="qb-panel">
            <h2>Create a floor</h2>
            <Button
              onClick={() => {
                const name = window.prompt("Floor name", "Main floor")?.trim();
                if (name)
                  void action(
                    () =>
                      client
                        .from("floors")
                        .insert({ restaurant_id: restaurantId, name }),
                    "Floor added.",
                  );
              }}
            >
              Add floor
            </Button>
          </section>
        )}
        {view === "dashboard" && (
          <>
            <div className="qb-stat-grid">
              <div>
                <span>Today's sales</span>
                <strong>{rupees(revenue)}</strong>
                {!revenue && <small>No paid bills recorded today</small>}
              </div>
              <div>
                <span>Orders today</span>
                <strong>{todayOrders.length}</strong>
              </div>
              <div>
                <span>Available tables</span>
                <strong>{counts.available}</strong>
              </div>
              <div>
                <span>Occupied tables</span>
                <strong>{counts.occupied}</strong>
              </div>
              <div>
                <span>Reserved today</span>
                <strong>{counts.reserved}</strong>
              </div>
              <div>
                <span>Upcoming bookings</span>
                <strong>{upcoming.length}</strong>
              </div>
              <div>
                <span>Pending pre-orders</span>
                <strong>{pendingPreorders}</strong>
              </div>
              <div>
                <span>Revenue in loaded orders</span>
                <strong>
                  {rupees(
                    bills
                      .filter((bill) => bill.status === "paid")
                      .reduce((sum, bill) => sum + bill.total_paise, 0),
                  )}
                </strong>
              </div>
            </div>
            <div className="qb-ops-grid">
              <section className="qb-panel">
                <h2>Upcoming bookings</h2>
                {upcoming.length ? (
                  upcoming.slice(0, 8).map((booking) => (
                    <div className="qb-list-row" key={booking.id}>
                      <strong>{prettyDate(booking.starts_at)}</strong>
                      <span>{booking.guest_count} guests</span>
                      <span>{booking.status}</span>
                    </div>
                  ))
                ) : (
                  <p className="qb-state">No upcoming bookings yet.</p>
                )}
              </section>
              <section className="qb-panel">
                <h2>Popular dishes</h2>
                {popularDishIds.length ? (
                  popularDishIds.map((id) => (
                    <div className="qb-list-row" key={id}>
                      <strong>
                        {menu.find((item) => item.id === id)?.name ?? "Dish"}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p className="qb-state">No dish sales yet.</p>
                )}
              </section>
            </div>
          </>
        )}
        {view === "tables" && (
          <div className="qb-ops-grid">
            <section className="qb-panel">
              <h2>Tables</h2>
              {tables.length ? (
                <div className="qb-table-grid">
                  {tables.map((table) => {
                    const status =
                      states.find((item) => item.table_id === table.id)
                        ?.status ?? "available";
                    return (
                      <button
                        key={table.id}
                        className={
                          selectedTable === table.id
                            ? "qb-table-card active"
                            : "qb-table-card"
                        }
                        onClick={() => {
                          setSelectedTable(table.id);
                          setSelectedOrder(null);
                        }}
                      >
                        <strong>{table.code}</strong>
                        <span>{table.seats} seats</span>
                        <small>{status}</small>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="qb-state">No tables have been added.</p>
              )}
            </section>
            <section className="qb-panel">
              <h2>
                {chosenTable ? `Table ${chosenTable.code}` : "Open a table"}
              </h2>
              {chosenTable ? (
                <>
                  <p>
                    Capacity: {chosenTable.seats} ·{" "}
                    {states.find((item) => item.table_id === chosenTable.id)
                      ?.status ?? "available"}
                  </p>
                  <div className="qb-actions">
                    <Button onClick={() => void startOrder()} disabled={busy}>
                      Open POS
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void action(
                          () =>
                            client.from("table_states").upsert({
                              table_id: chosenTable.id,
                              status: "occupied",
                              updated_by: user.id,
                            }),
                          "Table marked occupied.",
                        )
                      }
                    >
                      Mark occupied
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        void action(
                          () =>
                            client.from("table_states").upsert({
                              table_id: chosenTable.id,
                              status: "available",
                              updated_by: user.id,
                            }),
                          "Table available.",
                        )
                      }
                    >
                      Release table
                    </Button>
                  </div>
                  {chosenOrder && (
                    <>
                      <h3>Order {chosenOrder.id.slice(0, 8)}</h3>
                      <p>Status: {chosenOrder.status}</p>
                      <div className="qb-fields">
                        <label>
                          Portion
                          <select
                            className="qb-select"
                            value={orderPortion}
                            onChange={(event) =>
                              setOrderPortion(
                                event.target.value as typeof orderPortion,
                              )
                            }
                          >
                            <option value="half">Half</option>
                            <option value="full">Full</option>
                          </select>
                        </label>
                        <label>
                          Quantity
                          <Input
                            type="number"
                            min={1}
                            max={99}
                            value={orderQty}
                            onChange={(event) =>
                              setOrderQty(Number(event.target.value))
                            }
                          />
                        </label>
                      </div>
                      <Input
                        placeholder="Kitchen notes"
                        value={orderNote}
                        onChange={(event) => setOrderNote(event.target.value)}
                      />
                      <Input
                        placeholder="Search menu"
                        value={menuSearch}
                        onChange={(event) => setMenuSearch(event.target.value)}
                      />
                      <div className="qb-pos-menu">
                        {menu
                          .filter((item) =>
                            item.name
                              .toLowerCase()
                              .includes(menuSearch.toLowerCase()),
                          )
                          .map((item) => (
                            <div key={item.id}>
                              <strong>{item.name}</strong>
                              <span>
                                {item.available
                                  ? [
                                      item.half_price != null
                                        ? `Half ₹${item.half_price}`
                                        : "",
                                      item.full_price != null
                                        ? `Full ₹${item.full_price}`
                                        : "",
                                    ]
                                      .filter(Boolean)
                                      .join(" · ")
                                  : "Sold out"}
                              </span>
                              <Button
                                size="sm"
                                disabled={
                                  !item.available ||
                                  (orderPortion === "half"
                                    ? item.half_price == null
                                    : item.full_price == null)
                                }
                                onClick={() => void addOrderItem(item)}
                              >
                                Add
                              </Button>
                            </div>
                          ))}
                        {!menu.length && (
                          <p className="qb-state">No dishes on the menu.</p>
                        )}
                      </div>
                      <div className="qb-actions">
                        {["accepted", "preparing", "ready", "served"].map(
                          (status) => (
                            <Button
                              key={status}
                              variant="outline"
                              onClick={() =>
                                void action(
                                  () =>
                                    client
                                      .from("orders")
                                      .update({ status })
                                      .eq("id", chosenOrder.id),
                                  `Order ${status}.`,
                                )
                              }
                            >
                              {status}
                            </Button>
                          ),
                        )}
                        <Button
                          variant="outline"
                          onClick={() => {
                            window.print();
                            void client.from("kot").insert({
                              order_id: chosenOrder.id,
                              printed_by: user.id,
                            });
                          }}
                        >
                          Print KOT
                        </Button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="qb-state">Select a table to take an order.</p>
              )}
            </section>
          </div>
        )}
        {view === "map" && (
          <>
            <div className="qb-actions qb-map-actions">
              <Button onClick={() => void addTable()}>Add table</Button>
              {(["wall", "entry", "exit", "washroom"] as const).map((kind) => (
                <Button
                  key={kind}
                  variant="outline"
                  onClick={() => void addElement(kind)}
                >
                  Add {kind}
                </Button>
              ))}
            </div>
            {floors[0] ? (
              <div className="qb-panel">
                <h2>{floors[0].name}</h2>
                <p className="qb-help">
                  Select a table or map element, then edit its position and
                  size. Changes save to the shared map.
                </p>
                <div ref={mapRef} className="qb-map qb-editor-map">
                  {elements
                    .filter((element) => element.floor_id === floors[0].id)
                    .map((element) => (
                      <button
                        key={element.id}
                        className={`qb-map-element ${element.kind}`}
                        style={{
                          left: `${element.x}%`,
                          top: `${element.y}%`,
                          width: `${element.width}%`,
                          height: `${element.height}%`,
                          transform: `translate(-50%,-50%) rotate(${element.rotation}deg)`,
                        }}
                        onClick={() => setSelectedElement(element)}
                        onPointerDown={(event) =>
                          beginDrag(
                            "element",
                            element.id,
                            element.x,
                            element.y,
                            event,
                          )
                        }
                      >
                        {element.kind === "wall" ? "" : element.kind}
                      </button>
                    ))}
                  {tables
                    .filter((table) => table.floor_id === floors[0].id)
                    .map((table) => (
                      <button
                        key={table.id}
                        className={`qb-map-table ${table.shape} available`}
                        style={{
                          left: `${table.x}%`,
                          top: `${table.y}%`,
                          width: `${table.width}%`,
                          height: `${table.height}%`,
                          minWidth: 0,
                          minHeight: 0,
                          transform: `translate(-50%,-50%) rotate(${table.rotation}deg)`,
                        }}
                        onClick={() => setSelectedTable(table.id)}
                        onPointerDown={(event) =>
                          beginDrag("table", table.id, table.x, table.y, event)
                        }
                      >
                        <strong>{table.code}</strong>
                        <small>{table.seats} seats</small>
                      </button>
                    ))}
                </div>
                {chosenTable && (
                  <div className="qb-map-edit">
                    <h3>Edit {chosenTable.code}</h3>
                    <div className="qb-fields">
                      <label>
                        Table ID
                        <Input
                          defaultValue={chosenTable.code}
                          key={`${chosenTable.id}-code`}
                          onBlur={(event) => {
                            if (event.target.value !== chosenTable.code)
                              void saveTable(chosenTable, {
                                code: event.target.value,
                              });
                          }}
                        />
                      </label>
                      <label>
                        Seats
                        <Input
                          type="number"
                          min={1}
                          max={30}
                          defaultValue={chosenTable.seats}
                          key={`${chosenTable.id}-seats`}
                          onBlur={(event) => {
                            if (
                              Number(event.target.value) !== chosenTable.seats
                            )
                              void saveTable(chosenTable, {
                                seats: Number(event.target.value),
                              });
                          }}
                        />
                      </label>
                      <label>
                        X %
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={chosenTable.x}
                          key={`${chosenTable.id}-x`}
                          onBlur={(event) =>
                            void saveTable(chosenTable, {
                              x: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Y %
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          defaultValue={chosenTable.y}
                          key={`${chosenTable.id}-y`}
                          onBlur={(event) =>
                            void saveTable(chosenTable, {
                              y: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Rotation
                        <Input
                          type="number"
                          defaultValue={chosenTable.rotation}
                          key={`${chosenTable.id}-rotation`}
                          onBlur={(event) =>
                            void saveTable(chosenTable, {
                              rotation: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label>
                        Merge group
                        <Input
                          defaultValue={chosenTable.merge_group ?? ""}
                          key={`${chosenTable.id}-merge`}
                          onBlur={(event) =>
                            void saveTable(chosenTable, {
                              merge_group: event.target.value || null,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={chosenTable.online_bookable}
                        onChange={(event) =>
                          void saveTable(chosenTable, {
                            online_bookable: event.target.checked,
                          })
                        }
                      />{" "}
                      Online bookable
                    </label>
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm(`Delete ${chosenTable.code}?`))
                          void action(
                            () =>
                              client
                                .from("restaurant_tables")
                                .delete()
                                .eq("id", chosenTable.id),
                            "Table deleted.",
                          );
                      }}
                    >
                      Delete table
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="qb-state">Add a floor before creating a map.</p>
            )}
          </>
        )}
        {view === "menu" && (
          <div className="qb-ops-grid">
            <section className="qb-panel">
              <h2>Menu</h2>
              {menu.length ? (
                menu.map((item) => (
                  <div className="qb-list-row" key={item.id}>
                    <strong>{item.name}</strong>
                    <span>
                      {item.category} ·{" "}
                      {[
                        item.half_price != null
                          ? `Half ₹${item.half_price}`
                          : "",
                        item.full_price != null
                          ? `Full ₹${item.full_price}`
                          : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span>{item.available ? "Available" : "Sold out"}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingMenu(item);
                        setMenuForm({
                          name: item.name,
                          category: item.category,
                          half_price:
                            item.half_price == null
                              ? ""
                              : String(item.half_price),
                          full_price:
                            item.full_price == null
                              ? ""
                              : String(item.full_price),
                          is_veg: item.is_veg,
                          available: item.available,
                          image_url: item.image_url ?? "",
                        });
                      }}
                    >
                      Edit
                    </Button>
                  </div>
                ))
              ) : (
                <p className="qb-state">No dishes added yet.</p>
              )}
            </section>
            <section className="qb-panel">
              <h2>{editingMenu ? "Edit dish" : "Add a dish"}</h2>
              <div className="qb-form">
                <label>
                  Name
                  <Input
                    value={menuForm.name}
                    onChange={(event) =>
                      setMenuForm({ ...menuForm, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Category
                  <Input
                    list="qb-categories"
                    value={menuForm.category}
                    onChange={(event) =>
                      setMenuForm({ ...menuForm, category: event.target.value })
                    }
                  />
                  <datalist id="qb-categories">
                    {categories.map((item) => (
                      <option key={item.id} value={item.name} />
                    ))}
                  </datalist>
                  {menuForm.category.trim() && (
                    <div
                      className="qb-help"
                      role="listbox"
                      aria-label="Saved categories"
                    >
                      {categories
                        .filter((item) =>
                          item.name
                            .toLowerCase()
                            .includes(menuForm.category.trim().toLowerCase()),
                        )
                        .map((item) => (
                          <button
                            type="button"
                            className="qb-chip"
                            key={item.id}
                            onClick={() =>
                              setMenuForm({ ...menuForm, category: item.name })
                            }
                          >
                            {item.name}
                          </button>
                        ))}
                    </div>
                  )}
                </label>
                <label>
                  Half price ₹
                  <Input
                    type="number"
                    min={0}
                    value={menuForm.half_price}
                    onChange={(event) =>
                      setMenuForm({
                        ...menuForm,
                        half_price: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Full price ₹
                  <Input
                    type="number"
                    min={0}
                    value={menuForm.full_price}
                    onChange={(event) =>
                      setMenuForm({
                        ...menuForm,
                        full_price: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  Image URL
                  <Input
                    value={menuForm.image_url}
                    onChange={(event) =>
                      setMenuForm({
                        ...menuForm,
                        image_url: event.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={menuForm.is_veg}
                    onChange={(event) =>
                      setMenuForm({ ...menuForm, is_veg: event.target.checked })
                    }
                  />{" "}
                  Vegetarian
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={menuForm.available}
                    onChange={(event) =>
                      setMenuForm({
                        ...menuForm,
                        available: event.target.checked,
                      })
                    }
                  />{" "}
                  Available
                </label>
                <div className="qb-actions">
                  <Button
                    onClick={() => void saveMenu()}
                    disabled={
                      busy ||
                      !menuForm.name ||
                      (!menuForm.half_price && !menuForm.full_price)
                    }
                  >
                    Save dish
                  </Button>
                  {editingMenu && (
                    <Button
                      variant="destructive"
                      onClick={() => {
                        if (window.confirm("Delete this dish?"))
                          void action(
                            () =>
                              client
                                .from("menu_items")
                                .delete()
                                .eq("id", editingMenu.id),
                            "Dish deleted.",
                          );
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </div>
              </div>
              <h3>Categories</h3>
              <div className="qb-actions">
                <Input
                  placeholder="Category name"
                  value={newCategory}
                  onChange={(event) => setNewCategory(event.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    void action(
                      () =>
                        client.from("menu_categories").insert({
                          restaurant_id: restaurantId,
                          name: newCategory,
                        }),
                      "Category added.",
                    );
                    setNewCategory("");
                  }}
                  disabled={!newCategory}
                >
                  Add
                </Button>
              </div>
            </section>
          </div>
        )}
        {view === "bookings" && (
          <section className="qb-panel">
            <h2>Reservations</h2>
            {bookings.length ? (
              bookings.map((booking) => (
                <div className="qb-list-row" key={booking.id}>
                  <strong>{prettyDate(booking.starts_at)}</strong>
                  <span>{booking.guest_count} guests</span>
                  <span>
                    {booking.status} · {booking.payment_status}
                  </span>
                  <select
                    className="qb-select"
                    value={booking.status}
                    onChange={(event) =>
                      void action(
                        () =>
                          client
                            .from("bookings")
                            .update({ status: event.target.value })
                            .eq("id", booking.id),
                        "Booking updated.",
                      )
                    }
                  >
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="arrived">Arrived</option>
                    <option value="seated">Seated</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="no_show">No show</option>
                  </select>
                </div>
              ))
            ) : (
              <p className="qb-state">No bookings yet.</p>
            )}
          </section>
        )}
        {view === "staff" && (
          <section className="qb-panel">
            <h2>Team</h2>
            {staff.map((person) => (
              <div className="qb-list-row" key={person.user_id}>
                <strong>
                  {person.profiles?.display_name ||
                    person.profiles?.email ||
                    person.user_id.slice(0, 8)}
                </strong>
                <span>{person.role}</span>
              </div>
            ))}
            <h3>Invite staff</h3>
            <div className="qb-actions">
              <Input
                type="email"
                placeholder="Email address"
                value={newStaffEmail}
                onChange={(event) => setNewStaffEmail(event.target.value)}
              />
              <select
                className="qb-select"
                value={newStaffRole}
                onChange={(event) =>
                  setNewStaffRole(event.target.value as typeof newStaffRole)
                }
              >
                <option value="waiter">Waiter</option>
                <option value="manager">Manager</option>
                {role === "owner" || role === "superadmin" ? (
                  <option value="owner">Owner</option>
                ) : null}
              </select>
              <Button
                disabled={!newStaffEmail}
                onClick={() =>
                  void action(
                    () =>
                      client.from("restaurant_invitations").insert({
                        restaurant_id: restaurantId,
                        email: newStaffEmail.toLowerCase().trim(),
                        role: newStaffRole,
                        invited_by: user.id,
                      }),
                    "Invitation saved. Ask this person to sign in with the same email.",
                  )
                }
              >
                Invite
              </Button>
            </div>
          </section>
        )}
        {view === "settings" && restaurant && (
          <div className="qb-ops-grid">
            <section className="qb-panel">
              <h2>Restaurant details</h2>
              <div className="qb-form">
                {(["name", "cuisine", "location", "image_url"] as const).map(
                  (field) => (
                    <label key={field}>
                      {field.replace("_", " ")}
                      <Input
                        defaultValue={restaurant[field] ?? ""}
                        onBlur={(event) => {
                          if (event.target.value !== (restaurant[field] ?? ""))
                            void action(
                              () =>
                                client
                                  .from("restaurants")
                                  .update({
                                    [field]: event.target.value || null,
                                  })
                                  .eq("id", restaurantId),
                              "Restaurant saved.",
                            );
                        }}
                      />
                    </label>
                  ),
                )}
                {(
                  [
                    "booking_duration_minutes",
                    "buffer_minutes",
                    "advance_days",
                    "minimum_notice_minutes",
                  ] as const
                ).map((field) => (
                  <label key={field}>
                    {field.replaceAll("_", " ")}
                    <Input
                      type="number"
                      min={0}
                      defaultValue={
                        (restaurant as unknown as Record<string, number>)[field]
                      }
                      onBlur={(event) =>
                        void action(
                          () =>
                            client
                              .from("restaurants")
                              .update({ [field]: Number(event.target.value) })
                              .eq("id", restaurantId),
                          "Booking settings saved.",
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  <input
                    type="checkbox"
                    checked={restaurant.temporarily_closed}
                    onChange={(event) =>
                      void action(
                        () =>
                          client
                            .from("restaurants")
                            .update({
                              temporarily_closed: event.target.checked,
                            })
                            .eq("id", restaurantId),
                        "Closure updated.",
                      )
                    }
                  />{" "}
                  Temporarily closed
                </label>
              </div>
            </section>
            <section className="qb-panel">
              <h2>Opening hours</h2>
              {days.map((day, weekday) => {
                const current = hours.find((hour) => hour.weekday === weekday);
                return (
                  <div className="qb-hours-row" key={day}>
                    <strong>{day}</strong>
                    <input
                      type="checkbox"
                      aria-label={`${day} open`}
                      checked={!!current && !current.closed}
                      onChange={(event) =>
                        void action(
                          () =>
                            client.from("restaurant_hours").upsert({
                              restaurant_id: restaurantId,
                              weekday,
                              opens_at: current?.opens_at ?? "10:00",
                              closes_at: current?.closes_at ?? "22:00",
                              closed: !event.target.checked,
                            }),
                          "Hours saved.",
                        )
                      }
                    />
                    <Input
                      type="time"
                      defaultValue={current?.opens_at?.slice(0, 5) ?? "10:00"}
                      onBlur={(event) =>
                        void action(
                          () =>
                            client.from("restaurant_hours").upsert({
                              restaurant_id: restaurantId,
                              weekday,
                              opens_at: event.target.value,
                              closes_at: current?.closes_at ?? "22:00",
                              closed: current?.closed ?? false,
                            }),
                          "Hours saved.",
                        )
                      }
                    />
                    <Input
                      type="time"
                      defaultValue={current?.closes_at?.slice(0, 5) ?? "22:00"}
                      onBlur={(event) =>
                        void action(
                          () =>
                            client.from("restaurant_hours").upsert({
                              restaurant_id: restaurantId,
                              weekday,
                              opens_at: current?.opens_at ?? "10:00",
                              closes_at: event.target.value,
                              closed: current?.closed ?? false,
                            }),
                          "Hours saved.",
                        )
                      }
                    />
                  </div>
                );
              })}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
