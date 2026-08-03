import { createClient } from "jsr:@supabase/supabase-js@2";

// Creates a real payment charge for a restaurant's subscription via Tap Payments.
// Requires verify_jwt = true: only an authenticated super_admin can trigger a charge.
// This function does NOT auto-charge on a schedule -- it's a manual "charge this
// restaurant now" action from the admin dashboard. Recurring billing automation
// is a separate, larger piece (webhook handling + scheduled job) not built here.
//
// This is deliberately inert until real provider keys exist: if platform_settings
// has no live/test secret key configured, it returns a clear error rather than
// silently failing or faking success.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // verify_jwt=true means Supabase already validated the caller has a session;
    // we still re-check the role server-side rather than trusting the client.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: cors });

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData.user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: cors });

    const { data: profile } = await admin.from("profiles").select("role").eq("id", userData.user.id).single();
    if (profile?.role !== "super_admin") {
      return new Response(JSON.stringify({ error: "Only platform admins can create charges" }), { status: 403, headers: cors });
    }

    const body = await req.json();
    const { restaurantId, amount, billingCycle } = body;
    if (!restaurantId || !amount) {
      return new Response(JSON.stringify({ error: "Missing restaurantId or amount" }), { status: 400, headers: cors });
    }

    const { data: settings } = await admin.from("platform_settings").select("*").limit(1).maybeSingle();
    if (!settings) {
      return new Response(JSON.stringify({ error: "Payment provider not configured yet." }), { status: 400, headers: cors });
    }

    const secretKey = settings.mode === "live" ? settings.live_secret_key : settings.test_secret_key;
    if (!secretKey) {
      return new Response(
        JSON.stringify({ error: `No ${settings.mode} secret key configured. Add one in Payment API settings before charging.` }),
        { status: 400, headers: cors }
      );
    }

    const { data: restaurant } = await admin.from("restaurants").select("name, owner_phone").eq("id", restaurantId).single();
    if (!restaurant) return new Response(JSON.stringify({ error: "Restaurant not found" }), { status: 404, headers: cors });

    // Tap Payments charge creation. Amount in BHD, Tap expects the currency's
    // smallest unit handling internally -- BHD uses 3 decimal places, which Tap's
    // API accepts as a decimal amount directly (not multiplied like 2-decimal currencies).
    const tapRes = await fetch("https://api.tap.company/v2/charges", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Number(amount),
        currency: "BHD",
        customer_initiated: true,
        threeDSecure: true,
        save_card: false,
        description: `Subscription charge — ${restaurant.name}`,
        metadata: { restaurant_id: restaurantId, billing_cycle: billingCycle ?? null },
        reference: { transaction: `sub_${restaurantId}_${Date.now()}` },
        receipt: { email: false, sms: false },
        redirect: { url: `${Deno.env.get("SITE_URL") ?? ""}/admin/restaurant/${restaurantId}` },
      }),
    });

    const tapData = await tapRes.json();

    // Log the attempt regardless of outcome -- payment_transactions is the audit
    // trail for what was tried, not just what succeeded.
    const { data: txn } = await admin.from("payment_transactions").insert({
      restaurant_id: restaurantId,
      type: "subscription_charge",
      amount: Number(amount),
      currency: "BHD",
      status: tapRes.ok ? (tapData.status ?? "pending") : "failed",
      provider_reference: tapData.id ?? null,
      provider_charge_id: tapData.id ?? null,
      billing_cycle: billingCycle ?? null,
      initiated_by: userData.user.id,
    }).select().single();

    await admin.from("admin_actions").insert({
      actor_id: userData.user.id,
      action: "create_payment_charge",
      target_restaurant_id: restaurantId,
      details: { amount, mode: settings.mode, tap_response_status: tapData.status ?? null, success: tapRes.ok },
    });

    if (!tapRes.ok) {
      return new Response(
        JSON.stringify({ error: tapData.errors?.[0]?.description || "Charge failed", transactionId: txn?.id }),
        { status: 400, headers: cors }
      );
    }

    return new Response(
      JSON.stringify({ success: true, transactionId: txn?.id, chargeId: tapData.id, redirectUrl: tapData.transaction?.url ?? null }),
      { headers: { ...cors, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
