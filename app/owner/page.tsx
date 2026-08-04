"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";

type Branch = {
  id: string;
  name: string;
  address: string | null;
  is_primary: boolean;
  billed_separately: boolean;
  monthly_rent: number;
  monthly_labor: number;
  monthly_other: number;
  monthly_profit_goal: number;
  estimated_monthly_units: number;
  lease_end_date: string | null;
  active: boolean;
};

type MenuItem = {
  id: string;
  name: string;
  name_ar: string | null;
  description_en: string | null;
  description_ar: string | null;
  ingredient_cost: number;
  labor_cost: number;
  rent_cost: number;
  price: number;
};

type Ingredient = { id: string; name: string; unit: string; quantity_on_hand: number; low_stock_threshold: number };
type ChecklistItem = { id: string; task: string; done: boolean };
type StaffCode = { id: string; role: "waiter" | "kitchen" | "barista"; pin: string; active: boolean; url_token: string; label: string };
type CheckinLog = { id: string; staff_name: string; role: string; checked_in_at: string; checked_out_at: string | null };
type CustomerRow = { id: string; name: string; phone: string; visit_count: number; loyalty_points: number; total_spent: number; last_visit: string };
type TeamMember = { id: string; full_name: string | null; email: string | null; role: string };
type BranchTable = { id: string; table_number: string; qr_token: string; active: boolean };

type Tab = "overview" | "menu" | "ingredients" | "checklist" | "staff" | "qr" | "customers" | "checkins" | "team" | "branches" | "billing";

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
const CYCLE_LABEL: Record<string, string> = { monthly: "1 month", quarterly: "3 months", semiannual: "6 months", annual: "12 months" };

