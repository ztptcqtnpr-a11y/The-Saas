"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { staffApi } from "@/lib/staffApi";

type MenuItem = { id: string; name: string; price: number };
type OrderLine = { item: MenuItem; qty: number; notes: string };

export default function WaiterApp() {
  const params = useParams();
  const token = params.token as string;

  const [stage, setStage] = useState<"pin" | "checkin" | "order">("pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [plan, setPlan] = useState("starter");

  const [staffName, setStaffName] = useState("");
  const [checkinId, setCheckinId] = useState<string | null>(null);

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [mode, setMode] = useState<"table" | "customer">("table");
  const [tableNumber, setTableNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [foundCustomer, setFoundCustomer] = useState<{ id: string; name: string; visit_count: number; loyalty_points: number } | null>(null);
  const [loyaltyRule, setLoyaltyRule] = useState<{ redeem_points_required: number; redeem_reward_name: string } | null>(null);
  const [redeemMsg, setRedeemMsg] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [order, setOrder] = useState<OrderLine[]>([]);
  const [sending, setSending] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [sentMsg, setSentMsg] = useState("");
  const [lowStockAlert, setLowStockAlert] = useState<string[]>([]);
  const [readyOrders, setReadyOrders] = useState<{ id: string; table_number: string | null; customers: { name: string } | null }[]>([]);

  useEffect(() => {
    const saved = localStorage.getItem(`waiter_${token}`);
    if (saved) {
      const s = JSON.parse(saved);
      setPin(s.pin);
      setRestaurantName(s.restaurantName);
      setPlan(s.plan ?? "starter");
      setStaffName(s.staffName);
      setCheckinId(s.checkinId);
      setStage("order");
      loadMenu(s.pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMenu(p: string) {
    try {
      const res = await staffApi("get_menu", token, p);
      setMenu(res.items);
    } catch {
      /* ignore, will reprompt pin on next action if invalid */
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setPinError("");
    try {
      const res = await staffApi("verify", token, pin);
      setRestaurantName(res.restaurantName);
      setPlan(res.plan);
      setStage("checkin");
    } catch {
      setPinError("Incorrect PIN.");
    }
  }

  async function submitCheckin(e: React.FormEvent) {
    e.preventDefault();
    if (!staffName.trim()) return;
    const res = await staffApi("checkin", token, pin, { staffName: staffName.trim() });
    setCheckinId(res.checkinId);
    localStorage.setItem(`waiter_${token}`, JSON.stringify({ pin, restaurantName, plan, staffName: staffName.trim(), checkinId: res.checkinId }));
    await loadMenu(pin);
    setStage("order");
  }

  async function checkPhone(val: string) {
    setPhone(val);
    setFoundCustomer(null);
    if (val.length >= 6) {
      const res = await staffApi("lookup_customer", token, pin, { phone: val });
      if (res.customer) setFoundCustomer(res.customer);
      if (res.loyaltyRule) setLoyaltyRule(res.loyaltyRule);
    }
  }

  async function redeem() {
    if (!foundCustomer || redeeming) return;
    setRedeeming(true);
    try {
      const res = await staffApi("redeem_points", token, pin, { customerId: foundCustomer.id });
      setRedeemMsg(`Redeemed: ${res.reward} ✓`);
      setFoundCustomer({ ...foundCustomer, loyalty_points: foundCustomer.loyalty_points - (loyaltyRule?.redeem_points_required ?? 0) });
      setTimeout(() => setRedeemMsg(""), 3000);
    } catch {
      setRedeemMsg("Not enough points.");
    }
    setRedeeming(false);
  }

  function addItem(item: MenuItem) {
    setOrder((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { item, qty: 1, notes: "" }];
    });
  }

  function setNote(itemId: string, notes: string) {
    setOrder((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, notes } : l)));
  }

  function changeQty(itemId: string, delta: number) {
    setOrder((prev) =>
      prev
        .map((l) => (l.item.id === itemId ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );
  }

  function removeItem(itemId: string) {
    setOrder((prev) => prev.filter((l) => l.item.id !== itemId));
  }

  const VAT_RATE = 0.10;
  const subtotal = order.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const vatAmount = subtotal * VAT_RATE;
  const total = subtotal + vatAmount;

  async function sendOrder() {
    if (order.length === 0) return;
    if (mode === "table" && !tableNumber) return;
    if (mode === "customer" && !phone) return;
    setSending(true);
    try {
      const res = await staffApi("create_order", token, pin, {
        tableNumber: mode === "table" ? tableNumber : undefined,
        customerPhone: mode === "customer" ? phone : undefined,
        customerName: mode === "customer" ? (foundCustomer?.name || newCustomerName) : undefined,
        marketingOptIn: optIn,
        items: order.map((l) => ({ menuItemId: l.item.id, quantity: l.qty, notes: l.notes || undefined })),
      });
      setSentMsg("Sent to kitchen ✓");
      if (res.lowStockWarnings?.length) {
        setLowStockAlert(res.lowStockWarnings.map((w: { ingredientName: string; remaining: number }) => `${w.ingredientName} running low (${w.remaining} left)`));
        setTimeout(() => setLowStockAlert([]), 6000);
      }
      setOrder([]);
      setTableNumber("");
      setPhone("");
      setNewCustomerName("");
      setFoundCustomer(null);
      setTimeout(() => setSentMsg(""), 2500);
    } catch {
      setSentMsg("Failed to send — check connection.");
    }
    setSending(false);
  }

  function endShift() {
    if (checkinId) staffApi("checkout", token, pin, { checkinId }).catch(() => {});
    localStorage.removeItem(`waiter_${token}`);
    setStage("pin");
    setPin("");
    setStaffName("");
    setCheckinId(null);
    setOrder([]);
  }

  useEffect(() => {
    if (stage !== "order") return;
    const poll = async () => {
      try {
        const res = await staffApi("get_ready_orders", token, pin);
        setReadyOrders(res.orders);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  async function pickedUp(orderId: string) {
    await staffApi("update_order_status", token, pin, { orderId, status: "served" });
    setReadyOrders((prev) => prev.filter((o) => o.id !== orderId));
  }

  const input = "border border-neutral-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

  if (stage === "pin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <form onSubmit={submitPin} className={`${card} w-full max-w-xs p-6 text-center`}>
          <p className="text-sm font-medium mb-1">Waiter access</p>
          <p className="text-xs text-neutral-500 mb-4">Enter the PIN to continue</p>
          <input
            type="tel" inputMode="numeric" maxLength={6} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={`${input} w-full text-center text-2xl tracking-[0.5em] mb-3`}
            placeholder="••••••" autoFocus
          />
          {pinError && <p className="text-xs text-red-600 mb-2">{pinError}</p>}
          <button className="w-full bg-neutral-900 text-white text-sm rounded-lg py-2.5">Continue</button>
        </form>
      </div>
    );
  }

  if (stage === "checkin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <form onSubmit={submitCheckin} className={`${card} w-full max-w-xs p-6 text-center`}>
          <p className="text-sm font-medium mb-1">{restaurantName}</p>
          <p className="text-xs text-neutral-500 mb-4">What&rsquo;s your name? (checking you in)</p>
          <input value={staffName} onChange={(e) => setStaffName(e.target.value)} className={`${input} w-full mb-3`} placeholder="Your name" autoFocus />
          <button className="w-full bg-neutral-900 text-white text-sm rounded-lg py-2.5">Check in & start</button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] px-4 py-5 max-w-md mx-auto">
      <div className="flex justify-between items-center mb-4">
        <div>
          <p className="text-sm font-medium">{restaurantName}</p>
          <p className="text-xs text-neutral-500">{staffName}</p>
        </div>
        <button onClick={endShift} className="text-xs text-neutral-400">End shift</button>
      </div>

      {readyOrders.length > 0 && (
        <div className="bg-green-50 border border-green-100 rounded-xl p-3 mb-4">
          <p className="text-xs font-medium text-green-800 mb-2">🔔 Ready for pickup</p>
          {readyOrders.map((o) => (
            <div key={o.id} className="flex items-center justify-between text-sm py-1">
              <span className="text-green-900">
                {o.table_number ? `Table ${o.table_number} — take it out` : `${o.customers?.name || "Customer"} — pickup order ready`}
              </span>
              <button onClick={() => pickedUp(o.id)} className="text-xs bg-green-700 text-white rounded-lg px-2 py-1">Picked up</button>
            </div>
          ))}
        </div>
      )}

      <div className="inline-flex bg-white border border-neutral-200 rounded-lg p-1 mb-3">
        <button onClick={() => setMode("table")} className={`text-xs px-3 py-1.5 rounded-md ${mode === "table" ? "bg-neutral-900 text-white" : ""}`}>Table</button>
        <button onClick={() => setMode("customer")} className={`text-xs px-3 py-1.5 rounded-md ${mode === "customer" ? "bg-neutral-900 text-white" : ""}`}>Customer</button>
      </div>

      {mode === "table" ? (
        <input value={tableNumber} onChange={(e) => setTableNumber(e.target.value)} placeholder="Table number" className={`${input} w-32 mb-4`} />
      ) : (
        <div className="mb-4">
          <input value={phone} onChange={(e) => checkPhone(e.target.value)} placeholder="Phone number" className={`${input} w-full mb-2`} />
          {foundCustomer && (
            <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm">
              <div className="flex justify-between items-center">
                <span>{foundCustomer.name} — visit #{foundCustomer.visit_count + 1}</span>
                {plan !== "starter" && <span className="text-xs text-green-700">{foundCustomer.loyalty_points} pts</span>}
              </div>
              {plan !== "starter" && loyaltyRule && foundCustomer.loyalty_points >= loyaltyRule.redeem_points_required && (
                <button onClick={redeem} disabled={redeeming} className="mt-2 text-xs bg-green-700 text-white rounded-lg px-3 py-1.5 disabled:opacity-50">
                  {redeeming ? "Redeeming..." : `Redeem ${loyaltyRule.redeem_points_required} pts → ${loyaltyRule.redeem_reward_name}`}
                </button>
              )}
              {redeemMsg && <p className="text-xs text-green-700 mt-1">{redeemMsg}</p>}
            </div>
          )}
          {!foundCustomer && phone.length >= 6 && (
            <div>
              <input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Customer name" className={`${input} w-full mb-2`} />
              <label className="flex items-center gap-2 text-xs text-neutral-500">
                <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} /> OK to send offers
              </label>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-neutral-500 mb-2">Menu</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {menu.map((item) => (
          <button key={item.id} onClick={() => addItem(item)} className={`${card} text-left p-3`}>
            <p className="text-sm">{item.name}</p>
            <p className="text-xs text-neutral-500">BHD {Number(item.price).toFixed(3)}</p>
          </button>
        ))}
        {menu.length === 0 && <p className="text-xs text-neutral-400 col-span-2">No menu items yet — ask the owner to add some.</p>}
      </div>

      {order.length > 0 && (
        <div className={`${card} p-4 mb-4`}>
          <p className="text-xs text-neutral-500 mb-2">Current order</p>
          {order.map((l) => (
            <div key={l.item.id} className="py-1.5 border-b last:border-0 border-neutral-100">
              <div className="flex items-center justify-between text-sm">
                <span className="flex-1">{l.item.name}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => changeQty(l.item.id, -1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">−</button>
                  <span className="w-5 text-center">{l.qty}</span>
                  <button onClick={() => changeQty(l.item.id, 1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">+</button>
                  <span className="w-16 text-right">BHD {(l.item.price * l.qty).toFixed(3)}</span>
                  <button onClick={() => removeItem(l.item.id)} className="text-neutral-400 hover:text-red-600 px-1">✕</button>
                </div>
              </div>
              <input
                value={l.notes}
                onChange={(e) => setNote(l.item.id, e.target.value)}
                placeholder="Note for kitchen (e.g. no sugar)"
                className="w-full text-xs border border-neutral-200 rounded-md px-2 py-1 mt-1 outline-none focus:border-neutral-400"
              />
            </div>
          ))}
          <div className="flex justify-between text-sm text-neutral-500 mt-2 pt-2 border-t border-neutral-100">
            <span>Subtotal</span><span>BHD {subtotal.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-500">
            <span>VAT (10%)</span><span>BHD {vatAmount.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium mt-1">
            <span>Total</span><span>BHD {total.toFixed(3)}</span>
          </div>
        </div>
      )}

      {sentMsg && <p className="text-sm text-center text-green-700 mb-2">{sentMsg}</p>}
      {lowStockAlert.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
          {lowStockAlert.map((msg, i) => <p key={i} className="text-xs text-amber-800">⚠ {msg}</p>)}
        </div>
      )}

      <button onClick={sendOrder} disabled={sending || order.length === 0} className="w-full bg-neutral-900 text-white text-sm rounded-lg py-3 disabled:opacity-40">
        {sending ? "Sending..." : "Send to kitchen"}
      </button>
    </div>
  );
}
