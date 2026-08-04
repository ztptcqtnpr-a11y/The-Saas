"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { staffApi } from "@/lib/staffApi";

type OrderItem = { id: string; quantity: number; notes: string | null; menu_items: { name: string } };
type Order = { id: string; table_number: string | null; status: "pending" | "in_progress" | "ready"; created_at: string; customers: { name: string } | null; order_items: OrderItem[]; placed_via?: string };

export default function KitchenApp() {
  const params = useParams();
  const token = params.token as string;

  const [stage, setStage] = useState<"pin" | "checkin" | "board">("pin");
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState("");
  const [restaurantName, setRestaurantName] = useState("");
  const [staffName, setStaffName] = useState("");
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [connected, setConnected] = useState(true);
  const prevCount = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(`kitchen_${token}`);
    if (saved) {
      const s = JSON.parse(saved);
      setPin(s.pin);
      setRestaurantName(s.restaurantName);
      setStaffName(s.staffName);
      setCheckinId(s.checkinId);
      setStage("board");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (stage !== "board") return;
    const interval = setInterval(() => poll(), 4000);
    poll();
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  function beep() {
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.start(); osc.stop(ctx.currentTime + 0.2);
    } catch {}
  }

  async function poll() {
    try {
      const res = await staffApi("get_orders", token, pin);
      if (res.orders.length > prevCount.current) beep();
      prevCount.current = res.orders.length;
      setOrders(res.orders);
      setConnected(true);
    } catch {
      setConnected(false);
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
    localStorage.setItem(`kitchen_${token}`, JSON.stringify({ pin, restaurantName, staffName: staffName.trim(), checkinId: res.checkinId }));
    setStage("board");
  }

  async function updateStatus(orderId: string, status: string) {
    await staffApi("update_order_status", token, pin, { orderId, status });
    poll();
  }

  function endShift() {
    if (checkinId) staffApi("checkout", token, pin, { checkinId }).catch(() => {});
    localStorage.removeItem(`kitchen_${token}`);
    setStage("pin"); setPin(""); setStaffName(""); setCheckinId(null); setOrders([]);
  }

  const input = "border border-neutral-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

  if (stage === "pin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <form onSubmit={submitPin} className={`${card} w-full max-w-xs p-6 text-center`}>
          <p className="text-sm font-medium mb-1">Kitchen access</p>
          <p className="text-xs text-neutral-500 mb-4">Enter the PIN to continue</p>
          <input type="tel" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            className={`${input} w-full text-center text-2xl tracking-[0.5em] mb-3`} placeholder="••••••" autoFocus />
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
    <div className="min-h-screen bg-[#f6f7f9] px-5 py-5">
      <div className="flex justify-between items-center mb-5">
        <p className="text-base font-medium">{restaurantName} — kitchen</p>
        <div className="flex items-center gap-3">
          <span className={`text-xs px-2 py-1 rounded-full ${connected ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
            {connected ? "connected" : "reconnecting..."}
          </span>
          <button onClick={endShift} className="text-xs text-neutral-400">End shift</button>
        </div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
        {orders.map((o) => {
          const minutesAgo = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
          const statusLabel = { pending: "New", in_progress: "Preparing", ready: "Ready" }[o.status];
          const statusColor = { pending: "bg-blue-100 text-blue-700", in_progress: "bg-amber-100 text-amber-700", ready: "bg-green-100 text-green-700" }[o.status];
          return (
            <div key={o.id} className={`${card} p-3 ${minutesAgo >= 10 ? "border-red-300" : ""}`}>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-medium flex items-center gap-1.5">
                  {o.table_number ? `Table ${o.table_number}` : o.customers?.name || "Customer"}
                  {o.placed_via === "qr" && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">QR</span>}
                </span>
                <span className={`text-xs ${minutesAgo >= 10 ? "text-red-600" : "text-neutral-500"}`}>{minutesAgo}m</span>
              </div>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full mb-2 ${statusColor}`}>{statusLabel}</span>
              {o.order_items.map((it) => (
                <div key={it.id}>
                  <p className="text-sm">{it.quantity}x {it.menu_items?.name}</p>
                  {it.notes && <p className="text-xs text-amber-700 italic pl-2">↳ {it.notes}</p>}
                </div>
              ))}
              {o.status === "pending" && (
                <button onClick={() => updateStatus(o.id, "in_progress")} className="w-full mt-3 text-xs bg-amber-600 text-white rounded-lg py-2">Start preparing</button>
              )}
              {o.status === "in_progress" && (
                <button onClick={() => updateStatus(o.id, "ready")} className="w-full mt-3 text-xs bg-neutral-900 text-white rounded-lg py-2">Mark ready</button>
              )}
              {o.status === "ready" && (
                <button onClick={() => updateStatus(o.id, "served")} className="w-full mt-3 text-xs border border-neutral-300 rounded-lg py-2">Mark served</button>
              )}
            </div>
          );
        })}
        {orders.length === 0 && <p className="text-sm text-neutral-400 col-span-full text-center py-8">No active orders.</p>}
      </div>
    </div>
  );
}
