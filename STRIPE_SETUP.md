# Stripe setup (CMP / HELP €1,99)

## 1) Create Stripe Price (sandbox)
In Stripe Dashboard (Sandbox):
- Products -> **Add product**
- Name: `HELP (CMP)`
- Pricing: **One-time**
- Price: `1.99`
- Currency: `EUR`

Copy the **Price ID** (starts with `price_...`).

## 2) Deploy Supabase Edge Functions
You must have Supabase CLI installed and logged in.

From your project root:
```bash
supabase link --project-ref <your-project-ref>
supabase functions deploy create-checkout-session
supabase functions deploy stripe-webhook
```

## 3) Set Supabase Function Secrets
In Supabase Dashboard -> **Edge Functions** -> **Secrets** add:

- `STRIPE_SECRET_KEY` = `sk_test_...` (later `sk_live_...`)
- `STRIPE_PRICE_ID` = `price_...`
- `STRIPE_WEBHOOK_SECRET` = `whsec_...`
- `APP_URL` = your Netlify site URL (example: `https://gleeful-lebkuchen-f95609.netlify.app`)
- `SUPABASE_SERVICE_ROLE_KEY` = Service role key from Supabase Project Settings -> API

> IMPORTANT: Never put secret keys in the frontend.

## 4) Create Stripe webhook
Stripe Dashboard -> Developers -> Webhooks -> Add endpoint:

Endpoint URL:
- Supabase function URL for `stripe-webhook`
  (Supabase Dashboard shows the URL, usually: `https://<project-ref>.functions.supabase.co/stripe-webhook`)

Events:
- `checkout.session.completed`

Copy the **Signing secret** (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.

## 5) Frontend
The dashboard button **🟣 Αγορά HELP (€1,99)** now redirects to Stripe Checkout (via the edge function).
After successful payment, Stripe webhook writes to `help_purchases`.
