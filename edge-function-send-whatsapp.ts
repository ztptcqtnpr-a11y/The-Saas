import { createClient } from "jsr:@supabase/supabase-js@2";

// Sends WhatsApp messages (receipts or digests) via a configured provider.
// Inert by design: if platform_settings.whatsapp_provider is 'none' or keys
// are missing, returns a clear error instead of silently failing. Built for
// Twilio's WhatsApp API shape since it's the most common path for BHR/GCC
// numbers without a pre-approved Meta Business account; swapping to Meta Cloud
// API later only requires changing the fetch call, not the calling contract.
//
// verify_jwt = true: only callable by an authenticated owner/manager (receipts
// triggered by staff-api server-side using service role bypass this check).

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
    const { restaurantId, type, recipientPhone, message, orderId } = body;

    if (!restaurantId || !type || !recipientPhone || !message) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), { status: 400, headers: cors });
    }

    const { data: settings } = await admin.from("platform_settings").select("whatsapp_provider, whatsapp_api_key, whatsapp_api_secret, whatsapp_phone_number_id").limit(1).maybeSingle();

    if (!settings || settings.whatsapp_provider === "none" || !settings.whatsapp_api_key) {
      // Log the attempt as failed-not-configured so the owner/admin can see
      // receipts/digests are queued but not actually sending yet.
      await admin.from("whatsapp_messages").insert({
        restaurant_id: restaurantId, type, recipient_phone: recipientPhone, order_id: orderId ?? null,
        status: "failed", error: "WhatsApp provider not configured yet.",
      });
      return new Response(JSON.stringify({ error: "WhatsApp provider not configured yet." }), { status: 400, headers: cors });
    }

    let sendResult: { ok: boolean; messageId?: string; error?: string };

    if (settings.whatsapp_provider === "twilio") {
      const accountSid = settings.whatsapp_api_key;
      const authToken = settings.whatsapp_api_secret;
      const fromNumber = settings.whatsapp_phone_number_id; // Twilio WhatsApp-enabled sender number

      const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: `whatsapp:${fromNumber}`,
          To: `whatsapp:${recipientPhone}`,
          Body: message,
        }),
      });
      const twilioData = await twilioRes.json();
      sendResult = twilioRes.ok
        ? { ok: true, messageId: twilioData.sid }
        : { ok: false, error: twilioData.message || "Twilio send failed" };
    } else {
      sendResult = { ok: false, error: `Unsupported provider: ${settings.whatsapp_provider}` };
    }

    await admin.from("whatsapp_messages").insert({
      restaurant_id: restaurantId, type, recipient_phone: recipientPhone, order_id: orderId ?? null,
      status: sendResult.ok ? "sent" : "failed",
      provider_message_id: sendResult.messageId ?? null,
      error: sendResult.error ?? null,
    });

    if (!sendResult.ok) {
      return new Response(JSON.stringify({ error: sendResult.error }), { status: 400, headers: cors });
    }

    return new Response(JSON.stringify({ success: true, messageId: sendResult.messageId }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: cors });
  }
});
