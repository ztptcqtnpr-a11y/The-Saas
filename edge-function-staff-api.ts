import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limit: max 8 PIN attempts per token per rolling 5-minute window.
// Edge functions are short-lived/stateless per instance, so this is a soft defense
// layer, not a hard guarantee -- paired with the pin_attempts table below for a
// durable, cross-instance record that can't be reset by a cold start.
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, token, pin } = body;

    if (!token || !pin) {
      return new Response(JSON.stringify({ error: "Missing token or pin" }), { status: 400, headers: cors });
    }

    // Durable rate limiting via pin_attempts table (see migration).
    // Every attempt against a token is logged; if a token has hit the ceiling of
    // recent failed attempts, block regardless of whether this particular PIN is right.
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count: recentFailures } = await admin
      .from("pin_attempts")
      .select("id", { count: "exact", head: true })
      .eq("url_token", token)
      .eq("success", false)
      .gte("attempted_at", windowStart);

    if ((recentFailures ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in a few minutes." }),
        { status: 429, headers: cors }
      );
    }

    const { data: code, error: codeErr } = await admin
      .from("staff_access_codes")
      .select("id, restaurant_id, branch_id, role, active")
      .eq("url_token", token)
      .eq("pin", pin)
      .single();

    // Log every attempt (success or failure) for the durable rate-limit record.
    await admin.from("pin_attempts").insert({
      url_token: token,
      success: !codeErr && !!code && code.active,
    });

    if (codeErr || !code || !code.active) {
      return new Response(JSON.stringify({ error: "Invalid or expired code" }), { status: 401, headers: cors });
    }

    const restaurantId = code.restaurant_id;
    const branchId = code.branch_id;
    const role = code.role;

    const { data: restaurantCheck } = await admin.from("restaurants").select("status, plan").eq("id", restaurantId).single();
    if (restaurantCheck && (restaurantCheck.status === "paused" || restaurantCheck.status === "cancelled")) {
      return new Response(JSON.stringify({ error: "This account is paused or cancelled. Contact the platform admin." }), { status: 403, headers: cors });
    }

    if (action === "verify") {
      return new Response(JSON.stringify({ success: true, role, restaurantName: (await admin.from("restaurants").select("name").eq("id", restaurantId).single()).data?.name, plan: restaurantCheck?.plan }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "checkin") {
      const { staffName } = body;
      const { data, error } = await admin.from("staff_checkins").insert({ restaurant_id: restaurantId, branch_id: branchId, staff_name: staffName, role }).select().single();
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true, checkinId: data.id }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "checkout") {
      const { checkinId } = body;
      const { error } = await admin.from("staff_checkins").update({ checked_out_at: new Date().toISOString() }).eq("id", checkinId);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "get_menu") {
      const { data, error } = await admin.from("menu_items").select("id, name, name_ar, price").eq("branch_id", branchId).eq("active", true).order("created_at");
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true, items: data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "lookup_customer") {
      const { phone } = body;
      const { data } = await admin.from("customers").select("id, name, phone, visit_count, loyalty_points, total_spent").eq("restaurant_id", restaurantId).eq("phone", phone).maybeSingle();
      const { data: rule } = await admin.from("loyalty_rules").select("*").eq("restaurant_id", restaurantId).maybeSingle();

      // Barista Memory: Growth + Pro only. Surfaces the customer's most-ordered
      // item at this branch so staff can suggest "the usual" without asking.
      let usualOrder: { itemName: string; itemNameAr: string | null; timesOrdered: number } | null = null;
      if (data && restaurantCheck?.plan !== "starter") {
        const { data: usual } = await admin
          .from("customer_usual_orders")
          .select("item_name, item_name_ar, times_ordered")
          .eq("customer_id", data.id)
          .eq("branch_id", branchId)
          .order("times_ordered", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (usual) usualOrder = { itemName: usual.item_name, itemNameAr: usual.item_name_ar, timesOrdered: usual.times_ordered };
      }

      return new Response(JSON.stringify({ success: true, customer: data ?? null, loyaltyRule: rule ?? null, usualOrder }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "redeem_points") {
      const { customerId } = body;
      const { data: rule } = await admin.from("loyalty_rules").select("*").eq("restaurant_id", restaurantId).single();
      const { data: customer } = await admin.from("customers").select("loyalty_points").eq("id", customerId).single();
      if (!rule || !customer || customer.loyalty_points < rule.redeem_points_required) {
        return new Response(JSON.stringify({ error: "Not enough points" }), { status: 400, headers: cors });
      }
      await admin.from("customers").update({ loyalty_points: customer.loyalty_points - rule.redeem_points_required }).eq("id", customerId);
      await admin.from("loyalty_redemptions").insert({ restaurant_id: restaurantId, customer_id: customerId, points_used: rule.redeem_points_required, reward_name: rule.redeem_reward_name });
      return new Response(JSON.stringify({ success: true, reward: rule.redeem_reward_name }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "create_order") {
      const { tableNumber, customerPhone, customerName, marketingOptIn, items, clientGeneratedId, paymentMethod } = body;
      if ((!tableNumber && !customerPhone) || !items?.length) {
        return new Response(JSON.stringify({ error: "Missing table/customer or items" }), { status: 400, headers: cors });
      }

      // Idempotency: if this exact client-generated order was already synced
      // (e.g. the offline queue retried after a partial success), return the
      // existing order instead of creating a duplicate.
      if (clientGeneratedId) {
        const { data: existingOrder } = await admin.from("orders").select("id").eq("client_generated_id", clientGeneratedId).maybeSingle();
        if (existingOrder) {
          return new Response(JSON.stringify({ success: true, orderId: existingOrder.id, lowStockWarnings: [] }), { headers: { ...cors, "Content-Type": "application/json" } });
        }
      }

      const { data: menuRows } = await admin.from("menu_items").select("id, price").in("id", items.map((it: any) => it.menuItemId));
      const priceMap: Record<string, number> = {};
      (menuRows ?? []).forEach((r: any) => { priceMap[r.id] = Number(r.price); });
      const orderTotal = items.reduce((sum: number, it: any) => sum + (priceMap[it.menuItemId] ?? 0) * it.quantity, 0);

      const { data: rule } = await admin.from("loyalty_rules").select("*").eq("restaurant_id", restaurantId).maybeSingle();
      const autoPoints = restaurantCheck?.plan !== "starter";

      let customerId: string | null = null;
      if (customerPhone) {
        const { data: existing } = await admin.from("customers").select("id, visit_count, loyalty_points, total_spent").eq("restaurant_id", restaurantId).eq("phone", customerPhone).maybeSingle();
        if (existing) {
          const earned = autoPoints && rule ? Math.floor(orderTotal * Number(rule.points_per_bhd)) : 0;
          await admin.from("customers").update({
            visit_count: existing.visit_count + 1,
            last_visit: new Date().toISOString(),
            loyalty_points: existing.loyalty_points + earned,
            total_spent: Number(existing.total_spent) + orderTotal,
          }).eq("id", existing.id);
          customerId = existing.id;
        } else {
          const earned = autoPoints && rule ? Math.floor(orderTotal * Number(rule.points_per_bhd)) : 0;
          const { data: created } = await admin.from("customers").insert({
            restaurant_id: restaurantId, branch_id: branchId, name: customerName || "Customer", phone: customerPhone,
            marketing_opt_in: !!marketingOptIn, loyalty_points: earned, total_spent: orderTotal,
          }).select().single();
          customerId = created?.id ?? null;
        }
      }

      const { data: order, error: orderErr } = await admin.from("orders").insert({
        restaurant_id: restaurantId, branch_id: branchId, table_number: tableNumber || null, customer_id: customerId, status: "pending", placed_via: "staff",
        payment_method: paymentMethod ?? null, client_generated_id: clientGeneratedId ?? null, synced_at: new Date().toISOString(),
      }).select().single();
      if (orderErr) return new Response(JSON.stringify({ error: orderErr.message }), { status: 400, headers: cors });

      const orderItems = items.map((it: any) => ({ order_id: order.id, menu_item_id: it.menuItemId, quantity: it.quantity, notes: it.notes || null }));
      const { error: itemsErr } = await admin.from("order_items").insert(orderItems);
      if (itemsErr) return new Response(JSON.stringify({ error: itemsErr.message }), { status: 400, headers: cors });

      // Ingredient stock deduction. Best-effort: an order still succeeds even if an
      // item has no ingredient mapping (many menus won't track every item). Any item
      // that pushes an ingredient below its low_stock_threshold is returned to the
      // client so the waiter app can surface a warning immediately.
      const lowStockWarnings: { ingredientName: string; remaining: number }[] = [];
      for (const it of items) {
        const { data: mapping } = await admin
          .from("menu_item_ingredients")
          .select("ingredient_id, quantity_used, ingredients(name, quantity_on_hand, low_stock_threshold, unit)")
          .eq("menu_item_id", it.menuItemId);

        for (const row of mapping ?? []) {
          const ing = (row as any).ingredients;
          if (!ing) continue;
          const deduction = Number(row.quantity_used) * it.quantity;
          const newQty = Number(ing.quantity_on_hand) - deduction;

          await admin.from("ingredients").update({ quantity_on_hand: newQty }).eq("id", row.ingredient_id);
          await admin.from("stock_movements").insert({
            ingredient_id: row.ingredient_id, change_amount: -deduction, reason: "order_deduction", order_id: order.id,
          });

          if (newQty <= Number(ing.low_stock_threshold)) {
            lowStockWarnings.push({ ingredientName: ing.name, remaining: newQty });
          }
        }
      }

      // WhatsApp Receipts (all plans): fire-and-forget, never blocks or fails
      // the order itself if WhatsApp isn't configured or the send fails.
      if (customerPhone) {
        const itemLines = items.map((it: any) => {
          const mi = (menuRows ?? []).find((r: any) => r.id === it.menuItemId);
          return `${it.quantity}x ${mi ? "BHD " + Number(mi.price).toFixed(3) : ""}`;
        }).join("\n");
        const receiptMsg = `Thanks for your order!\n\n${itemLines}\n\nTotal: BHD ${orderTotal.toFixed(3)}`;
        admin.functions.invoke("send-whatsapp", {
          body: { restaurantId, type: "receipt", recipientPhone: customerPhone, message: receiptMsg, orderId: order.id },
        }).catch(() => { /* best-effort, never block the order */ });
      }

      return new Response(
        JSON.stringify({ success: true, orderId: order.id, lowStockWarnings }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (action === "get_orders") {
      const { data, error } = await admin
        .from("orders")
        .select("id, table_number, status, created_at, placed_via, customers(name), order_items(id, quantity, notes, menu_items(name, name_ar))")
        .eq("branch_id", branchId)
        .in("status", ["pending", "in_progress", "ready"])
        .order("created_at");
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true, orders: data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "get_ready_orders") {
      const { data, error } = await admin
        .from("orders")
        .select("id, table_number, status, created_at, customers(name)")
        .eq("branch_id", branchId)
        .eq("status", "ready")
        .order("created_at");
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true, orders: data }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "update_order_status") {
      const { orderId, status } = body;
      const { error } = await admin.from("orders").update({ status }).eq("id", orderId);
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(JSON.stringify({ success: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
