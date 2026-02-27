// Supabase Edge Function: stripe-webhook
// Deploy: supabase functions deploy stripe-webhook
// Configure Stripe webhook endpoint to this function URL and subscribe to:
// - checkout.session.completed
//
// Secrets needed:
// - STRIPE_WEBHOOK_SECRET (whsec_...)
// - SUPABASE_SERVICE_ROLE_KEY
// - SUPABASE_URL

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function hmacSHA256Hex(key: string, msg: string) {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function parseStripeSigHeader(h: string) {
  const parts = h.split(",").map((s) => s.trim());
  const kv: Record<string, string[]> = {};
  for (const p of parts) {
    const [k, v] = p.split("=");
    if (!k || !v) continue;
    kv[k] = kv[k] || [];
    kv[k].push(v);
  }
  const t = kv["t"]?.[0];
  const v1 = kv["v1"] || [];
  return { t, v1 };
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json(405, { error: "Method not allowed" });

    const sigHeader = req.headers.get("stripe-signature") || "";
    if (!sigHeader) return json(400, { error: "Missing stripe-signature header" });

    const rawBody = await req.text(); // IMPORTANT: raw body for signature
    const { t, v1 } = parseStripeSigHeader(sigHeader);
    if (!t || v1.length === 0) return json(400, { error: "Invalid signature header" });

    const signedPayload = `${t}.${rawBody}`;
    const expected = await hmacSHA256Hex(WEBHOOK_SECRET, signedPayload);

    const ok = v1.some((sig) => timingSafeEqual(sig, expected));
    if (!ok) return json(400, { error: "Bad signature" });

    const event = JSON.parse(rawBody);

    if (event?.type !== "checkout.session.completed") {
      return json(200, { received: true, ignored: true });
    }

    const session = event?.data?.object;
    const user_id = session?.metadata?.user_id;
    const contest_id = session?.metadata?.contest_id;

    if (!user_id || !contest_id) {
      return json(200, { received: true, ignored: true, reason: "missing metadata" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Grant HELP (3 uses) for this contest + user (one-time per contest)
    const { error: upErr } = await supabase
      .from("help_purchases")
      .upsert(
        { contest_id, user_id, used_count: 0, max_uses: 3 },
        { onConflict: "contest_id,user_id" },
      );

    if (upErr) return json(500, { error: upErr.message });

    return json(200, { received: true });
  } catch (e) {
    return json(500, { error: e?.message || String(e) });
  }
});
