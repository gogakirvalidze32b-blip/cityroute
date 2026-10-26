# CityRoute BOG Payments (Preview)

The Preview payment flow is locked to Bank of Georgia's Sandbox API. It uses the bank-hosted checkout page; CityRoute never collects card data. Sandbox transactions are stored only in `bog_sandbox_payment_transactions`; a successful Sandbox payment never activates Premium or modifies `profiles`. The signed callback and authenticated return check fetch the authoritative receipt from BOG and confirm the amount, currency, and order IDs before recording a status.

The isolated Sandbox SQL is in `supabase/patches/bog_sandbox_payment_isolation.sql`, outside `supabase/migrations`. Review the target database before applying it manually; do not run `supabase db push` for this patch.

## Functions

### `payment-initialize`

Authenticated `POST /functions/v1/payment-initialize` with:

```json
{
  "provider": "bog",
  "deviceSlots": 1
}
```

The server accepts `deviceSlots` 1 or 2 and derives 99 GEL or 179 GEL. It also requires a client-generated UUID `requestId`, retained in tab-scoped session storage until the bank return. Retries reuse that ID; the server derives a stable, user-scoped BOG idempotency key and merchant order ID. BOG and the database both reject duplicate payment creation for that request. Initialization requires an exact `Origin` match with the configured HTTPS Preview `APP_URL`; Production origins and non-Vercel hosts are rejected.

### `payment-webhook-bog`

The public callback endpoint is configured with `verify_jwt = false` because BOG cannot send a Supabase user JWT. It verifies BOG's `Callback-Signature` against the exact raw request body before parsing it, then fetches the receipt directly from BOG. Invalid signatures, order IDs, amounts, or currencies cannot change the Sandbox transaction status.

The callback verifier uses BOG's Sandbox-specific public key from the Sandbox callback documentation. Repeated or stale callback notifications are safe: the handler fetches the current bank receipt, and the database locks the payment row and ignores duplicate or backward status transitions.

### `payment-verify`

Authenticated `GET /functions/v1/payment-verify?merchantPaymentId=<merchant_order_id>&provider=bog`

The payment return page sends the merchant order ID known before redirect. The function requires the signed-in owner, retrieves their stored Sandbox transaction, fetches the order receipt from BOG, validates it, and records the verified status. A browser redirect by itself never changes transaction status or activates Premium.

### Status and refund behavior

- `completed` records a Sandbox success only after receipt verification. It never activates Premium.
- `rejected` is shown as a failed payment; a returned `cancelled`/`canceled` status is shown as cancellation. BOG's documented receipt statuses do not list a dedicated cancellation status, so its fail-return URL only displays an uncompleted-checkout hint while the server verifies the receipt. Redirect parameters never change the stored payment state or activate Premium.
- `refunded_partially` is recorded distinctly and never activates access. Repeated partial refunds are handled idempotently using the cumulative bank refund amount.
- `refunded` is recorded without changing profile access.
- Known in-progress statuses are recorded as processing. An unrecognized bank status is rejected and never changes transaction status.

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

The local migration files are not applied by this change. Migration 011 preserves known `premium`, `nav`, `panel`, and `full` plan labels, aborts on unknown labels, and aborts rather than dropping multi-column CHECK constraints. It still drops simple checks on `subscription_plan`, drops the `profiles_update_own` policy, and revokes direct profile updates from `anon` and `authenticated`; verify any external profile-edit paths first. The current client does not have a confirmed feature mapping for the old `nav`/`panel`/`full` values, so preserving the labels alone does not resolve their runtime entitlement mapping.

Migration 012 stacks a verified 30-day purchase after a still-valid active subscription. It checks for duplicate BOG idempotency and merchant IDs before adding unique indexes and aborts on unexpected payment-status CHECK constraints or values. These checks were not run against a database. Review the Preview database and migration history before applying. Refund status is transaction-only pending manual entitlement review. Do not apply either migration without reviewing the Preview impact and confirming profile-update RPC coverage.

Register `https://<preview-project-ref>.supabase.co/functions/v1/payment-webhook-bog` as the callback URL for the **Sandbox merchant**. Use only Sandbox credentials and endpoints in Preview. Production endpoints, credentials, functions, and SQL are outside this Preview flow.

This repository change does not configure remote Supabase secrets, apply migrations, register the bank callback, or deploy Edge Functions. Those Preview setup steps are required for end-to-end payment testing.

## Official BOG references

- [Authentication](https://api.bog.ge/docs/en/payments/authentication.md)
- [Order request](https://api.bog.ge/docs/en/sandbox/payments/standard-process/create-order.md)
- [Payment details](https://api.bog.ge/docs/en/payments/standard-process/get-payment-details.md)
- [Callback signature](https://api.bog.ge/docs/en/payments/standard-process/callback.md)
