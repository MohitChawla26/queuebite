"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BillPanelSkeleton } from "@/components/loading-skeletons";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { rupees, type MenuItem, type Order, type Table } from "@/lib/platform-types";

type Line = { id: string; menu_item_id: string; portion: string; quantity: number; unit_price_paise: number; notes: string | null };
type ChargeUnit = "rupees" | "percent";
type ChargeKey = "tax" | "service" | "discount";
type Charge = { unit: ChargeUnit; value: string };
type Charges = Record<ChargeKey, Charge>;
type Bill = {
  id: string; subtotal_paise: number; tax_paise: number; service_paise: number;
  discount_paise: number; deposit_deducted_paise: number; total_paise: number;
  tax_unit: ChargeUnit; tax_value: number; service_unit: ChargeUnit;
  service_value: number; discount_unit: ChargeUnit; discount_value: number;
  status: string; paid_at: string | null;
};

const emptyCharges = (): Charges => ({
  tax: { unit: "rupees", value: "0" },
  service: { unit: "rupees", value: "0" },
  discount: { unit: "rupees", value: "0" },
});

function chargePaise(charge: Charge, subtotalPaise: number) {
  const amount = Number(charge.value || 0);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(charge.unit === "percent" ? subtotalPaise * amount / 100 : amount * 100);
}