export default function OwnerDashboard() {
  const router = useRouter();
  const supabase = createClient();

  const [checking, setChecking] = useState(true);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [restaurantName, setRestaurantName] = useState("");
  const [restaurantStatus, setRestaurantStatus] = useState("active");
  const [nextBillingDate, setNextBillingDate] = useState<string | null>(null);
  const [billingCycle, setBillingCycle] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<"owner" | "manager">("owner");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [plan, setPlan] = useState("starter");
  const [planPrices, setPlanPrices] = useState<Record<string, number>>({});
  const [checkoutPlan, setCheckoutPlan] = useState("starter");
  const [checkoutCycle, setCheckoutCycle] = useState("monthly");
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutMsg, setCheckoutMsg] = useState("");
  const [defaultLang, setDefaultLang] = useState<"en" | "ar">("en");
  const [planLimits, setPlanLimits] = useState<{ max_branches: number; qr_ordering: boolean; barista_memory: boolean; whatsapp_digest: boolean; predictive_stock: boolean } | null>(null);
  const [branchLimitMsg, setBranchLimitMsg] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [whatsappDigestEnabled, setWhatsappDigestEnabled] = useState(false);

  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [addingBranch, setAddingBranch] = useState(false);

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [newItem, setNewItem] = useState({ name: "", name_ar: "", description_en: "", description_ar: "", ingredient_cost: "", labor_cost: "", rent_cost: "", price: "" });
  const [soldMap, setSoldMap] = useState<Record<string, number>>({});
  const [showArabicFields, setShowArabicFields] = useState(false);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [newIngredient, setNewIngredient] = useState({ name: "", unit: "g", quantity_on_hand: "", low_stock_threshold: "" });
  const [restockAmount, setRestockAmount] = useState<Record<string, string>>({});
  const [linkIngredient, setLinkIngredient] = useState<Record<string, { ingredientId: string; qty: string }>>({});
  const [forecast, setForecast] = useState<Record<string, { avg_daily_usage: number; estimated_days_remaining: number | null }>>({});

  const [branchTables, setBranchTables] = useState<BranchTable[]>([]);
  const [newTableNumber, setNewTableNumber] = useState("");

  const [costs, setCosts] = useState({ monthly_rent: "0", monthly_labor: "0", monthly_other: "0", monthly_profit_goal: "0", estimated_monthly_units: "300" });
  const [savingCosts, setSavingCosts] = useState(false);

  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newTask, setNewTask] = useState("");

  const [staffCodes, setStaffCodes] = useState<StaffCode[]>([]);
  const [leaseEndDate, setLeaseEndDate] = useState("");
  const [checkins, setCheckins] = useState<CheckinLog[]>([]);
  const [checkinRange, setCheckinRange] = useState<"today" | "7d" | "30d" | "all">("today");
  const [monthlyRevenue, setMonthlyRevenue] = useState(0);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loyaltyRule, setLoyaltyRule] = useState({ points_per_bhd: "1", redeem_points_required: "30", redeem_reward_name: "Free coffee" });
  const [savingRule, setSavingRule] = useState(false);

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [newManager, setNewManager] = useState({ name: "", email: "", password: "" });
  const [addingManager, setAddingManager] = useState(false);
  const [managerMsg, setManagerMsg] = useState("");

  useEffect(() => {
    async function guardAndLoad() {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return router.push("/login");

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, restaurant_id")
        .eq("id", userData.user.id)
        .single();

      if ((profile?.role !== "owner" && profile?.role !== "manager") || !profile.restaurant_id) return router.push("/login");

      setRestaurantId(profile.restaurant_id);
      setMyRole(profile.role as "owner" | "manager");

      const { data: restaurant } = await supabase
        .from("restaurants")
        .select("name, status, plan, default_menu_language, next_billing_date, billing_cycle")
        .eq("id", profile.restaurant_id)
        .single();

      if (restaurant) {
        setRestaurantName(restaurant.name);
        setRestaurantStatus(restaurant.status ?? "active");
        setPlan(restaurant.plan ?? "starter");
        setCheckoutPlan(restaurant.plan ?? "starter");
        setBillingCycle(restaurant.billing_cycle ?? null);
        setNextBillingDate(restaurant.next_billing_date ?? null);
        setDefaultLang((restaurant.default_menu_language as "en" | "ar") ?? "en");

        const { data: limits } = await supabase.from("plan_limits").select("*").eq("plan", restaurant.plan ?? "starter").maybeSingle();
        if (limits) setPlanLimits(limits);

        const { data: allPlans } = await supabase.from("plan_limits").select("plan, monthly_price_bhd");
        if (allPlans) {
          const priceMap: Record<string, number> = {};
          allPlans.forEach((p: any) => { priceMap[p.plan] = Number(p.monthly_price_bhd); });
          setPlanPrices(priceMap);
        }
      }

      const { data: waSettings } = await supabase.from("restaurants").select("owner_whatsapp_number, whatsapp_digest_enabled").eq("id", profile.restaurant_id).single();
      if (waSettings) {
        setWhatsappNumber(waSettings.owner_whatsapp_number ?? "");
        setWhatsappDigestEnabled(waSettings.whatsapp_digest_enabled ?? false);
      }

      const { data: branchRows } = await supabase
        .from("branches")
        .select("*")
        .eq("restaurant_id", profile.restaurant_id)
        .order("created_at");
      const loadedBranches = branchRows ?? [];
      setBranches(loadedBranches);
      const primary = loadedBranches.find((b) => b.is_primary) ?? loadedBranches[0];
      const currentBranchId = primary?.id ?? null;
      setActiveBranchId(currentBranchId);

      if (currentBranchId) {
        await loadBranchScopedData(currentBranchId, loadedBranches, restaurant?.plan ?? "starter");
      }

      await Promise.all([
        loadRevenue(profile.restaurant_id),
        loadCustomers(profile.restaurant_id),
        loadLoyaltyRule(profile.restaurant_id),
        loadTeam(profile.restaurant_id),
      ]);

      setChecking(false);
    }
    guardAndLoad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBranchScopedData(branchId: string, branchList?: Branch[], planOverride?: string) {
    const list = branchList ?? branches;
    const branch = list.find((b) => b.id === branchId);
    await Promise.all([
      loadMenu(branchId),
      loadIngredients(branchId, planOverride ?? plan),
      loadChecklist(branchId),
      loadStaffCodes(branchId),
      loadSold(branchId),
      loadCheckins(branchId),
      loadBranchTables(branchId),
    ]);
    setCosts({
      monthly_rent: String(branch?.monthly_rent ?? 0),
      monthly_labor: String(branch?.monthly_labor ?? 0),
      monthly_other: String(branch?.monthly_other ?? 0),
      monthly_profit_goal: String(branch?.monthly_profit_goal ?? 0),
      estimated_monthly_units: String(branch?.estimated_monthly_units ?? 300),
    });
    setLeaseEndDate(branch?.lease_end_date ?? "");
  }

  async function switchBranch(branchId: string) {
    setActiveBranchId(branchId);
    await loadBranchScopedData(branchId);
  }

  async function addBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurantId || !newBranchName.trim()) return;
    setBranchLimitMsg("");
    if (planLimits && branches.length >= planLimits.max_branches) {
      setBranchLimitMsg(
        plan === "pro"
          ? "You've reached your plan's included branch limit. Contact your platform administrator to add a paid extra branch."
          : `Your ${plan} plan includes up to ${planLimits.max_branches} branch${planLimits.max_branches > 1 ? "es" : ""}. Upgrade your plan to add more.`
      );
      return;
    }
    setAddingBranch(true);
    const { data, error } = await supabase.from("branches").insert({
      restaurant_id: restaurantId,
      name: newBranchName.trim(),
      is_primary: false,
      billed_separately: true, // extra branches beyond the first are billed separately
    }).select().single();
    setAddingBranch(false);
    if (!error && data) {
      setBranches((prev) => [...prev, data]);
      setNewBranchName("");
    }
  }

  async function loadMenu(branchId: string) {
    const { data } = await supabase.from("menu_items").select("*").eq("branch_id", branchId).order("created_at");
    setMenuItems(data ?? []);
  }
  async function loadIngredients(branchId: string, planForForecast?: string) {
    const { data } = await supabase.from("ingredients").select("*").eq("branch_id", branchId).order("name");
    setIngredients(data ?? []);
    if ((planForForecast ?? plan) === "pro") {
      const { data: forecastData } = await supabase.from("ingredient_stock_forecast").select("ingredient_id, avg_daily_usage, estimated_days_remaining").eq("branch_id", branchId);
      const map: Record<string, { avg_daily_usage: number; estimated_days_remaining: number | null }> = {};
      (forecastData ?? []).forEach((f: any) => { map[f.ingredient_id] = { avg_daily_usage: f.avg_daily_usage, estimated_days_remaining: f.estimated_days_remaining }; });
      setForecast(map);
    }
  }
  async function loadBranchTables(branchId: string) {
    const { data } = await supabase.from("branch_tables").select("*").eq("branch_id", branchId).order("table_number");
    setBranchTables(data ?? []);
  }
  async function loadChecklist(branchId: string) {
    const { data } = await supabase.from("checklist_items").select("*").eq("branch_id", branchId).order("created_at");
    setChecklist(data ?? []);
  }
  async function loadStaffCodes(branchId: string) {
    const { data } = await supabase.from("staff_access_codes").select("id, role, pin, active, url_token, label").eq("branch_id", branchId).order("created_at");
    setStaffCodes(data ?? []);
  }
  async function loadTeam(rid: string) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, role").eq("restaurant_id", rid).order("created_at");
    setTeam(data ?? []);
  }

  async function addStaffCode(role: "waiter" | "kitchen" | "barista") {
    if (!restaurantId || !activeBranchId) return;
    const limit = plan === "starter" ? (role === "kitchen" ? 1 : 2) : 999;
    const currentCount = staffCodes.filter((s) => s.role === role).length;
    if (currentCount >= limit) return;
    // 6-digit PIN (up from 4) -- meaningfully harder to brute force, paired with
    // server-side rate limiting in staff-api.
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    await supabase.from("staff_access_codes").insert({
      restaurant_id: restaurantId, branch_id: activeBranchId, role, pin: newPin,
      label: `${role === "waiter" ? "Waiter" : role === "kitchen" ? "Kitchen" : "Barista"} ${currentCount + 1}`,
    });
    loadStaffCodes(activeBranchId);
  }
  async function deleteStaffCode(id: string) {
    await supabase.from("staff_access_codes").delete().eq("id", id);
    if (activeBranchId) loadStaffCodes(activeBranchId);
  }
  async function regenerateCode(id: string) {
    const newPin = Math.floor(100000 + Math.random() * 900000).toString();
    await supabase.from("staff_access_codes").update({ pin: newPin }).eq("id", id);
    if (activeBranchId) loadStaffCodes(activeBranchId);
  }

  async function addManager(e: React.FormEvent) {
    e.preventDefault();
    if (!newManager.email || !newManager.password) return;
    setAddingManager(true);
    setManagerMsg("");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-manager`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ managerName: newManager.name, managerEmail: newManager.email, managerPassword: newManager.password }),
    });
    const result = await res.json();
    setAddingManager(false);
    if (!res.ok) { setManagerMsg(result.error ?? "Failed to add manager"); return; }
    setNewManager({ name: "", email: "", password: "" });
    setManagerMsg("Manager added ✓");
    if (restaurantId) loadTeam(restaurantId);
    setTimeout(() => setManagerMsg(""), 2500);
  }

  // After Tap redirects back from a hosted checkout, confirm the charge server-side
  // (never trust the redirect query string alone) and refresh billing state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const tapId = params.get("tap_id");
    if (!tapId) return;
    (async () => {
      setCheckoutMsg("Confirming payment...");
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/confirm-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ chargeId: tapId }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setCheckoutMsg("Payment confirmed ✓");
        if (restaurantId) {
          const { data: r } = await supabase.from("restaurants").select("status, plan, next_billing_date, billing_cycle").eq("id", restaurantId).single();
          if (r) {
            setRestaurantStatus(r.status ?? "active");
            setPlan(r.plan ?? "starter");
            setNextBillingDate(r.next_billing_date ?? null);
            setBillingCycle(r.billing_cycle ?? null);
          }
        }
      } else {
        setCheckoutMsg("Payment not completed — try again from the Billing tab.");
      }
      window.history.replaceState({}, "", window.location.pathname);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCheckout(planToBuy: string, cycle: string) {
    if (!restaurantId) return;
    setCheckingOut(true);
    setCheckoutMsg("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ restaurantId, plan: planToBuy, billingCycle: cycle }),
      });
      const result = await res.json();
      if (!res.ok) { setCheckoutMsg(result.error ?? "Could not start checkout"); setCheckingOut(false); return; }
      window.location.href = result.redirectUrl;
    } catch {
      setCheckoutMsg("Network error — try again.");
      setCheckingOut(false);
    }
  }

  function cyclePrice(planKey: string, cycle: string) {
    const monthly = planPrices[planKey] ?? 0;
    const months = CYCLE_MONTHS[cycle] ?? 1;
    let amount = monthly * months;
    if (cycle === "annual") amount *= 0.9;
    return amount;
  }

  async function loadCheckins(branchId: string, range: "today" | "7d" | "30d" | "all" = checkinRange) {
    let query = supabase.from("staff_checkins").select("*").eq("branch_id", branchId).order("checked_in_at", { ascending: false });
    if (range !== "all") {
      const start = new Date();
      if (range === "today") start.setHours(0, 0, 0, 0);
      if (range === "7d") start.setDate(start.getDate() - 7);
      if (range === "30d") start.setDate(start.getDate() - 30);
      query = query.gte("checked_in_at", start.toISOString());
    }
    const { data } = await query;
    setCheckins(data ?? []);
  }
  async function loadRevenue(rid: string) {
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("order_items")
      .select("quantity, menu_items(price), orders!inner(restaurant_id, created_at)")
      .eq("orders.restaurant_id", rid)
      .gte("orders.created_at", startOfMonth.toISOString());
    const total = (data ?? []).reduce((sum: number, row: any) => sum + row.quantity * Number(row.menu_items?.price ?? 0), 0);
    setMonthlyRevenue(total);
  }
  async function loadCustomers(rid: string) {
    const { data } = await supabase.from("customers").select("id, name, phone, visit_count, loyalty_points, total_spent, last_visit").eq("restaurant_id", rid).order("last_visit", { ascending: false });
    setCustomers(data ?? []);
  }
  async function loadLoyaltyRule(rid: string) {
    const { data } = await supabase.from("loyalty_rules").select("*").eq("restaurant_id", rid).maybeSingle();
    if (data) setLoyaltyRule({
      points_per_bhd: String(data.points_per_bhd ?? 1),
      redeem_points_required: String(data.redeem_points_required ?? 30),
      redeem_reward_name: data.redeem_reward_name ?? "Free coffee",
    });
  }
  async function saveLoyaltyRule(e: React.FormEvent) {
    e.preventDefault();
    if (!restaurantId) return;
    setSavingRule(true);
    await supabase.from("loyalty_rules").upsert({
      restaurant_id: restaurantId,
      points_per_bhd: parseFloat(loyaltyRule.points_per_bhd) || 1,
      redeem_points_required: parseInt(loyaltyRule.redeem_points_required) || 30,
      redeem_reward_name: loyaltyRule.redeem_reward_name,
    }, { onConflict: "restaurant_id" });
    setSavingRule(false);
  }
  async function saveLease() {
    if (!activeBranchId) return;
    await supabase.from("branches").update({ lease_end_date: leaseEndDate || null }).eq("id", activeBranchId);
  }
  async function saveDefaultLanguage(lang: "en" | "ar") {
    if (!restaurantId) return;
    setDefaultLang(lang);
    await supabase.from("restaurants").update({ default_menu_language: lang }).eq("id", restaurantId);
  }
  async function saveWhatsappSettings() {
    if (!restaurantId) return;
    await supabase.from("restaurants").update({
      owner_whatsapp_number: whatsappNumber || null,
      whatsapp_digest_enabled: whatsappDigestEnabled,
    }).eq("id", restaurantId);
  }
  async function loadSold(branchId: string) {
    const { data } = await supabase
      .from("order_items")
      .select("menu_item_id, quantity, orders!inner(branch_id)")
      .eq("orders.branch_id", branchId);
    const map: Record<string, number> = {};
    (data ?? []).forEach((row: any) => {
      map[row.menu_item_id] = (map[row.menu_item_id] ?? 0) + row.quantity;
    });
    setSoldMap(map);
  }

  async function addMenuItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBranchId || !restaurantId || !newItem.name) return;
    await supabase.from("menu_items").insert({
      restaurant_id: restaurantId,
      branch_id: activeBranchId,
      name: newItem.name,
      name_ar: newItem.name_ar || null,
      description_en: newItem.description_en || null,
      description_ar: newItem.description_ar || null,
      ingredient_cost: parseFloat(newItem.ingredient_cost) || 0,
      labor_cost: parseFloat(newItem.labor_cost) || 0,
      rent_cost: parseFloat(newItem.rent_cost) || 0,
      price: parseFloat(newItem.price) || 0,
    });
    setNewItem({ name: "", name_ar: "", description_en: "", description_ar: "", ingredient_cost: "", labor_cost: "", rent_cost: "", price: "" });
    loadMenu(activeBranchId);
  }

  async function deleteMenuItem(id: string) {
    await supabase.from("menu_items").delete().eq("id", id);
    if (activeBranchId) loadMenu(activeBranchId);
  }

  function autoFillOverhead() {
    const rentM = parseFloat(costs.monthly_rent) || 0;
    const laborM = parseFloat(costs.monthly_labor) || 0;
    const units = parseFloat(costs.estimated_monthly_units) || 1;
    setNewItem({
      ...newItem,
      labor_cost: (laborM / units).toFixed(3),
      rent_cost: (rentM / units).toFixed(3),
    });
  }

  async function saveCosts(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBranchId) return;
    setSavingCosts(true);
    await supabase.from("branches").update({
      monthly_rent: parseFloat(costs.monthly_rent) || 0,
      monthly_labor: parseFloat(costs.monthly_labor) || 0,
      monthly_other: parseFloat(costs.monthly_other) || 0,
      monthly_profit_goal: parseFloat(costs.monthly_profit_goal) || 0,
      estimated_monthly_units: parseFloat(costs.estimated_monthly_units) || 0,
    }).eq("id", activeBranchId);
    setSavingCosts(false);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBranchId || !restaurantId || !newTask.trim()) return;
    await supabase.from("checklist_items").insert({ restaurant_id: restaurantId, branch_id: activeBranchId, task: newTask.trim() });
    setNewTask("");
    loadChecklist(activeBranchId);
  }

  async function toggleTask(id: string, done: boolean) {
    await supabase.from("checklist_items").update({ done: !done }).eq("id", id);
    if (activeBranchId) loadChecklist(activeBranchId);
  }

  // --- Ingredients ---
  async function addIngredient(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBranchId || !newIngredient.name) return;
    await supabase.from("ingredients").insert({
      branch_id: activeBranchId,
      name: newIngredient.name,
      unit: newIngredient.unit,
      quantity_on_hand: parseFloat(newIngredient.quantity_on_hand) || 0,
      low_stock_threshold: parseFloat(newIngredient.low_stock_threshold) || 0,
    });
    setNewIngredient({ name: "", unit: "g", quantity_on_hand: "", low_stock_threshold: "" });
    loadIngredients(activeBranchId);
  }
  async function deleteIngredient(id: string) {
    await supabase.from("ingredients").delete().eq("id", id);
    if (activeBranchId) loadIngredients(activeBranchId);
  }
  async function restock(id: string, currentQty: number) {
    const amount = parseFloat(restockAmount[id] || "0");
    if (!amount) return;
    const newQty = currentQty + amount;
    await supabase.from("ingredients").update({ quantity_on_hand: newQty }).eq("id", id);
    await supabase.from("stock_movements").insert({ ingredient_id: id, change_amount: amount, reason: "manual_restock" });
    setRestockAmount((prev) => ({ ...prev, [id]: "" }));
    if (activeBranchId) loadIngredients(activeBranchId);
  }
  async function linkIngredientToItem(menuItemId: string) {
    const link = linkIngredient[menuItemId];
    if (!link?.ingredientId || !link?.qty) return;
    await supabase.from("menu_item_ingredients").upsert({
      menu_item_id: menuItemId,
      ingredient_id: link.ingredientId,
      quantity_used: parseFloat(link.qty) || 0,
    }, { onConflict: "menu_item_id,ingredient_id" });
    setLinkIngredient((prev) => ({ ...prev, [menuItemId]: { ingredientId: "", qty: "" } }));
  }

  // --- QR tables ---
  async function addTable(e: React.FormEvent) {
    e.preventDefault();
    if (!activeBranchId || !newTableNumber.trim()) return;
    await supabase.from("branch_tables").insert({ branch_id: activeBranchId, table_number: newTableNumber.trim() });
    setNewTableNumber("");
    loadBranchTables(activeBranchId);
  }
  async function deactivateTable(id: string) {
    await supabase.from("branch_tables").update({ active: false }).eq("id", id);
    if (activeBranchId) loadBranchTables(activeBranchId);
  }
  async function regenerateTableToken(id: string) {
    // Simple client-side random token; RPC-free approach since gen_random_bytes
    // is only available inside Postgres. Generate 32 random bytes as hex here.
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    await supabase.from("branch_tables").update({ qr_token: token }).eq("id", id);
    if (activeBranchId) loadBranchTables(activeBranchId);
  }

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500 bg-[#f6f7f9]">Loading...</div>;
  }

  const trialExpired = restaurantStatus === "trial" && !!nextBillingDate && new Date(nextBillingDate) < new Date();
  const billingBlocked = restaurantStatus === "paused" || restaurantStatus === "overdue" || trialExpired;

  if (restaurantStatus === "cancelled" || billingBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f9] px-4">
        <div className="bg-white border border-neutral-200 rounded-2xl p-8 max-w-md text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <span className="text-xl">🔒</span>
          </div>
          <h1 className="text-lg font-semibold text-neutral-900 mb-2">
            {restaurantStatus === "cancelled" ? "Account cancelled" : trialExpired ? "Your trial has ended" : "Payment needed"}
          </h1>
          <p className="text-sm text-neutral-500 mb-5">
            {restaurantStatus === "cancelled"
              ? "This account has been cancelled and no longer has access. Please contact your platform administrator."
              : "Subscribe to a plan below to restore access to your dashboard."}
          </p>

          {restaurantStatus !== "cancelled" && (
            <div className="text-left">
              <label className="text-xs text-neutral-500 block mb-1">Plan</label>
              <select value={checkoutPlan} onChange={(e) => setCheckoutPlan(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-3">
                <option value="starter">Starter — BHD {(planPrices.starter ?? 15).toFixed(3)}/mo</option>
                <option value="growth">Growth — BHD {(planPrices.growth ?? 25).toFixed(3)}/mo</option>
                <option value="pro">Pro — BHD {(planPrices.pro ?? 35).toFixed(3)}/mo</option>
              </select>
              <label className="text-xs text-neutral-500 block mb-1">Billing cycle</label>
              <select value={checkoutCycle} onChange={(e) => setCheckoutCycle(e.target.value)} className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-sm mb-4">
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly (3 mo)</option>
                <option value="semiannual">Semi-annual (6 mo)</option>
                <option value="annual">Annual (12 mo) — 10% off</option>
              </select>
              <button
                onClick={() => startCheckout(checkoutPlan, checkoutCycle)}
                disabled={checkingOut}
                className="w-full bg-neutral-900 text-white text-sm rounded-lg py-2.5 disabled:opacity-50"
              >
                {checkingOut ? "Redirecting..." : `Pay BHD ${cyclePrice(checkoutPlan, checkoutCycle).toFixed(3)}`}
              </button>
              {checkoutMsg && <p className="text-xs text-neutral-500 mt-2 text-center">{checkoutMsg}</p>}
            </div>
          )}
        </div>
      </div>
    );
  }

  const rent = parseFloat(costs.monthly_rent) || 0;
  const labor = parseFloat(costs.monthly_labor) || 0;
  const other = parseFloat(costs.monthly_other) || 0;
  const profitGoal = parseFloat(costs.monthly_profit_goal) || 0;
  const breakEvenDaily = (rent + labor + other) / 30;
  const profitTargetDaily = (rent + labor + other + profitGoal) / 30;
  const overheadPerUnit = (rent + labor) / (parseFloat(costs.estimated_monthly_units) || 1);

  const itemStats = menuItems.map((m) => {
    const totalCost = Number(m.ingredient_cost) + Number(m.labor_cost) + Number(m.rent_cost);
    const margin = Number(m.price) - totalCost;
    const marginPct = m.price > 0 ? Math.round((margin / Number(m.price)) * 100) : 0;
    const unitsToBreakEvenAlone = margin > 0 ? Math.ceil(breakEvenDaily / margin) : null;
    const unitsToProfitAlone = margin > 0 ? Math.ceil(profitTargetDaily / margin) : null;
    const sold = soldMap[m.id] ?? 0;
    const profitGenerated = sold * margin;
    return { ...m, totalCost, margin, marginPct, unitsToBreakEvenAlone, unitsToProfitAlone, sold, profitGenerated };
  });

  const withSales = itemStats.filter((i) => i.sold > 0);
  const bestSeller = withSales.length ? withSales.reduce((a, b) => (b.sold > a.sold ? b : a)) : null;
  const worstSeller = withSales.length > 1 ? withSales.reduce((a, b) => (b.sold < a.sold ? b : a)) : null;

  const lowStockIngredients = ingredients.filter((i) => i.quantity_on_hand <= i.low_stock_threshold);

  const card = "bg-white border border-neutral-200 rounded-xl shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
  const input = "border border-neutral-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-neutral-900";
  const daysLeftLease = leaseEndDate ? Math.ceil((new Date(leaseEndDate).getTime() - Date.now()) / 86400000) : null;

  const navItems: { key: Tab; label: string; ownerOnly?: boolean; proOnly?: boolean }[] = [
    { key: "overview", label: "Overview", ownerOnly: true },
    { key: "menu", label: "Menu" },
    { key: "ingredients", label: "Stock" },
    { key: "checklist", label: "Checklist" },
    { key: "staff", label: "Staff access" },
    { key: "qr", label: "QR tables", proOnly: true },
    { key: "customers", label: "Customers & loyalty" },
    { key: "checkins", label: "Check-in history" },
    { key: "team", label: "Team", ownerOnly: true },
    { key: "branches", label: "Branches", ownerOnly: true, proOnly: true },
    { key: "billing", label: "Billing", ownerOnly: true },
  ];
  const visibleNav = navItems.filter((n) => (!n.ownerOnly || myRole === "owner") && (!n.proOnly || planLimits?.qr_ordering));

  return (
    <div className="min-h-screen bg-[#f6f7f9] flex">
      <aside className="w-56 bg-white border-r border-neutral-200 px-4 py-6 hidden sm:block">
        <p className="text-sm font-semibold text-neutral-900 mb-1 truncate">{restaurantName}</p>
        <p className="text-xs text-neutral-400 mb-3 capitalize">{myRole} · {plan}</p>

        {branches.length > 1 && (
          <select
            value={activeBranchId ?? ""}
            onChange={(e) => switchBranch(e.target.value)}
            className="w-full text-xs border border-neutral-300 rounded-lg px-2 py-1.5 mb-4"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        )}

        {lowStockIngredients.length > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-lg px-2 py-2 mb-4">
            <p className="text-xs text-amber-800 font-medium">⚠ {lowStockIngredients.length} low stock</p>
          </div>
        )}

        <nav className="space-y-1">
          {visibleNav.map((n) => (
            <button
              key={n.key}
              onClick={() => setActiveTab(n.key)}
              className={`w-full text-left text-sm px-3 py-2 rounded-lg ${activeTab === n.key ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}
            >
              {n.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-neutral-200 flex overflow-x-auto z-10">
        {visibleNav.map((n) => (
          <button
            key={n.key}
            onClick={() => setActiveTab(n.key)}
            className={`flex-1 text-xs px-2 py-3 whitespace-nowrap ${activeTab === n.key ? "text-neutral-900 font-medium border-t-2 border-neutral-900" : "text-neutral-400"}`}
          >
            {n.label}
          </button>
        ))}
      </div>

      <main className="flex-1 px-6 py-8 pb-20 sm:pb-8 max-w-3xl">
        {daysLeftLease !== null && daysLeftLease <= 180 && (
          <div className={`rounded-lg px-4 py-3 text-sm mb-6 flex items-center gap-2 ${daysLeftLease <= 60 ? "bg-red-50 text-red-700 border border-red-100" : "bg-amber-50 text-amber-700 border border-amber-100"}`}>
            <span>🔔</span>
            <span>
              {daysLeftLease > 0
                ? `Lease renewal: ~${Math.round(daysLeftLease / 30)} month${Math.round(daysLeftLease / 30) === 1 ? "" : "s"} left (${daysLeftLease} days).`
                : "Lease end date has passed — update it once renewed."}
            </span>
          </div>
        )}

        {activeTab === "overview" && myRole === "owner" && (
          <>
            <section className="mb-8">
              <h2 className="text-sm font-medium text-neutral-900 mb-1">Fixed costs & daily target — {branches.find(b => b.id === activeBranchId)?.name}</h2>
              <p className="text-xs text-neutral-500 mb-3">These numbers power the automatic cost allocation in Menu. Each branch has its own.</p>
              <form onSubmit={saveCosts} className={`${card} p-4`}>
                <div className="grid grid-cols-5 gap-2 mb-4">
                  <div><label className="text-xs text-neutral-500 block mb-1">Monthly rent</label>
                    <input type="number" className={`${input} w-full`} value={costs.monthly_rent} onChange={(e) => setCosts({ ...costs, monthly_rent: e.target.value })} /></div>
                  <div><label className="text-xs text-neutral-500 block mb-1">Monthly labor</label>
                    <input type="number" className={`${input} w-full`} value={costs.monthly_labor} onChange={(e) => setCosts({ ...costs, monthly_labor: e.target.value })} /></div>
                  <div><label className="text-xs text-neutral-500 block mb-1">Other (utilities etc)</label>
                    <input type="number" className={`${input} w-full`} value={costs.monthly_other} onChange={(e) => setCosts({ ...costs, monthly_other: e.target.value })} /></div>
                  <div><label className="text-xs text-neutral-500 block mb-1">Profit goal / mo</label>
                    <input type="number" className={`${input} w-full`} value={costs.monthly_profit_goal} onChange={(e) => setCosts({ ...costs, monthly_profit_goal: e.target.value })} /></div>
                  <div><label className="text-xs text-neutral-500 block mb-1">Est. items sold / mo</label>
                    <input type="number" className={`${input} w-full`} value={costs.estimated_monthly_units} onChange={(e) => setCosts({ ...costs, estimated_monthly_units: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-neutral-100 mb-3">
                  <div className="bg-neutral-50 rounded-lg p-3">
                    <p className="text-xs text-neutral-500 mb-1">Needed daily to avoid loss</p>
                    <p className="text-lg font-semibold text-neutral-900">BHD {breakEvenDaily.toFixed(2)}</p>
                  </div>
                  <div className="bg-neutral-50 rounded-lg p-3">
                    <p className="text-xs text-neutral-500 mb-1">Needed daily for profit goal</p>
                    <p className="text-lg font-semibold text-green-700">BHD {profitTargetDaily.toFixed(2)}</p>
                  </div>
                  <div className="bg-neutral-50 rounded-lg p-3">
                    <p className="text-xs text-neutral-500 mb-1">Suggested overhead / item</p>
                    <p className="text-lg font-semibold text-neutral-900">BHD {overheadPerUnit.toFixed(3)}</p>
                  </div>
                </div>
                <button disabled={savingCosts} className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2 disabled:opacity-50">
                  {savingCosts ? "Saving..." : "Save"}
                </button>
              </form>
            </section>

            <section className="mb-8">
              <h2 className="text-sm font-medium text-neutral-900 mb-1">Lease renewal — this branch</h2>
              <p className="text-xs text-neutral-500 mb-3">Set your lease end date to get an early warning before it expires.</p>
              <div className={`${card} p-4`}>
                <label className="text-xs text-neutral-500 block mb-1">Lease end date</label>
                <input type="date" className={`${input} w-48`} value={leaseEndDate} onChange={(e) => setLeaseEndDate(e.target.value)} onBlur={saveLease} />
              </div>
            </section>

            <section className="mb-8">
              <h2 className="text-sm font-medium text-neutral-900 mb-1">Menu language</h2>
              <p className="text-xs text-neutral-500 mb-3">Default language shown on the QR ordering menu. Customers can still switch.</p>
              <div className={`${card} p-4 flex gap-2`}>
                <button onClick={() => saveDefaultLanguage("en")} className={`text-sm px-4 py-2 rounded-lg ${defaultLang === "en" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>English</button>
                <button onClick={() => saveDefaultLanguage("ar")} className={`text-sm px-4 py-2 rounded-lg ${defaultLang === "ar" ? "bg-neutral-900 text-white" : "border border-neutral-300"}`}>العربية</button>
              </div>
            </section>

            <section>
              <h2 className="text-sm font-medium text-neutral-900 mb-1">VAT</h2>
              <p className="text-xs text-neutral-500 mb-3">Customers pay 10% VAT on top of your prices at checkout. This is what you owe based on real sales so far this month, across all branches.</p>
              <div className={`${card} p-4`}>
                <p className="text-xs text-neutral-500 mb-1">VAT collected this month</p>
                <p className="text-lg font-semibold text-neutral-900">BHD {(monthlyRevenue * 0.10).toFixed(2)}</p>
                <p className="text-xs text-neutral-400 mt-1">Based on BHD {monthlyRevenue.toFixed(2)} in sales (before VAT) recorded this month.</p>
              </div>
            </section>

            {planLimits?.whatsapp_digest && (
              <section className="mt-8">
                <h2 className="text-sm font-medium text-neutral-900 mb-1">WhatsApp daily digest</h2>
                <p className="text-xs text-neutral-500 mb-3">Get a daily P&amp;L summary sent to your WhatsApp — no need to log in.</p>
                <div className={`${card} p-4`}>
                  <label className="text-xs text-neutral-500 block mb-1">Your WhatsApp number</label>
                  <input type="tel" placeholder="+973 ..." className={`${input} w-48`} value={whatsappNumber} onChange={(e) => setWhatsappNumber(e.target.value)} onBlur={saveWhatsappSettings} />
                  <label className="flex items-center gap-2 text-xs text-neutral-600 mt-3">
                    <input type="checkbox" checked={whatsappDigestEnabled} onChange={(e) => { setWhatsappDigestEnabled(e.target.checked); saveWhatsappSettings(); }} />
                    Send me a daily digest
                  </label>
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === "branches" && myRole === "owner" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Branches</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Your first branch is included in your plan. Additional branches are billed separately — contact your platform administrator to activate billing for a new branch.
            </p>
            <form onSubmit={addBranch} className={`${card} p-4 mb-3 flex gap-2`}>
              <input placeholder="New branch name (e.g. Seef Mall)" className={`${input} flex-1`} value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} />
              <button disabled={addingBranch} className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2 disabled:opacity-50">
                {addingBranch ? "Adding..." : "+ Add branch"}
              </button>
            </form>
            {branchLimitMsg && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">{branchLimitMsg}</p>}
            {planLimits && <p className="text-xs text-neutral-400 mb-3">{branches.length} of {planLimits.max_branches} branches used on your {plan} plan.</p>}
            <div className="grid grid-cols-2 gap-3">
              {branches.map((b) => (
                <div key={b.id} className={`${card} p-4`}>
                  <div className="flex justify-between items-start mb-1">
                    <p className="text-sm font-medium">{b.name}</p>
                    {b.is_primary && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Included</span>}
                    {!b.is_primary && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Billed separately</span>}
                  </div>
                  {b.address && <p className="text-xs text-neutral-500">{b.address}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "menu" && (
          <section>
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-sm font-medium text-neutral-900">Menu items & profitability</h2>
              <button onClick={() => setShowArabicFields((s) => !s)} className="text-xs text-neutral-500 underline">
                {showArabicFields ? "Hide" : "Add"} Arabic fields
              </button>
            </div>
            <p className="text-xs text-neutral-500 mb-3">Enter what an item costs to make. Use &ldquo;Auto-fill overhead&rdquo; to add a fair share of rent and labour on top automatically.</p>
            <form onSubmit={addMenuItem} className={`${card} p-4 mb-3`}>
              <div className="grid grid-cols-5 gap-2 mb-2">
                <input placeholder="Item name (English)" className={`${input} col-span-2`} value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
                <input placeholder="Ingredients (BHD)" type="number" step="0.001" className={input} value={newItem.ingredient_cost} onChange={(e) => setNewItem({ ...newItem, ingredient_cost: e.target.value })} />
                <input placeholder="Labor (BHD)" type="number" step="0.001" className={input} value={newItem.labor_cost} onChange={(e) => setNewItem({ ...newItem, labor_cost: e.target.value })} />
                <input placeholder="Rent share (BHD)" type="number" step="0.001" className={input} value={newItem.rent_cost} onChange={(e) => setNewItem({ ...newItem, rent_cost: e.target.value })} />
              </div>
              {showArabicFields && (
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input placeholder="اسم الصنف (Arabic name)" dir="rtl" className={input} value={newItem.name_ar} onChange={(e) => setNewItem({ ...newItem, name_ar: e.target.value })} />
                  <input placeholder="الوصف (Arabic description)" dir="rtl" className={input} value={newItem.description_ar} onChange={(e) => setNewItem({ ...newItem, description_ar: e.target.value })} />
                </div>
              )}
              <div className="flex gap-2 items-center">
                <input placeholder="Selling price (BHD)" type="number" step="0.001" className={`${input} w-40`} value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} />
                <button type="button" onClick={autoFillOverhead} className="text-xs border border-neutral-300 rounded-lg px-3 py-2">Auto-fill overhead</button>
                <button className="ml-auto bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">+ Add item</button>
              </div>
            </form>

            {(bestSeller || worstSeller) && (
              <div className="grid grid-cols-2 gap-3 mb-3">
                {bestSeller && (
                  <div className="bg-green-50 border border-green-100 rounded-xl p-3">
                    <p className="text-xs text-green-700 mb-1">Best seller</p>
                    <p className="text-sm font-semibold text-green-900">{bestSeller.name} — {bestSeller.sold} sold</p>
                  </div>
                )}
                {worstSeller && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                    <p className="text-xs text-amber-700 mb-1">Slowest seller</p>
                    <p className="text-sm font-semibold text-amber-900">{worstSeller.name} — {worstSeller.sold} sold</p>
                  </div>
                )}
              </div>
            )}

            <div className={`${card} overflow-x-auto`}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left whitespace-nowrap">
                  <th className="px-3 py-2 font-normal">Item</th>
                  <th className="px-3 py-2 font-normal text-right">Cost</th>
                  <th className="px-3 py-2 font-normal text-right">Price</th>
                  <th className="px-3 py-2 font-normal text-right">Margin</th>
                  {plan === "pro" && <th className="px-3 py-2 font-normal text-right">To break even</th>}
                  {plan === "pro" && <th className="px-3 py-2 font-normal text-right">To profit goal</th>}
                  <th className="px-3 py-2 font-normal text-right">Sold</th>
                  <th className="px-3 py-2 font-normal text-right">Profit made</th>
                  <th className="px-3 py-2 font-normal"></th>
                </tr></thead>
                <tbody>
                  {itemStats.map((m) => (
                    <tr key={m.id} className="border-b last:border-0 border-neutral-100 whitespace-nowrap">
                      <td className="px-3 py-2">{m.name}{m.name_ar && <span className="text-neutral-400 text-xs block" dir="rtl">{m.name_ar}</span>}</td>
                      <td className="px-3 py-2 text-right">BHD {m.totalCost.toFixed(3)}</td>
                      <td className="px-3 py-2 text-right">BHD {Number(m.price).toFixed(3)}</td>
                      <td className={`px-3 py-2 text-right ${m.marginPct >= 50 ? "text-green-600" : m.marginPct >= 0 ? "text-amber-600" : "text-red-600"}`}>
                        {m.marginPct}% (BHD {m.margin.toFixed(3)})
                      </td>
                      {plan === "pro" && <td className="px-3 py-2 text-right">{m.unitsToBreakEvenAlone ?? "—"}</td>}
                      {plan === "pro" && <td className="px-3 py-2 text-right">{m.unitsToProfitAlone ?? "—"}</td>}
                      <td className="px-3 py-2 text-right">{m.sold}</td>
                      <td className="px-3 py-2 text-right">BHD {m.profitGenerated.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right"><button onClick={() => deleteMenuItem(m.id)} className="text-neutral-400 hover:text-red-600">✕</button></td>
                    </tr>
                  ))}
                  {itemStats.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-center text-neutral-400">No menu items yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "ingredients" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Ingredient stock</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Track raw ingredient quantities. Link an ingredient to a menu item below to auto-deduct stock every time that item sells.
            </p>

            {lowStockIngredients.length > 0 && (
              <div className="bg-red-50 border border-red-100 rounded-xl p-3 mb-3">
                <p className="text-xs font-medium text-red-800 mb-1">⚠ Low stock</p>
                {lowStockIngredients.map((i) => (
                  <p key={i.id} className="text-sm text-red-900">{i.name}: {i.quantity_on_hand} {i.unit} left (threshold {i.low_stock_threshold})</p>
                ))}
              </div>
            )}

            <form onSubmit={addIngredient} className={`${card} p-4 mb-3 grid grid-cols-4 gap-2 items-end`}>
              <div className="col-span-2">
                <label className="text-xs text-neutral-500 block mb-1">Ingredient name</label>
                <input className={`${input} w-full`} value={newIngredient.name} onChange={(e) => setNewIngredient({ ...newIngredient, name: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Unit</label>
                <select className={`${input} w-full`} value={newIngredient.unit} onChange={(e) => setNewIngredient({ ...newIngredient, unit: e.target.value })}>
                  <option value="g">grams</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">liters</option>
                  <option value="unit">units</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-neutral-500 block mb-1">Starting qty</label>
                <input type="number" className={`${input} w-full`} value={newIngredient.quantity_on_hand} onChange={(e) => setNewIngredient({ ...newIngredient, quantity_on_hand: e.target.value })} />
              </div>
              <div className="col-span-3">
                <label className="text-xs text-neutral-500 block mb-1">Low stock alert threshold</label>
                <input type="number" className={`${input} w-full`} value={newIngredient.low_stock_threshold} onChange={(e) => setNewIngredient({ ...newIngredient, low_stock_threshold: e.target.value })} />
              </div>
              <button className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">+ Add</button>
            </form>

            <div className={`${card} overflow-hidden mb-6`}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left">
                  <th className="px-4 py-2 font-normal">Ingredient</th>
                  <th className="px-4 py-2 font-normal text-right">On hand</th>
                  <th className="px-4 py-2 font-normal text-right">Threshold</th>
                  {plan === "pro" && <th className="px-4 py-2 font-normal text-right">Runs out in</th>}
                  <th className="px-4 py-2 font-normal text-right">Restock</th>
                  <th className="px-4 py-2 font-normal"></th>
                </tr></thead>
                <tbody>
                  {ingredients.map((i) => {
                    const f = forecast[i.id];
                    return (
                    <tr key={i.id} className={`border-b last:border-0 border-neutral-100 ${i.quantity_on_hand <= i.low_stock_threshold ? "bg-red-50" : ""}`}>
                      <td className="px-4 py-2">{i.name}</td>
                      <td className="px-4 py-2 text-right">{i.quantity_on_hand} {i.unit}</td>
                      <td className="px-4 py-2 text-right text-neutral-500">{i.low_stock_threshold} {i.unit}</td>
                      {plan === "pro" && (
                        <td className={`px-4 py-2 text-right ${f?.estimated_days_remaining !== null && f?.estimated_days_remaining !== undefined && f.estimated_days_remaining <= 3 ? "text-red-600 font-medium" : "text-neutral-500"}`}>
                          {f?.estimated_days_remaining !== null && f?.estimated_days_remaining !== undefined ? `~${f.estimated_days_remaining}d` : "—"}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <input type="number" placeholder="0" className="border border-neutral-300 rounded-md px-2 py-1 text-xs w-16"
                            value={restockAmount[i.id] || ""} onChange={(e) => setRestockAmount((prev) => ({ ...prev, [i.id]: e.target.value }))} />
                          <button onClick={() => restock(i.id, i.quantity_on_hand)} className="text-xs border border-neutral-300 rounded-md px-2 py-1">+ Add</button>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-right"><button onClick={() => deleteIngredient(i.id)} className="text-neutral-400 hover:text-red-600">✕</button></td>
                    </tr>
                    );
                  })}
                  {ingredients.length === 0 && <tr><td colSpan={6} className="px-4 py-4 text-center text-neutral-400">No ingredients tracked yet.</td></tr>}
                </tbody>
              </table>
            </div>

            <h3 className="text-sm font-medium text-neutral-900 mb-1">Link ingredients to menu items</h3>
            <p className="text-xs text-neutral-500 mb-3">Set how much of an ingredient is used per one unit sold, so stock deducts automatically on each order.</p>
            <div className="space-y-2">
              {menuItems.map((m) => (
                <div key={m.id} className={`${card} p-3 flex items-center gap-2`}>
                  <span className="text-sm flex-1">{m.name}</span>
                  <select className="border border-neutral-300 rounded-md px-2 py-1 text-xs w-32"
                    value={linkIngredient[m.id]?.ingredientId || ""}
                    onChange={(e) => setLinkIngredient((prev) => ({ ...prev, [m.id]: { ingredientId: e.target.value, qty: prev[m.id]?.qty || "" } }))}>
                    <option value="">Ingredient...</option>
                    {ingredients.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" placeholder="Qty used" className="border border-neutral-300 rounded-md px-2 py-1 text-xs w-24"
                    value={linkIngredient[m.id]?.qty || ""}
                    onChange={(e) => setLinkIngredient((prev) => ({ ...prev, [m.id]: { ingredientId: prev[m.id]?.ingredientId || "", qty: e.target.value } }))} />
                  <button onClick={() => linkIngredientToItem(m.id)} className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1">Link</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "qr" && planLimits?.qr_ordering && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">QR table ordering</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Each table gets a unique QR code. Customers scan it to view your menu and order directly — no waiter needed. Print the link below as a QR code and place it on the table.
            </p>
            <form onSubmit={addTable} className={`${card} p-4 mb-3 flex gap-2`}>
              <input placeholder="Table number (e.g. 12)" className={`${input} flex-1`} value={newTableNumber} onChange={(e) => setNewTableNumber(e.target.value)} />
              <button className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">+ Add table</button>
            </form>
            <div className="grid grid-cols-2 gap-3">
              {branchTables.map((t) => {
                const url = `${typeof window !== "undefined" ? window.location.origin : ""}/order/${t.qr_token}`;
                return (
                  <div key={t.id} className={`${card} p-4`}>
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-medium">Table {t.table_number}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${t.active ? "bg-green-100 text-green-700" : "bg-neutral-200 text-neutral-500"}`}>
                        {t.active ? "active" : "inactive"}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-400 mb-3 truncate">{url}</p>
                    <div className="flex gap-2">
                      <button onClick={() => navigator.clipboard.writeText(url)} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Copy link</button>
                      <button onClick={() => regenerateTableToken(t.id)} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Regenerate</button>
                      {t.active && <button onClick={() => deactivateTable(t.id)} className="text-xs text-red-600 border border-red-200 rounded-lg px-3 py-1.5">Deactivate</button>}
                    </div>
                  </div>
                );
              })}
              {branchTables.length === 0 && <p className="text-sm text-neutral-400 col-span-2">No tables yet — add one above.</p>}
            </div>
          </section>
        )}

        {activeTab === "checklist" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Checklist</h2>
            <p className="text-xs text-neutral-500 mb-3">Daily tasks for this branch.</p>
            <div className={`${card} p-4`}>
              {checklist.map((t) => (
                <label key={t.id} className="flex items-center gap-2 py-1.5 text-sm cursor-pointer">
                  <input type="checkbox" checked={t.done} onChange={() => toggleTask(t.id, t.done)} className="w-4 h-4" />
                  <span className={t.done ? "line-through text-neutral-400" : "text-neutral-800"}>{t.task}</span>
                </label>
              ))}
              <form onSubmit={addTask} className="flex gap-2 mt-3">
                <input placeholder="Add a task" className={`${input} flex-1`} value={newTask} onChange={(e) => setNewTask(e.target.value)} />
                <button className="bg-neutral-900 text-white text-sm rounded-lg px-3 py-2">Add</button>
              </form>
            </div>
          </section>
        )}

        {activeTab === "staff" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Staff access — this branch</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Open the link on the device, bookmark it, then enter the PIN.
              {plan === "starter" && " Starter plan: up to 1 kitchen + 2 waiter codes."}
            </p>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => addStaffCode("waiter")}
                disabled={plan === "starter" && staffCodes.filter((s) => s.role === "waiter").length >= 2}
                className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                + Add waiter code
              </button>
              <button
                onClick={() => addStaffCode("kitchen")}
                disabled={plan === "starter" && staffCodes.filter((s) => s.role === "kitchen").length >= 1}
                className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                + Add kitchen code
              </button>
              <button
                onClick={() => addStaffCode("barista")}
                disabled={plan === "starter" && staffCodes.filter((s) => s.role === "barista").length >= 2}
                className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5 disabled:opacity-40"
              >
                + Add barista code
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {staffCodes.map((s) => {
                const routeSegment = s.role === "waiter" ? "w" : s.role === "kitchen" ? "k" : "b";
                const url = `${typeof window !== "undefined" ? window.location.origin : ""}/${routeSegment}/${s.url_token}`;
                return (
                  <div key={s.id} className={`${card} p-4`}>
                    <div className="flex justify-between items-start mb-2">
                      <p className="text-sm font-medium">{s.label || `${s.role} access`}</p>
                      <button onClick={() => deleteStaffCode(s.id)} className="text-xs text-neutral-400 hover:text-red-600">✕</button>
                    </div>
                    <p className="text-2xl font-semibold tracking-widest mb-2">{s.pin}</p>
                    <p className="text-xs text-neutral-400 mb-3 truncate">{url}</p>
                    <div className="flex gap-2">
                      <button onClick={() => navigator.clipboard.writeText(url)} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Copy link</button>
                      <button onClick={() => regenerateCode(s.id)} className="text-xs border border-neutral-300 rounded-lg px-3 py-1.5">Regenerate</button>
                    </div>
                  </div>
                );
              })}
              {staffCodes.length === 0 && <p className="text-sm text-neutral-400 col-span-2">No staff codes yet — add one above.</p>}
            </div>
          </section>
        )}

        {activeTab === "customers" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Customers & loyalty</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Your customer list belongs 100% to you — never sold or shared. Shared across all branches.
              {plan === "starter" && " Directory only on Starter — upgrade to Growth for automatic points."}
            </p>

            {plan !== "starter" && (
              <form onSubmit={saveLoyaltyRule} className={`${card} p-4 mb-3 flex flex-wrap gap-3 items-end`}>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Points per BHD spent</label>
                  <input type="number" step="0.1" className={`${input} w-28`} value={loyaltyRule.points_per_bhd} onChange={(e) => setLoyaltyRule({ ...loyaltyRule, points_per_bhd: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Points to redeem</label>
                  <input type="number" className={`${input} w-28`} value={loyaltyRule.redeem_points_required} onChange={(e) => setLoyaltyRule({ ...loyaltyRule, redeem_points_required: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Reward</label>
                  <input type="text" className={`${input} w-40`} value={loyaltyRule.redeem_reward_name} onChange={(e) => setLoyaltyRule({ ...loyaltyRule, redeem_reward_name: e.target.value })} />
                </div>
                <button disabled={savingRule} className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">{savingRule ? "Saving..." : "Save rule"}</button>
              </form>
            )}

            {plan === "pro" && (() => {
              const vip = [...customers].sort((a, b) => Number(b.total_spent) - Number(a.total_spent)).slice(0, 3).filter(c => Number(c.total_spent) > 0);
              const lost = customers.filter(c => (Date.now() - new Date(c.last_visit).getTime()) / 86400000 > 30);
              return (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  {vip.length > 0 && (
                    <div className="bg-purple-50 border border-purple-100 rounded-xl p-3">
                      <p className="text-xs text-purple-700 mb-1">VIP / top spenders</p>
                      {vip.map(c => <p key={c.id} className="text-sm text-purple-900">{c.name} — BHD {Number(c.total_spent).toFixed(2)}</p>)}
                    </div>
                  )}
                  {lost.length > 0 && (
                    <div className="bg-neutral-100 border border-neutral-200 rounded-xl p-3">
                      <p className="text-xs text-neutral-600 mb-1">Lost customers (30+ days)</p>
                      {lost.slice(0, 3).map(c => <p key={c.id} className="text-sm text-neutral-700">{c.name}</p>)}
                    </div>
                  )}
                </div>
              );
            })()}

            <div className={`${card} overflow-hidden`}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left">
                  <th className="px-4 py-2 font-normal">Name</th><th className="px-4 py-2 font-normal">Phone</th>
                  <th className="px-4 py-2 font-normal text-right">Visits</th>
                  {plan !== "starter" && <th className="px-4 py-2 font-normal text-right">Points</th>}
                  {plan !== "starter" && <th className="px-4 py-2 font-normal text-right">Total spent</th>}
                </tr></thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 border-neutral-100">
                      <td className="px-4 py-2">{c.name}</td>
                      <td className="px-4 py-2 text-neutral-500">{c.phone}</td>
                      <td className="px-4 py-2 text-right">{c.visit_count}</td>
                      {plan !== "starter" && <td className="px-4 py-2 text-right">{c.loyalty_points}</td>}
                      {plan !== "starter" && <td className="px-4 py-2 text-right">BHD {Number(c.total_spent).toFixed(2)}</td>}
                    </tr>
                  ))}
                  {customers.length === 0 && <tr><td colSpan={5} className="px-4 py-4 text-center text-neutral-400">No customers yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "checkins" && (
          <section>
            <div className="flex justify-between items-center mb-1">
              <h2 className="text-sm font-medium text-neutral-900">Check-in history — this branch</h2>
              <select
                className="text-xs border border-neutral-300 rounded-lg px-2 py-1"
                value={checkinRange}
                onChange={(e) => {
                  const r = e.target.value as "today" | "7d" | "30d" | "all";
                  setCheckinRange(r);
                  if (activeBranchId) loadCheckins(activeBranchId, r);
                }}
              >
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="all">All time</option>
              </select>
            </div>
            <p className="text-xs text-neutral-500 mb-3">Logged automatically when staff open the waiter or kitchen app.</p>
            <div className={`${card} overflow-hidden`}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left">
                  <th className="px-4 py-2 font-normal">Name</th><th className="px-4 py-2 font-normal">Role</th>
                  <th className="px-4 py-2 font-normal">Checked in</th><th className="px-4 py-2 font-normal">Checked out</th>
                </tr></thead>
                <tbody>
                  {checkins.map((c) => (
                    <tr key={c.id} className="border-b last:border-0 border-neutral-100">
                      <td className="px-4 py-2">{c.staff_name}</td>
                      <td className="px-4 py-2 capitalize text-neutral-500">{c.role}</td>
                      <td className="px-4 py-2">{new Date(c.checked_in_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="px-4 py-2">{c.checked_out_at ? new Date(c.checked_out_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  ))}
                  {checkins.length === 0 && <tr><td colSpan={4} className="px-4 py-4 text-center text-neutral-400">No check-ins yet in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === "billing" && myRole === "owner" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Billing</h2>
            <p className="text-xs text-neutral-500 mb-3">
              Current plan: <span className="font-medium capitalize">{plan}</span>
              {billingCycle && billingCycle !== "trial" && <> · {CYCLE_LABEL[billingCycle] ?? billingCycle}</>}
              {nextBillingDate && <> · next billing {nextBillingDate}</>}
              {restaurantStatus === "trial" && nextBillingDate && <> · trial ends {nextBillingDate}</>}
            </p>
            <div className={`${card} p-4`}>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Plan</label>
                  <select value={checkoutPlan} onChange={(e) => setCheckoutPlan(e.target.value)} className={`${input} w-full`}>
                    <option value="starter">Starter — BHD {(planPrices.starter ?? 15).toFixed(3)}/mo</option>
                    <option value="growth">Growth — BHD {(planPrices.growth ?? 25).toFixed(3)}/mo</option>
                    <option value="pro">Pro — BHD {(planPrices.pro ?? 35).toFixed(3)}/mo</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-neutral-500 block mb-1">Billing cycle</label>
                  <select value={checkoutCycle} onChange={(e) => setCheckoutCycle(e.target.value)} className={`${input} w-full`}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly (3 mo)</option>
                    <option value="semiannual">Semi-annual (6 mo)</option>
                    <option value="annual">Annual (12 mo) — 10% off</option>
                  </select>
                </div>
              </div>
              <button
                onClick={() => startCheckout(checkoutPlan, checkoutCycle)}
                disabled={checkingOut}
                className="bg-neutral-900 text-white text-sm rounded-lg px-4 py-2 disabled:opacity-50"
              >
                {checkingOut ? "Redirecting..." : `Pay BHD ${cyclePrice(checkoutPlan, checkoutCycle).toFixed(3)}`}
              </button>
              {checkoutMsg && <p className="text-xs text-neutral-500 mt-2">{checkoutMsg}</p>}
            </div>
          </section>
        )}

        {activeTab === "team" && myRole === "owner" && (
          <section>
            <h2 className="text-sm font-medium text-neutral-900 mb-1">Team</h2>
            <p className="text-xs text-neutral-500 mb-3">Managers can run day-to-day operations but can&rsquo;t see billing, costs, or add other managers.</p>
            <form onSubmit={addManager} className={`${card} p-4 mb-3 grid grid-cols-3 gap-2`}>
              <input placeholder="Name" className={input} value={newManager.name} onChange={(e) => setNewManager({ ...newManager, name: e.target.value })} />
              <input placeholder="Email" type="email" className={input} value={newManager.email} onChange={(e) => setNewManager({ ...newManager, email: e.target.value })} />
              <input type="password" autoComplete="new-password" placeholder="Password" className={input} value={newManager.password} onChange={(e) => setNewManager({ ...newManager, password: e.target.value })} />
              <button disabled={addingManager} className="col-span-3 bg-neutral-900 text-white text-sm rounded-lg px-4 py-2">{addingManager ? "Adding..." : "+ Add manager"}</button>
              {managerMsg && <p className="col-span-3 text-xs text-neutral-500">{managerMsg}</p>}
            </form>
            <div className={`${card} overflow-hidden`}>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-neutral-200 text-neutral-500 text-left">
                  <th className="px-4 py-2 font-normal">Name</th><th className="px-4 py-2 font-normal">Email</th><th className="px-4 py-2 font-normal">Role</th>
                </tr></thead>
                <tbody>
                  {team.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 border-neutral-100">
                      <td className="px-4 py-2">{t.full_name || "—"}</td>
                      <td className="px-4 py-2 text-neutral-500">{t.email || "—"}</td>
                      <td className="px-4 py-2 capitalize">{t.role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
