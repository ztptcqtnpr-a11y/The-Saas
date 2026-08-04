"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { staffApi } from "@/lib/staffApi";
import { queueAction, setupAutoFlush, getPendingCount } from "@/lib/offlineQueue";

type MenuItem = { id: string; name: string; name_ar: string | null; price: number };
type OrderLine = { item: MenuItem; qty: number };
type UsualOrder = { itemName: string; itemNameAr: string | null; timesOrdered: number } | null;

export default function BaristaScreen() {
  const params = useParams();
  const token = params.token as string;

  const [stage, setStage] = useState<"pin" | "checkin" | "order">("pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [restaurantName, setRestaurantName] = useState("");

  const [staffName, setStaffName] = useState("");
  const [checkinId, setCheckinId] = useState<string | null>(null);

  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [phone, setPhone] = useState("");
  const [foundCustomer, setFoundCustomer] = useState<{ id: string; name: string; visit_count: number } | null>(null);
  const [usualOrder, setUsualOrder] = useState<UsualOrder>(null);
  const [newCustomerName, setNewCustomerName] = useState("");

  const [order, setOrder] = useState<OrderLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState("");
  const [lowStockAlert, setLowStockAlert] = useState<string[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem(`barista_${token}`);
    if (saved) {
      const s = JSON.parse(saved);
      setPin(s.pin);
      setRestaurantName(s.restaurantName);
      setStaffName(s.staffName);
      setCheckinId(s.checkinId);
      setStage("order");
      loadMenu(s.pin);
    }
    const cleanup = setupAutoFlush();
    const updatePending = () => getPendingCount().then(setPendingCount);
    updatePending();
    const interval = setInterval(updatePending, 5000);
    setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      cleanup();
      clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMenu(p: string) {
    try {
      const res = await staffApi("get_menu", token, p);
      setMenu(res.items);
    } catch {
      /* offline or invalid -- menu stays empty, order still queues if attempted */
    }
  }

  async function submitPin(e: React.FormEvent) {
    e.preventDefault();
    setPinError("");
    try {
      const res = await staffApi("verify", token, pin);
      setRestaurantName(res.restaurantName);
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
    localStorage.setItem(`barista_${token}`, JSON.stringify({ pin, restaurantName, staffName: staffName.trim(), checkinId: res.checkinId }));
    await loadMenu(pin);
    setStage("order");
  }

  async function checkPhone(val: string) {
    setPhone(val);
    setFoundCustomer(null);
    setUsualOrder(null);
    if (val.length >= 6) {
      try {
        const res = await staffApi("lookup_customer", token, pin, { phone: val });
        if (res.customer) setFoundCustomer(res.customer);
        if (res.usualOrder) setUsualOrder(res.usualOrder);
      } catch {
        /* offline -- customer lookup just won't populate, barista can still take the order manually */
      }
    }
  }

  function addUsualToOrder() {
    if (!usualOrder) return;
    const match = menu.find((m) => m.name === usualOrder.itemName);
    if (match) addItem(match);
  }

  function addItem(item: MenuItem) {
    setOrder((prev) => {
      const existing = prev.find((l) => l.item.id === item.id);
      if (existing) return prev.map((l) => (l.item.id === item.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { item, qty: 1 }];
    });
  }
  function changeQty(itemId: string, delta: number) {
    setOrder((prev) => prev.map((l) => (l.item.id === itemId ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
  }

  const VAT_RATE = 0.10;
  const subtotal = order.reduce((sum, l) => sum + l.item.price * l.qty, 0);
  const vatAmount = subtotal * VAT_RATE;
  const total = subtotal + vatAmount;

  async function sendOrder() {
    if (order.length === 0) return;
    setSending(true);
    try {
      // Queue locally first (offline-first): this succeeds instantly even if
      // there's no connection, and syncs automatically when it returns.
      await queueAction(token, pin, "create_order", {
        customerPhone: phone || undefined,
        customerName: phone ? (foundCustomer?.name || newCustomerName || "Customer") : undefined,
        tableNumber: phone ? undefined : "counter", // barista orders are always counter/pickup, not table-based
        paymentMethod,
        items: order.map((l) => ({ menuItemId: l.item.id, quantity: l.qty })),
      });
      setSentMsg(online ? "Order sent ✓" : "Saved — will sync when back online ✓");
      setOrder([]);
      setPhone("");
      setNewCustomerName("");
      setFoundCustomer(null);
      setUsualOrder(null);
      setTimeout(() => setSentMsg(""), 2500);
      getPendingCount().then(setPendingCount);
    } catch {
      setSentMsg("Failed to save order.");
    }
    setSending(false);
  }

  function endShift() {
    if (checkinId) staffApi("checkout", token, pin, { checkinId }).catch(() => {});
    localStorage.removeItem(`barista_${token}`);
    setStage("pin");
    setPin("");
    setStaffName("");
    setCheckinId(null);
    setOrder([]);
  }

  const input = "border border-neutral-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

  if (stage === "pin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <form onSubmit={submitPin} className={`${card} w-full max-w-xs p-6 text-center`}>
          <p className="text-sm font-medium mb-1">Barista access</p>
          <p className="text-xs text-neutral-500 mb-4">Enter the PIN to continue</p>
          <input
            type="tel" inputMode="numeric" maxLength={6} value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={`${input} w-full text-center text-2xl tracking-[0.4em] mb-3`}
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
          <p className="text-sm font-medium">{restaurantName} — barista</p>
          <p className="text-xs text-neutral-500">{staffName}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded-full ${online ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>
            {online ? "online" : "offline"}
          </span>
          <button onClick={endShift} className="text-xs text-neutral-400">End shift</button>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
          <p className="text-xs text-amber-800">⏳ {pendingCount} order{pendingCount > 1 ? "s" : ""} waiting to sync</p>
        </div>
      )}

      <div className="mb-4">
        <input value={phone} onChange={(e) => checkPhone(e.target.value)} placeholder="Customer phone (optional)" className={`${input} w-full mb-2`} />
        {foundCustomer && (
          <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm mb-2">
            <p className="text-green-900">{foundCustomer.name} — visit #{foundCustomer.visit_count + 1}</p>
            {usualOrder && (
              <button onClick={addUsualToOrder} className="mt-2 w-full text-left bg-white border border-green-200 rounded-lg px-3 py-2 text-xs">
                <span className="font-medium text-green-800">☕ The usual: </span>
                <span className="text-green-900">{usualOrder.itemName}</span>
                <span className="text-green-600"> (ordered {usualOrder.timesOrdered}x)</span>
              </button>
            )}
          </div>
        )}
        {!foundCustomer && phone.length >= 6 && (
          <input value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} placeholder="Customer name" className={`${input} w-full`} />
        )}
      </div>

      <p className="text-xs text-neutral-500 mb-2">Menu</p>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {menu.map((item) => (
          <button key={item.id} onClick={() => addItem(item)} className={`${card} text-left p-3`}>
            <p className="text-sm">{item.name}</p>
            <p className="text-xs text-neutral-500">BHD {Number(item.price).toFixed(3)}</p>
          </button>
        ))}
        {menu.length === 0 && <p className="text-xs text-neutral-400 col-span-2">Menu unavailable — check connection.</p>}
      </div>

      {order.length > 0 && (
        <div className={`${card} p-4 mb-4`}>
          <p className="text-xs text-neutral-500 mb-2">Order</p>
          {order.map((l) => (
            <div key={l.item.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0 border-neutral-100">
              <span className="flex-1">{l.item.name}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => changeQty(l.item.id, -1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">−</button>
                <span className="w-5 text-center">{l.qty}</span>
                <button onClick={() => changeQty(l.item.id, 1)} className="w-6 h-6 rounded-md border border-neutral-300 text-neutral-600">+</button>
                <span className="w-16 text-right">BHD {(l.item.price * l.qty).toFixed(3)}</span>
              </div>
            </div>
          ))}
          <div className="flex justify-between text-sm text-neutral-500 mt-2 pt-2 border-t border-neutral-100">
            <span>Subtotal</span><span>BHD {subtotal.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm text-neutral-500">
            <span>VAT (10%)</span><span>BHD {vatAmount.toFixed(3)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium mt-1 mb-3">
            <span>Total</span><span>BHD {total.toFixed(3)}</span>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setPaymentMethod("cash")} className={`flex-1 text-xs py-2 rounded-lg ${paymentMethod === "cash" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>💵 Cash</button>
            <button onClick={() => setPaymentMethod("card")} className={`flex-1 text-xs py-2 rounded-lg ${paymentMethod === "card" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>💳 Card</button>
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
        {sending ? "Saving..." : "Complete order"}
      </button>
    </div>
  );
}
