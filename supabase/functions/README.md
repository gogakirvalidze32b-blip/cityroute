# CityRoute BOG Payments (Preview Sandbox)

The payment flow is locked to Bank of Georgia's Sandbox API. It uses the bank-hosted checkout page; CityRoute never collects card data. A signed callback or an authenticated return check fetches the authoritative receipt from BOG and confirms the amount, currency, and order IDs. Sandbox results are written only to `bog_sandbox_payment_transactions` and never activate Premium or modify `profiles`.
Payment initialization also requires the request origin to exactly match the configured Vercel Preview `APP_URL`; non-Preview and Production origins are rejected.

The sandbox isolation SQL is kept in `supabase/patches/bog_sandbox_payment_isolation.sql`, outside `supabase/migrations`. The linked Supabase project's migration ledger does not match the repository's legacy numbered migration files, including the duplicate `002` prefix. Do not run `supabase db push`; it may apply unrelated historical migrations. Review and run the isolated SQL patch manually only after explicit approval.

The existing `002_payment_transactions.sql`, `011_premium_packages_and_access_safety.sql`, and `012_bog_verified_payment_activation.sql` implement the legacy/production entitlement path. They are not prerequisites for this isolated Sandbox transaction flow. In particular, do not apply `011` just to enable testing: it revokes direct profile updates and drops `profiles_update_own`.

## Functions

### `payment-initialize`

Authenticated `POST /functions/v1/payment-initialize` with:

```json
{
  "provider": "bog",
  "deviceSlots": 1
}
```

The server accepts `deviceSlots` 1 or 2 and derives 99 GEL or 179 GEL. It also requires a client-generated UUID `requestId`, retained in tab-scoped session storage until the bank return. Retries reuse that ID; the server derives a stable, user-scoped BOG idempotency key and merchant order ID. BOG and the database both reject duplicate payment creation for that request.

### `payment-webhook-bog`

The public callback endpoint is configured with `verify_jwt = false` because BOG cannot send a Supabase user JWT. It verifies BOG's `Callback-Signature` against the exact raw request body before parsing it, then fetches the receipt directly from BOG. Invalid signatures, order IDs, amounts, or currencies cannot activate Premium.

The callback verifier uses BOG's Sandbox-specific public key from the Sandbox callback documentation. Do not replace it with the Production key. Repeated callbacks for the current status are acknowledged as no-ops. Unsupported or backward transitions are rejected without changing the stored status.

### `payment-verify`

Authenticated `GET /functions/v1/payment-verify?merchantPaymentId=<merchant_order_id>&provider=bog`

The payment return page sends the merchant order ID known before redirect. The function requires the signed-in owner, retrieves their stored transaction, fetches the order receipt from BOG, validates it, and records the verified status. A browser redirect by itself never activates Premium.

### Sandbox status and refund behavior

- `completed` records a Sandbox success only after receipt verification. It never activates Premium.
- `rejected` is shown as a failed payment; a returned `cancelled`/`canceled` status is shown as cancellation. BOG's documented receipt statuses do not list a dedicated cancellation status, so its fail-return URL only displays an uncompleted-checkout hint while the server verifies the receipt. Redirect parameters never change the stored payment state or activate Premium.
- `refunded_partially` is recorded distinctly and never activates access.
- `refunded` is recorded without changing profile access.
- Known in-progress statuses are recorded as processing. An unrecognized bank status is rejected by both the Edge Functions and Sandbox SQL RPC, and never changes the stored payment status or activates Premium.

## Preview setup

Configure these as **Supabase Preview Edge Function secrets**, not Vercel browser variables:

- `BOG_CLIENT_KEY` — the bank-issued `client_id` value. `BOG_CLIENT_ID` is also accepted for existing Preview configuration.
- `BOG_SECRET_KEY` — the bank-issued `client_secret` value; server-side only.
- `APP_URL` — the HTTPS Vercel Preview origin used for the return URL.
- Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions.

The current functions use the Sandbox-only endpoints documented by BOG:

- OAuth: `https://oauth2-sandbox.bog.ge/auth/realms/bog/protocol/openid-connect/token`
- Orders and receipts: `https://api-sandbox.bog.ge`
- Checkout: only `https://payment-sandbox.bog.ge`

The local patch creates a dedicated Sandbox ledger and RPCs without changing profile columns, profile policies, or payment entitlement logic. The patch has not been applied remotely. Register `https://<project-ref>.supabase.co/functions/v1/payment-webhook-bog` as the callback URL for the **Sandbox merchant**. Never configure Live credentials or endpoints for these functions.

Remote secrets, the SQL patch, the callback registration, and Edge Function deployment are separate steps and require explicit approval. Never put BOG credentials in Vercel browser variables or source files.

## Official BOG references

- [Authentication](https://api.bog.ge/docs/en/payments/authentication.md)
- [Order request](https://api.bog.ge/docs/en/sandbox/payments/standard-process/create-order.md)
- [Payment details](https://api.bog.ge/docs/en/payments/standard-process/get-payment-details.md)
- [Callback signature](https://api.bog.ge/docs/en/payments/standard-process/callback.md)

## BOG Production integration (Vercel API; not deployed)

Live payment initialization, verification, and callback handling use the Vercel Node API routes under `api/payments/bog`. Production browser requests go to the same-origin API; Preview continues to use the existing Sandbox Supabase Edge Functions. The Live API fails closed unless `VERCEL_ENV=production`, all server configuration is present, and initialization comes from the configured canonical Production origin.

Configure these as **Vercel Production server-side environment variables only**. Never use a `VITE_` prefix for secrets:

- `BOG_CLIENT_KEY`
- `BOG_SECRET_KEY`
- `PRODUCTION_APP_URL` — exactly `https://cityroute.ge` or `https://www.cityroute.ge`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` — server-side only; never expose in browser code

Register `https://cityroute.ge/api/payments/bog/callback` (or the chosen canonical host) as the Live merchant callback URL. The callback verifies BOG's signature against the exact raw body and then retrieves the authoritative receipt from BOG. The browser return page also verifies the receipt through the same Production API.

The API authenticates the user with Supabase and uses the service-role client to insert a pending row into `payment_transactions`. It deliberately does not call `create_bog_payment_transaction`: the current local migration grants that `SECURITY DEFINER` RPC to `authenticated`, allowing clients to create unverified pending rows. BOG status changes use a separate service-role-only `update_bog_payment_status` RPC; the generic `update_payment_status` function used by the legacy TBC webhook is not replaced. The BOG RPC preserves the current Premium behavior: only verified `success` activates/extends Premium, repeated success is idempotent, and refund statuses do not revoke or extend the profile entitlement.

The reviewed SQL proposal is `supabase/patches/bog_production_payment_api.sql`; it has not been executed. Before any approved application, confirm the remote schema/migration state, `profiles` prerequisite columns, access policies, and that the table/RPC are still absent. The repository has a duplicate `002` migration prefix, and the reported remote state previously lacked `payment_transactions` and its RPCs. Do not run `supabase db push` or migrations without reviewing the exact remote migration history and obtaining approval. The patch creates the BOG-specific RPC with `pg_catalog` search path, service-role-only execution, strict status validation, cumulative partial-refund idempotency, and the Premium activation logic; it leaves `update_payment_status` untouched for TBC.

This change is local only. No SQL was executed, no Supabase connection or secrets were used, and no deployment was performed.
