"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { rupees, type MenuItem, type Order, type Table } from "@/lib/platform-types";

type Line = { id: string; menu_item_id: string; portion: string; quantity: number; unit_price_paise: number; notes: string | null };
type Bill = { id: string; subtotal_paise: number; tax_paise: number; service_paise: number; discount_paise: number; deposit_deducted_paise: number; total_paise: number; status: string };

export function OrderBillPanel({ order, table, menu, canManage, onChange }: { order: Order; table?: Table; menu: MenuItem[]; canManage: boolean; onChange: () => Promise<void> }) {
  const client = getSupabaseBrowserClient();
  const [lines, setLines] = useState<Line[]>([]);
  const [bill, setBill] = useState<Bill | null>(null);
  const [tax, setTax] = useState(0); const [service, setService] = useState(0); const [discount, setDiscount] = useState(0);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!client) return;
    const [lineResult, billResult] = await Promise.all([
      client.from("order_items").select("*").eq("order_id", order.id),
      client.from("bills").select("*").eq("order_id", order.id).maybeSingle(),
    ]);
    if (lineResult.error) setError(lineResult.error.message); else setLines((lineResult.data ?? []) as Line[]);
    if (billResult.error) setError(billResult.error.message);
    else { const value = billResult.data as Bill | null; setBill(value); if (value) { setTax(value.tax_paise); setService(value.service_paise); setDiscount(value.discount_paise); } }
  }, [client, order.id]);
  useEffect(() => { void load(); }, [load]);
  const subtotal = useMemo(() => lines.reduce((sum, line) => sum + line.quantity * line.unit_price_paise, 0), [lines]);

  async function changeQuantity(line: Line, quantity: number) {
    if (!client || bill?.status === "paid") return;
    setBusy(true); setError("");
    const { error: changeError } = quantity < 1
      ? await client.from("order_items").delete().eq("id", line.id)
      : await client.from("order_items").update({ quantity }).eq("id", line.id);
    if (changeError) setError(changeError.message);
    else { await load(); await onChange(); }
    setBusy(false);
  }

  async function saveBill(markPaid: boolean) {
    if (!client) return;
    setBusy(true); setError("");
    const { error: saveError } = await client.from("bills").upsert({ order_id: order.id, tax_paise: tax, service_paise: service, discount_paise: discount, status: markPaid ? "paid" : "open", paid_at: markPaid ? new Date().toISOString() : null }, { onConflict: "order_id" });
    if (saveError) setError(saveError.message);
    else { setNotice(markPaid ? "Bill marked paid." : "Bill saved."); await load(); await onChange(); }
    setBusy(false);
  }

  return <section className="qb-panel qb-bill-panel"><h2>Order details · {table?.code ?? "Table"}</h2><p className="qb-kot-meta">Order {order.id.slice(0,8)} · {new Date(order.created_at).toLocaleString("en-IN")}</p>{error && <p className="qb-error">{error}</p>}{notice && <p className="qb-notice">{notice}</p>}{lines.length ? lines.map(line => <div className="qb-list-row" key={line.id}><strong>{menu.find(item => item.id === line.menu_item_id)?.name ?? "Dish"}</strong><span>{line.portion} × {line.quantity}</span><span>{rupees(line.quantity * line.unit_price_paise)}</span>{line.notes && <small>{line.notes}</small>}{bill?.status !== "paid" && <div className="qb-qty"><Button size="sm" variant="outline" disabled={busy} aria-label={`Remove one ${menu.find(item => item.id === line.menu_item_id)?.name ?? "dish"}`} onClick={() => void changeQuantity(line, line.quantity - 1)}>−</Button><Button size="sm" variant="outline" disabled={busy || line.quantity >= 99} aria-label={`Add one ${menu.find(item => item.id === line.menu_item_id)?.name ?? "dish"}`} onClick={() => void changeQuantity(line, line.quantity + 1)}>+</Button></div>}</div>) : <p className="qb-state">No items in this order yet.</p>}
    <div className="qb-receipt-row"><span>Subtotal</span><strong>{rupees(subtotal)}</strong></div>
    {canManage && <><div className="qb-fields qb-charge-fields"><label>Tax ₹<Input type="number" min={0} value={tax / 100} onChange={event => setTax(Math.max(0, Math.round(Number(event.target.value) * 100)))}/></label><label>Service ₹<Input type="number" min={0} value={service / 100} onChange={event => setService(Math.max(0, Math.round(Number(event.target.value) * 100)))}/></label><label>Discount ₹<Input type="number" min={0} value={discount / 100} onChange={event => setDiscount(Math.max(0, Math.round(Number(event.target.value) * 100)))}/></label></div><div className="qb-receipt-row"><span>₹50 deposit deduction</span><strong>{rupees(bill?.deposit_deducted_paise ?? 0)}</strong></div><div className="qb-receipt-row"><span>Final total</span><strong>{rupees(bill?.total_paise ?? Math.max(0,subtotal+tax+service-discount))}</strong></div><div className="qb-actions"><Button variant="outline" disabled={busy} onClick={() => void saveBill(false)}>Save bill</Button><Button disabled={busy || !lines.length || bill?.status === "paid"} onClick={() => void saveBill(true)}>{bill?.status === "paid" ? "Paid" : "Mark paid"}</Button></div></>}
  </section>;
}
