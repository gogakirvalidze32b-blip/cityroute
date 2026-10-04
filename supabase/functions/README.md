# CityRoute Payment Edge Functions

Supabase Edge Functions for handling TBC and BOG bank payment integrations.

## Functions

### 1. payment-initialize
Creates payment with TBC or BOG bank and returns payment URL.
- **Endpoint**: `/functions/v1/payment-initialize`
- **Method**: POST
- **Auth**: Required (user token)
- **Body**: 
  ```json
  {
    "provider": "tbc" | "bog",
    "amount": 99
  }
  ```

### 2. payment-webhook-tbc
Receives callbacks from TBC Bank when payment status changes.
- **Endpoint**: `/functions/v1/payment-webhook-tbc`
- **Method**: POST
- **Auth**: None (called by TBC)
- **Body**: TBC callback payload with `PaymentId`

### 3. payment-webhook-bog
Receives callbacks from Bank of Georgia when payment status changes.
- **Endpoint**: `/functions/v1/payment-webhook-bog`
- **Method**: POST
- **Auth**: None (called by BOG)
- **Body**: BOG callback payload with `order_id`

### 4. payment-verify
Verifies payment status after user returns from bank page.
- **Endpoint**: `/functions/v1/payment-verify?paymentId=xxx&provider=tbc`
- **Method**: GET
- **Auth**: None (public endpoint)
- **Query Params**: `paymentId`, `provider`

## Deployment

### Prerequisites
1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Link to your project: `supabase link --project-ref your-project-ref`

### Environment Variables
Create `.env` file in `supabase/functions/`:

```bash
# Supabase
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# TBC Bank
TBC_API_KEY=your-tbc-api-key
TBC_CLIENT_ID=your-tbc-client-id
TBC_CLIENT_SECRET=your-tbc-client-secret

# Bank of Georgia
BOG_CLIENT_ID=your-bog-client-id
BOG_SECRET_KEY=your-bog-secret-key

# App URL
APP_URL=https://cityroute.vercel.app
```

### Deploy All Functions

```bash
# From project root
cd supabase/functions

# Deploy all functions
supabase functions deploy payment-initialize
supabase functions deploy payment-webhook-tbc
supabase functions deploy payment-webhook-bog
supabase functions deploy payment-verify
```

### Set Environment Variables

```bash
# Set secrets for all functions
supabase secrets set --env-file .env
```

## Bank Configuration

### TBC Bank
1. Register at https://developers.tbcbank.ge/
2. Create developer app to get API key
3. Register as E-Commerce merchant to get client_id and client_secret
4. Add callback URL in merchant dashboard: `https://your-project-ref.supabase.co/functions/v1/payment-webhook-tbc`
5. Whitelist IPs: 193.104.20.44, 193.104.20.45, 185.52.80.44, 185.52.80.45

### Bank of Georgia
1. Register at https://api.bog.ge/
2. Create OAuth2 application to get client_id and secret_key
3. Add callback URL: `https://your-project-ref.supabase.co/functions/v1/payment-webhook-bog`

## Database Migration

Run the payment transactions migration:

```sql
-- In Supabase SQL Editor
-- Run: supabase/migrations/002_payment_transactions.sql
```

This creates:
- `payment_transactions` table
- RPC functions for payment management
- Indexes for performance

## Testing

### Local Development

```bash
# Start Supabase locally
supabase start

# Serve functions locally
supabase functions serve --env-file .env

# Test payment initialization
curl -X POST http://localhost:54321/functions/v1/payment-initialize \
  -H "Authorization: Bearer YOUR_USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"tbc","amount":99}'
```

### Production Testing

Use TBC/BOG sandbox environments for testing before going live.

## Monitoring

View function logs:

```bash
# Real-time logs
supabase functions logs payment-initialize --follow

# Specific time range
supabase functions logs payment-webhook-tbc --since 1h
```

## Security

- Edge functions run in isolated Deno runtime
- Service role key has full database access (use carefully)
- Webhook endpoints verify payment status with bank APIs
- All payment status updates require bank verification

## Support

- TBC Docs: https://developers.tbcbank.ge/docs/checkout-overview
- BOG Docs: https://api.bog.ge/docs/en/payments/introduction
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