export function OrderBillPanel({ order, table, menu, canManage, refreshNonce, onChange }: { order: Order; table?: Table; menu: MenuItem[]; canManage: boolean; refreshNonce: number; onChange: () => Promise<void> }) {
  const client = getSupabaseBrowserClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [charges, setCharges] = useState<Charges>(emptyCharges);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const loadLines = useCallback(async () => {
    if (!client) return;
    const lineResult = await client.from("order_items").select("*").eq("order_id", order.id).order("id");
    if (lineResult.error) setError(lineResult.error.message);
    else setLines((lineResult.data ?? []) as Line[]);
  }, [client, order.id]);

  const loadBill = useCallback(async () => {
    if (!client) return;
    const billResult = await client.from("bills").select("*").eq("order_id", order.id).maybeSingle();
    if (billResult.error) setError(billResult.error.message);
    else {
      const saved = billResult.data as Bill | null;
      setBill(saved);
      setCharges(saved ? {
        tax: { unit: saved.tax_unit ?? "rupees", value: String(saved.tax_value ?? saved.tax_paise / 100) },
        service: { unit: saved.service_unit ?? "rupees", value: String(saved.service_value ?? saved.service_paise / 100) },
        discount: { unit: saved.discount_unit ?? "rupees", value: String(saved.discount_value ?? saved.discount_paise / 100) },
      } : emptyCharges());
    }
  }, [client, order.id]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      await Promise.all([loadLines(), loadBill()]);
      if (active) setInitialLoading(false);
    });
    return () => { active = false; };
  }, [loadLines, loadBill]);
  useEffect(() => { if (refreshNonce) void Promise.resolve().then(loadLines); }, [loadLines, refreshNonce]);
  useEffect(() => {
    if (!client) return;
    const channel = client.channel(`order-bill-${order.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, () => void loadLines())
      .on("postgres_changes", { event: "*", schema: "public", table: "bills", filter: `order_id=eq.${order.id}` }, () => void loadBill())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, order.id, loadLines, loadBill]);
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + line.quantity * line.unit_price_paise, 0), [lines]);
  const taxPaise = chargePaise(charges.tax, subtotal);
  const servicePaise = chargePaise(charges.service, subtotal);
  const discountPaise = chargePaise(charges.discount, subtotal);
  const depositPaise = bill?.deposit_deducted_paise ?? 0;
  const total = Math.max(0, subtotal + taxPaise + servicePaise - discountPaise - depositPaise);
  const readOnly = busy;

  function updateCharge(key: ChargeKey, next: Partial<Charge>) {
    setNotice("");
    setCharges((current) => ({ ...current, [key]: { ...current[key], ...next } }));
  }

  function changeUnit(key: ChargeKey, unit: ChargeUnit) {
    const amountPaise = chargePaise(charges[key], subtotal);
    const value = unit === "percent"
      ? subtotal ? (amountPaise / subtotal * 100).toFixed(2) : "0"
      : (amountPaise / 100).toFixed(2);
    updateCharge(key, { unit, value });
  }

  async function changeQuantity(line: Line, quantity: number) {
    if (!client || bill?.status === "paid") return;
    setBusy(true); setError(""); setNotice("");
    const { error: changeError } = quantity < 1
      ? await client.from("order_items").delete().eq("id", line.id)
      : await client.from("order_items").update({ quantity }).eq("id", line.id);
    if (changeError) setError(changeError.message);
    else {
      setLines((current) => quantity < 1
        ? current.filter((item) => item.id !== line.id)
        : current.map((item) => item.id === line.id ? { ...item, quantity } : item));
      await onChange();
    }
    setBusy(false);
  }

  async function saveBill(markPaid: boolean) {
    if (!client) return;
    for (const [key, charge] of Object.entries(charges) as [ChargeKey, Charge][]) {
      const value = Number(charge.value || 0);
      if (!Number.isFinite(value) || value < 0 || (charge.unit === "percent" && value > 100) || (charge.unit === "rupees" && value > 21_474_836.47)) {
        setError(`Enter a valid ${key} amount${charge.unit === "percent" ? " between 0% and 100%" : ""}.`);
        return;
      }
    }
    setBusy(true); setError(""); setNotice("");
    const values = {
      tax_unit: charges.tax.unit, tax_value: Number(charges.tax.value || 0), tax_paise: taxPaise,
      service_unit: charges.service.unit, service_value: Number(charges.service.value || 0), service_paise: servicePaise,
      discount_unit: charges.discount.unit, discount_value: Number(charges.discount.value || 0), discount_paise: discountPaise,
    };
    const paymentFields = markPaid ? { status: "paid", paid_at: new Date().toISOString() } : {};
    const { error: saveError } = bill
      ? await client.from("bills").update({ ...values, ...paymentFields }).eq("id", bill.id)
      : await client.from("bills").insert({ order_id: order.id, ...values, ...paymentFields });
    if (saveError) setError(saveError.message);
    else { setNotice(markPaid ? "Bill marked paid." : "Bill saved."); await loadBill(); await onChange(); }
    setBusy(false);
  }

  const chargeField = (key: ChargeKey, label: string, appliedPaise: number) => (
    <label key={key} className="qb-charge-field">
      <span>{label}</span>
      <span className="qb-charge-input">
        <Input type="number" min={0} max={charges[key].unit === "percent" ? 100 : undefined} step="0.01" value={charges[key].value} disabled={readOnly}
          onChange={(event) => updateCharge(key, { value: event.target.value })} aria-label={`${label} amount`} />
        <select className="qb-select" value={charges[key].unit} disabled={readOnly} onChange={(event) => changeUnit(key, event.target.value as ChargeUnit)} aria-label={`${label} unit`}>
          <option value="rupees">₹</option>
          <option value="percent">%</option>
        </select>
      </span>
      <small>{rupees(appliedPaise)} applied</small>
    </label>
  );

  if (initialLoading) return <BillPanelSkeleton />;

  return <section className="qb-panel qb-bill-panel">
    <div className="qb-bill-head">
      <div>
        <p className="qb-kicker">LIVE BILL</p>
        <h2>Order {order.id.slice(0, 8)}</h2>
        <small>{table?.code ?? "Table"} · {new Date(order.created_at).toLocaleString("en-IN")}</small>
      </div>
      <span className={`qb-bill-status ${bill?.status === "paid" ? "paid" : ""}`}>{bill?.status === "paid" ? "Paid" : "Open"}</span>
    </div>
    {error && <p className="qb-error">{error}</p>}
    {notice && <p className="qb-notice">{notice}</p>}
    <div className="qb-bill-section-title"><h3>Items</h3><span>Updates live</span></div>
    <div className="qb-bill-items">
      {lines.length ? lines.map((line) => {
        const dish = menu.find((item) => item.id === line.menu_item_id)?.name ?? "Dish";
        return <div className="qb-bill-item" key={line.id}>
          <div className="qb-bill-item-name"><strong>{dish}</strong><small>{line.portion} · {rupees(line.unit_price_paise)} each</small>{line.notes && <small>{line.notes}</small>}</div>
          <div className="qb-bill-item-side"><strong>{rupees(line.quantity * line.unit_price_paise)}</strong>
            {bill?.status !== "paid" ? <div className="qb-bill-quantity">
              <Button size="sm" variant="outline" disabled={busy} aria-label={`Remove one ${dish}`} onClick={() => void changeQuantity(line, line.quantity - 1)}>−</Button>
              <span>{line.quantity}</span>
              <Button size="sm" variant="outline" disabled={busy || line.quantity >= 99} aria-label={`Add one ${dish}`} onClick={() => void changeQuantity(line, line.quantity + 1)}>+</Button>
            </div> : <small>× {line.quantity}</small>}
          </div>
        </div>;
      }) : <p className="qb-state">Add a dish in the POS to start this bill.</p>}
    </div>
    <div className="qb-receipt-row"><span>Subtotal</span><strong>{rupees(subtotal)}</strong></div>
    {canManage && <>
      <div className="qb-bill-adjustments">
        <div className="qb-bill-section-title"><h3>Adjustments</h3></div>
        <div className="qb-charge-fields">
          {chargeField("tax", "Tax", taxPaise)}
          {chargeField("service", "Service", servicePaise)}
          {chargeField("discount", "Discount", discountPaise)}
        </div>
        <p className="qb-charge-hint">Percentages use the subtotal.</p>
      </div>
      {depositPaise > 0 && <div className="qb-receipt-row"><span>Deposit deduction</span><strong>−{rupees(depositPaise)}</strong></div>}
      <div className="qb-bill-total" aria-live="polite"><span>Total due</span><strong>{rupees(total)}</strong></div>
      <div className="qb-bill-actions">
        <Button variant="outline" disabled={readOnly} onClick={() => void saveBill(false)}>Save bill</Button>
        <Button disabled={readOnly || !lines.length || bill?.status === "paid"} onClick={() => void saveBill(true)}>{bill?.status === "paid" ? "Paid" : "Mark paid"}</Button>
      </div>
      {bill?.status === "paid" && <p className="qb-charge-hint">Saving edits keeps this bill marked paid.</p>}
    </>}
  </section>;
}
