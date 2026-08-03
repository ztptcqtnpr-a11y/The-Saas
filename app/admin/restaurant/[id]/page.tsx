"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Restaurant = {
  id: string;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  notes: string | null;
  plan: string;
  status: string;
  next_billing_date: string | null;
  monthly_rent: number;
  monthly_labor: number;
  monthly_other: number;
  monthly_profit_goal: number;
  estimated_monthly_units: number;
};

type MenuItem = { id: string; name: string; ingredient_cost: number; labor_cost: number; rent_cost: number; price: number };
type ChecklistItem = { id: string; task: string; done: boolean };
type StaffCode = { id: string; role: "waiter" | "kitchen"; pin: string };

export default function RestaurantDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [ownerEmail, setOwnerEmail] = useState("");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [soldMap, setSoldMap] = useState<Record<string, number>>({});
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [staffCodes, setStaffCodes] = useState<StaffCode[]>([]);
  const [newPassword, setNewPassword] = useState("");
  const [resetMsg, setResetMsg] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [charging, setCharging] = useState(false);
  const [chargeMsg, setChargeMsg] = useState("");

  useEffect(() => {
    async function guardAndLoad() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).single();
      if (profile?.role !== "super_admin") return router.push("/login");

      const { data: r } = await supabase.from("restaurants").select("*").eq("id", id).single();
      setRestaurant(r);

      const { data: ownerProf } = await supabase.from("profiles").select("email").eq("restaurant_id", id).eq("role", "owner").maybeSingle();
      setOwnerEmail(ownerProf?.email ?? "");

      const { data: mi } = await supabase.from("menu_items").select("*").eq("restaurant_id", id).order("created_at");
      setMenuItems(mi ?? []);

      const { data: ci } = await supabase.from("checklist_items").select("*").eq("restaurant_id", id).order("created_at");
      setChecklist(ci ?? []);

      const { data: sc } = await supabase.from("staff_access_codes").select("id, role, pin").eq("restaurant_id", id);
      setStaffCodes(sc ?? []);

      const { data: oi } = await supabase
        .from("order_items")
        .select("menu_item_id, quantity, orders!inner(restaurant_id)")
        .eq("orders.restaurant_id", id);
      const map: Record<string, number> = {};
      (oi ?? []).forEach((row: any) => { map[row.menu_item_id] = (map[row.menu_item_id] ?? 0) + row.quantity; });
      setSoldMap(map);

      setChecking(false);
    }
    guardAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (checking || !restaurant) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-[#f6f7f9]">Loading...</div>;
  }

  async function updateStatus(status: string) {
    await supabase.from("restaurants").update({ status }).eq("id", id);
    setStatusMsg(`Status set to ${status}`);
    setRestaurant((r) => (r ? { ...r, status } : r));
    setTimeout(() => setStatusMsg(""), 2000);
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!newPassword) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/reset-owner-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ restaurantId: id, newPassword }),
    });
    const result = await res.json();
    setResetMsg(res.ok ? "Password updated ✓" : result.error);
    if (res.ok) setNewPassword("");
    setTimeout(() => setResetMsg(""), 3000);
  }

  async function chargeNow(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(chargeAmount);
    if (!amount || !restaurant) return;
    setCharging(true);
    setChargeMsg("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-charge`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ restaurantId: id, amount, billingCycle: restaurant.plan }),
    });
    const result = await res.json();
    setCharging(false);
    if (!res.ok) { setChargeMsg(result.error ?? "Charge failed"); return; }
    setChargeMsg(result.redirectUrl ? "Charge created — customer must complete 3D Secure via the redirect link." : "Charge created ✓");
    setChargeAmount("");
  }

  const rent = Number(restaurant.monthly_rent) || 0;
  const labor = Number(restaurant.monthly_labor) || 0;
  const other = Number(restaurant.monthly_other) || 0;
  const profitGoal = Number(restaurant.monthly_profit_goal) || 0;
  const breakEvenDaily = (rent + labor + other) / 30;
  const profitTargetDaily = (rent + labor + other + profitGoal) / 30;

  const itemStats = menuItems.map((m) => {
    const totalCost = Number(m.ingredient_cost) + Number(m.labor_cost) + Number(m.rent_cost);
    const margin = Number(m.price) - totalCost;
    const marginPct = m.price > 0 ? Math.round((margin / Number(m.price)) * 100) : 0;
    const sold = soldMap[m.id] ?? 0;
    return { ...m, totalCost, margin, marginPct, sold, profitGenerated: sold * margin };
  });

  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
  const statusColor: Record<string, string> = {
    active: "bg-green-100 text-green-700", trial: "bg-amber-100 text-amber-700",
    overdue: "bg-red-100 text-red-700", suspended: "bg-neutral-200 text-neutral-600",
  };

  return (
    <div className="min-h-screen bg-[#f6f7f9] px-6 py-8 max-w-4xl mx-auto">
      <button onClick={() => router.push("/admin")} className="text-sm text-neutral-500 mb-4">&larr; Back to restaurants</button>

      <div className="flex items-center gap-3 mb-2">
        <h1 className="text-lg font-semibold text-neutral-900">{restaurant.name}</h1>
        <span className={`text-xs px-2 py-1 rounded-full ${statusColor[restaurant.status] ?? ""}`}>{restaurant.status}</span>
      </div>
      <div className="flex gap-2 mb-6">
        <button onClick={() => updateStatus("active")} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Resume</button>
        <button onClick={() => updateStatus("paused")} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Pause</button>
        <button onClick={() => updateStatus("cancelled")} className="text-xs border border-red-200 text-red-600 rounded-lg px-3 py-1.5">Cancel</button>
        {statusMsg && <span className="text-xs text-neutral-500 self-center">{statusMsg}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className={`${card} p-4`}>
          <p className="text-xs text-neutral-500 mb-2">Owner contact</p>
          <p className="text-sm mb-1">{restaurant.owner_name || "—"}</p>
          <p className="text-sm mb-1">{restaurant.owner_phone || "—"}</p>
          <p className="text-sm mb-3">{ownerEmail || "—"}</p>
          <form onSubmit={resetPassword} className="flex gap-2">
            <input type="text" placeholder="New password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs flex-1" />
            <button className="text-xs bg-neutral-900 text-white rounded-lg px-3 py-1.5">Reset</button>
          </form>
          {resetMsg && <p className="text-xs text-neutral-500 mt-1">{resetMsg}</p>}
        </div>
        <div className={`${card} p-4`}>
          <p className="text-xs text-neutral-500 mb-2">Billing</p>
          <p className="text-sm mb-1">Plan: {restaurant.plan}</p>
          <p className="text-sm mb-3">Next billing: {restaurant.next_billing_date || "—"}</p>
          <form onSubmit={chargeNow} className="flex gap-2">
            <input type="number" step="0.001" placeholder="Amount (BHD)" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs flex-1" />
            <button disabled={charging} className="text-xs bg-neutral-900 text-white rounded-lg px-3 py-1.5 disabled:opacity-50">{charging ? "Charging..." : "Charge now"}</button>
          </form>
          {chargeMsg && <p className="text-xs text-neutral-500 mt-1">{chargeMsg}</p>}
        </div>
      </div>

      {restaurant.notes && (
        <div className={`${card} p-4 mb-6`}>
          <p className="text-xs text-neutral-500 mb-2">Notes</p>
          <p className="text-sm text-neutral-700">{restaurant.notes}</p>
        </div>
      )}

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 border-t border-neutral-200" />
        <p className="text-xs text-neutral-400">Owner&rsquo;s view (read-only)</p>
        <div className="flex-1 border-t border-neutral-200" />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className={`${card} p-4`}>
          <p className="text-xs text-neutral-500 mb-1">Needed daily to avoid loss</p>
          <p className="text-lg font-semibold">BHD {breakEvenDaily.toFixed(2)}</p>
        </div>
        <div className={`${card} p-4`}>
          <p className="text-xs text-neutral-500 mb-1">Needed daily for profit goal</p>
          <p className="text-lg font-semibold text-green-700">BHD {profitTargetDaily.toFixed(2)}</p>
        </div>
      </div>

      <div className={`${card} overflow-x-auto mb-6`}>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left whitespace-nowrap">
            <th className="px-3 py-2 font-normal">Item</th>
            <th className="px-3 py-2 font-normal text-right">Cost</th>
            <th className="px-3 py-2 font-normal text-right">Price</th>
            <th className="px-3 py-2 font-normal text-right">Margin</th>
            <th className="px-3 py-2 font-normal text-right">Sold</th>
            <th className="px-3 py-2 font-normal text-right">Profit made</th>
          </tr></thead>
          <tbody>
            {itemStats.map((m) => (
              <tr key={m.id} className="border-b last:border-0 border-neutral-100 whitespace-nowrap">
                <td className="px-3 py-2">{m.name}</td>
                <td className="px-3 py-2 text-right">BHD {m.totalCost.toFixed(3)}</td>
                <td className="px-3 py-2 text-right">BHD {Number(m.price).toFixed(3)}</td>
                <td className="px-3 py-2 text-right">{m.marginPct}%</td>
                <td className="px-3 py-2 text-right">{m.sold}</td>
                <td className="px-3 py-2 text-right">BHD {m.profitGenerated.toFixed(2)}</td>
              </tr>
            ))}
            {itemStats.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-neutral-400">No menu items yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className={`${card} p-4 mb-6`}>
        <p className="text-xs text-neutral-500 mb-2">Checklist ({checklist.filter(c => c.done).length}/{checklist.length} done today)</p>
        {checklist.map((t) => (
          <p key={t.id} className={`text-sm py-1 ${t.done ? "line-through text-neutral-400" : "text-neutral-800"}`}>
            {t.done ? "✓" : "○"} {t.task}
          </p>
        ))}
        {checklist.length === 0 && <p className="text-sm text-neutral-400">No checklist items yet.</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {staffCodes.map((s) => (
          <div key={s.id} className={`${card} p-4`}>
            <p className="text-sm font-medium capitalize mb-1">{s.role} PIN</p>
            <p className="text-xl font-semibold tracking-widest">{s.pin}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
