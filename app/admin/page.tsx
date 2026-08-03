"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Restaurant = {
  id: string;
  name: string;
  owner_name: string | null;
  owner_phone: string | null;
  status: string;
  plan: string;
  next_billing_date: string | null;
  lease_end_date: string | null;
  billing_cycle: string | null;
};

export default function AdminDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const [showPaySettings, setShowPaySettings] = useState(false);
  const [paySettings, setPaySettings] = useState({
    payment_provider: "tap", mode: "test", country_code: "BHR",
    test_api_key: "", test_secret_key: "", live_api_key: "", live_secret_key: "",
  });
  const [savingPay, setSavingPay] = useState(false);
  const [paySaveMsg, setPaySaveMsg] = useState("");

  const [form, setForm] = useState({
    restaurantName: "",
    ownerName: "",
    ownerPhone: "",
    notes: "",
    ownerEmail: "",
    ownerPassword: "",
    plan: "starter",
    billingCycle: "trial",
  });

  useEffect(() => {
    async function guardAndLoad() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        router.push("/login");
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userData.user.id)
        .single();

      if (profile?.role !== "super_admin") {
        router.push("/login");
        return;
      }

      setChecking(false);
      loadRestaurants();
      loadPaySettings();
    }
    guardAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPaySettings() {
    const { data } = await supabase.from("platform_settings").select("*").limit(1).maybeSingle();
    if (data) setPaySettings({
      payment_provider: data.payment_provider ?? "tap",
      mode: data.mode ?? "test",
      country_code: data.country_code ?? "BHR",
      test_api_key: data.test_api_key ?? "",
      test_secret_key: data.test_secret_key ?? "",
      live_api_key: data.live_api_key ?? "",
      live_secret_key: data.live_secret_key ?? "",
    });
  }

  async function savePaySettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingPay(true);
    const { data: existing } = await supabase.from("platform_settings").select("id").limit(1).maybeSingle();
    if (existing) {
      await supabase.from("platform_settings").update(paySettings).eq("id", existing.id);
    } else {
      await supabase.from("platform_settings").insert(paySettings);
    }
    setSavingPay(false);
    setPaySaveMsg("Saved ✓");
    setTimeout(() => setPaySaveMsg(""), 2000);
  }

  async function loadRestaurants() {
    const { data } = await supabase
      .from("restaurants")
      .select("id, name, owner_name, owner_phone, status, plan, next_billing_date, lease_end_date, billing_cycle")
      .order("created_at", { ascending: false });

    // Auto-pause anyone more than 3 days overdue who isn't already paused/cancelled
    const now = Date.now();
    const overdue = (data ?? []).filter((r) => {
      if (!r.next_billing_date || r.status === "paused" || r.status === "cancelled") return false;
      const daysPast = (now - new Date(r.next_billing_date).getTime()) / 86400000;
      return daysPast > 3;
    });
    for (const r of overdue) {
      await supabase.from("restaurants").update({ status: "paused" }).eq("id", r.id);
    }
    if (overdue.length > 0) {
      const { data: refreshed } = await supabase
        .from("restaurants")
        .select("id, name, owner_name, owner_phone, status, plan, next_billing_date, lease_end_date, billing_cycle")
        .order("created_at", { ascending: false });
      setRestaurants(refreshed ?? []);
      return;
    }
    setRestaurants(data ?? []);
  }

  async function markPaid(id: string, cycle: string | null) {
    const next = new Date();
    if (cycle === "monthly") next.setMonth(next.getMonth() + 1);
    else if (cycle === "quarterly") next.setMonth(next.getMonth() + 3);
    else if (cycle === "semiannual") next.setMonth(next.getMonth() + 6);
    else if (cycle === "annual") next.setFullYear(next.getFullYear() + 1);
    else next.setDate(next.getDate() + 7);
    await supabase.from("restaurants").update({
      last_paid_at: new Date().toISOString().split("T")[0],
      next_billing_date: next.toISOString().split("T")[0],
      status: "active",
    }).eq("id", id);
    loadRestaurants();
  }

  async function handleAddRestaurant(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSubmitting(true);

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-owner`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      }
    );

    const result = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setFormError(result.error ?? "Something went wrong.");
      return;
    }

    setShowForm(false);
    setForm({
      restaurantName: "",
      ownerName: "",
      ownerPhone: "",
      notes: "",
      ownerEmail: "",
      ownerPassword: "",
      plan: "starter",
      billingCycle: "trial",
    });
    loadRestaurants();
  }

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">Loading...</div>;
  }

  const statusColor: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    trial: "bg-amber-100 text-amber-700",
    overdue: "bg-red-100 text-red-700",
    suspended: "bg-neutral-200 text-neutral-600",
  };

  const now = Date.now();
  const daysUntil = (d: string | null) => (d ? Math.ceil((new Date(d).getTime() - now) / 86400000) : null);
  const dueSoon = restaurants.filter((r) => {
    const b = daysUntil(r.next_billing_date);
    const l = daysUntil(r.lease_end_date);
    return (b !== null && b <= 7) || (l !== null && l <= 60);
  });

  return (
    <div className="min-h-screen bg-[#f6f7f9] px-6 py-8 max-w-4xl mx-auto">
      {dueSoon.length > 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-6">
          <p className="text-sm font-medium text-amber-800 mb-1">🔔 {dueSoon.length} restaurant{dueSoon.length > 1 ? "s" : ""} need attention</p>
          {dueSoon.map((r) => {
            const b = daysUntil(r.next_billing_date);
            const l = daysUntil(r.lease_end_date);
            const urgent = b !== null && b <= 3;
            return (
              <div key={r.id} className="flex items-center justify-between py-0.5">
                <p className={`text-xs cursor-pointer hover:underline ${urgent ? "text-red-700 font-medium" : "text-amber-700"}`} onClick={() => router.push(`/admin/restaurant/${r.id}`)}>
                  {r.name}: {b !== null && b <= 7 ? `payment due in ${b}d ` : ""}{l !== null && l <= 60 ? `· lease ends in ${l}d` : ""}
                </p>
                {b !== null && b <= 7 && (
                  <button onClick={() => markPaid(r.id, r.billing_cycle)} className="text-xs border border-neutral-300 rounded-lg px-2 py-0.5 ml-2">✓ Mark paid</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-lg font-medium">Restaurants</h1>
          <p className="text-sm text-neutral-500">{restaurants.length} total</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowPaySettings((s) => !s)}
            className="border border-neutral-300 text-sm rounded-lg px-4 py-2"
          >
            {showPaySettings ? "Close" : "Payment API"}
          </button>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2"
          >
            {showForm ? "Cancel" : "+ Add restaurant"}
          </button>
        </div>
      </div>

      {showPaySettings && (
        <form onSubmit={savePaySettings} className="bg-white border border-neutral-200 rounded-xl p-5 mb-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <p className="text-sm font-medium mb-1">Platform payment provider</p>
          <p className="text-xs text-neutral-500 mb-3">Used to charge restaurant owners their subscription. Keys are never shown to owners.</p>

          <div className="flex items-center gap-3 mb-4">
            <div className="inline-flex bg-neutral-100 rounded-lg p-1">
              <button type="button" onClick={() => setPaySettings({ ...paySettings, mode: "test" })}
                className={`text-xs px-3 py-1.5 rounded-md ${paySettings.mode === "test" ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>Test mode</button>
              <button type="button" onClick={() => setPaySettings({ ...paySettings, mode: "live" })}
                className={`text-xs px-3 py-1.5 rounded-md ${paySettings.mode === "live" ? "bg-white shadow text-neutral-900" : "text-neutral-500"}`}>Live mode</button>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${paySettings.mode === "live" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
              {paySettings.mode === "live" ? "Real charges will occur" : "No real money moves"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Provider</label>
              <select className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.payment_provider} onChange={(e) => setPaySettings({ ...paySettings, payment_provider: e.target.value })}>
                <option value="tap">Tap Payments</option>
                <option value="myfatoorah">MyFatoorah</option>
                <option value="paytabs">PayTabs</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-neutral-500 block mb-1">Country</label>
              <select className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.country_code} onChange={(e) => setPaySettings({ ...paySettings, country_code: e.target.value })}>
                <option value="BHR">Bahrain</option>
                <option value="SAU">Saudi Arabia</option>
                <option value="ARE">UAE</option>
                <option value="KWT">Kuwait</option>
                <option value="QAT">Qatar</option>
              </select>
            </div>
          </div>

          {paySettings.mode === "test" ? (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Test API key (public)</label>
                <input type="text" className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.test_api_key} onChange={(e) => setPaySettings({ ...paySettings, test_api_key: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Test secret key</label>
                <input type="password" className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.test_secret_key} onChange={(e) => setPaySettings({ ...paySettings, test_secret_key: e.target.value })} />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Live API key (public)</label>
                <input type="text" className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.live_api_key} onChange={(e) => setPaySettings({ ...paySettings, live_api_key: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Live secret key</label>
                <input type="password" className="border rounded-lg px-3 py-2 text-sm w-full" value={paySettings.live_secret_key} onChange={(e) => setPaySettings({ ...paySettings, live_secret_key: e.target.value })} />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button disabled={savingPay} className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">{savingPay ? "Saving..." : "Save"}</button>
            {paySaveMsg && <span className="text-xs text-green-700">{paySaveMsg}</span>}
          </div>
        </form>
      )}

      {showForm && (
        <form
          onSubmit={handleAddRestaurant}
          className="bg-white border border-neutral-200 rounded-xl p-5 mb-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)] grid grid-cols-2 gap-3"
        >
          <input required placeholder="Restaurant name" className="border rounded-lg px-3 py-2 text-sm col-span-2"
            value={form.restaurantName} onChange={(e) => setForm({ ...form, restaurantName: e.target.value })} />
          <input placeholder="Owner name" className="border rounded-lg px-3 py-2 text-sm"
            value={form.ownerName} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} />
          <input placeholder="Owner phone" className="border rounded-lg px-3 py-2 text-sm"
            value={form.ownerPhone} onChange={(e) => setForm({ ...form, ownerPhone: e.target.value })} />
          <input required type="email" placeholder="Owner login email" className="border rounded-lg px-3 py-2 text-sm"
            value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} />
          <input required type="text" placeholder="Owner login password" className="border rounded-lg px-3 py-2 text-sm"
            value={form.ownerPassword} onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })} />
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Plan</label>
            <select className="border rounded-lg px-3 py-2 text-sm w-full" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="pro">Pro</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-neutral-500 block mb-1">Billing cycle</label>
            <select className="border rounded-lg px-3 py-2 text-sm w-full" value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}>
              <option value="trial">7-day trial</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly (3 mo)</option>
              <option value="semiannual">Semi-annual (6 mo)</option>
              <option value="annual">Annual (12 mo)</option>
            </select>
          </div>
          <textarea placeholder="Notes" className="border rounded-lg px-3 py-2 text-sm col-span-2"
            value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          {formError && <p className="text-sm text-red-600 col-span-2">{formError}</p>}
          <button disabled={submitting} className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2 col-span-2 disabled:opacity-50">
            {submitting ? "Creating..." : "Create restaurant + owner login"}
          </button>
        </form>
      )}

      <div className="bg-white border border-neutral-200 rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500 text-left">
              <th className="px-4 py-2 font-normal">Name</th>
              <th className="px-4 py-2 font-normal">Owner</th>
              <th className="px-4 py-2 font-normal">Plan</th>
              <th className="px-4 py-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {restaurants.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/admin/restaurant/${r.id}`)} className="border-b last:border-0 border-neutral-100 cursor-pointer hover:bg-neutral-50">
                <td className="px-4 py-3 text-neutral-900 font-medium">{r.name}</td>
                <td className="px-4 py-3 text-neutral-500">{r.owner_name || "—"}</td>
                <td className="px-4 py-3">{r.plan}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-1 rounded-full ${statusColor[r.status] ?? ""}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {restaurants.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-400">
                  No restaurants yet — add your first one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
