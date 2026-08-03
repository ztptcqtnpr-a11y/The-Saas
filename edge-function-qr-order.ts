import { createClient } from "jsr:@supabase/supabase-js@2";

// Public QR table-ordering endpoint. No PIN -- the credential is the qr_token
// itself: 32 random bytes (64 hex chars), effectively unguessable, unlike the
// 6-digit staff PIN. Each token maps to exactly one table at one branch, so a
// customer scanning a QR code can only ever see/order for that single table.
// Only two actions are exposed: get_menu (read) and create_order (write).
// No customer PII lookups, no loyalty redemption, no order-status changes --
// that surface stays staff-only via staff-api.

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

    const body = await req.json();
    const { action, qrToken } = body;

    if (!qrToken) {
      return new Response(JSON.stringify({ error: "Missing table token" }), { status: 400, headers: cors });
    }

    const { data: tableRow, error: tableErr } = await admin
      .from("branch_tables")
      .select("id, branch_id, table_number, active, branches(restaurant_id)")
      .eq("qr_token", qrToken)
      .single();

    if (tableErr || !tableRow || !tableRow.active) {
      return new Response(JSON.stringify({ error: "This table code is no longer valid." }), { status: 404, headers: cors });
    }

    const branchId = tableRow.branch_id;
    const restaurantId = (tableRow as any).branches?.restaurant_id;

    // QR ordering is a Pro-only feature; also blocks paused/cancelled accounts,
    // same as the staff-api guard.
    const { data: restaurant } = await admin.from("restaurants").select("status, plan, default_menu_language").eq("id", restaurantId).single();
    if (!restaurant || restaurant.plan !== "pro") {
      return new Response(JSON.stringify({ error: "QR ordering is not enabled for this restaurant." }), { status: 403, headers: cors });
    }
    if (restaurant.status === "paused" || restaurant.status === "cancelled") {
      return new Response(JSON.stringify({ error: "This restaurant is temporarily unavailable." }), { status: 403, headers: cors });
    }

    if (action === "get_menu") {
      const { data, error } = await admin
        .from("menu_items")
        .select("id, name, name_ar, description_en, description_ar, price")
        .eq("branch_id", branchId)
        .eq("active", true)
        .order("created_at");
      if (error) return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: cors });
      return new Response(
        JSON.stringify({ success: true, items: data, tableNumber: tableRow.table_number, defaultLanguage: restaurant.default_menu_language }),
        { headers: { ...cors, "Content-Type": "application/json" } }
      );
    }

    if (action === "create_order") {
      const { customerName, items } = body;
      if (!items?.length) {
        return new Response(JSON.stringify({ error: "No items in order" }), { status: 400, headers: cors });
      }

      // Re-validate every item belongs to this branch's active menu -- never trust
      // client-submitted prices or item IDs for a public, unauthenticated endpoint.
      const { data: validItems } = await admin
        .from("menu_items")
        .select("id, price")
        .eq("branch_id", branchId)
        .eq("active", true)
        .in("id", items.map((it: any) => it.menuItemId));

      const validIds = new Set((validItems ?? []).map((v: any) => v.id));
      const filteredItems = items.filter((it: any) => validIds.has(it.menuItemId));
      if (filteredItems.length === 0) {
        return new Response(JSON.stringify({ error: "No valid items in order" }), { status: 400, headers: cors });
      }

      const { data: order, error: orderErr } = await admin.from("orders").insert({
        restaurant_id: restaurantId,
        branch_id: branchId,
        table_number: tableRow.table_number,
        branch_table_id: tableRow.id,
        status: "pending",
        placed_via: "qr",
      }).select().single();
      if (orderErr) return new Response(JSON.stringify({ error: orderErr.message }), { status: 400, headers: cors });

      const orderItems = filteredItems.map((it: any) => ({
        order_id: order.id, menu_item_id: it.menuItemId, quantity: it.quantity, notes: it.notes || null,
      }));
      const { error: itemsErr } = await admin.from("order_items").insert(orderItems);
      if (itemsErr) return new Response(JSON.stringify({ error: itemsErr.message }), { status: 400, headers: cors });

      // Ingredient deduction, same logic as staff-api create_order.
      for (const it of filteredItems) {
        const { data: mapping } = await admin
          .from("menu_item_ingredients")
          .select("ingredient_id, quantity_used, ingredients(quantity_on_hand)")
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
        }
      }

      return new Response(JSON.stringify({ success: true, orderId: order.id }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
