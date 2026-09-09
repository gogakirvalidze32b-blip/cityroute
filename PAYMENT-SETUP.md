# Payment Integration Setup Guide

## What Was Changed

### 1. ✅ Pricing Updated
- Changed from 3-tier pricing (50/60/70 GEL) to **single premium plan: 99 GEL/month**
- Simplified UI - removed PlanPicker, showing single premium package

### 2. ✅ Payment Modules Created
- `src/lib/payments/tbc.ts` - TBC Bank integration
- `src/lib/payments/bog.ts` - Bank of Georgia integration  
- `src/lib/payments/payment-service.ts` - Unified payment service

### 3. ✅ UI Components
- `PaymentButton` - TBC & BOG payment buttons
- `PaymentReturnPage` - Payment result page
- `payment.css` - Payment UI styling

### 4. ✅ Backend (Supabase Edge Functions)
- `payment-initialize` - Creates payment with bank
- `payment-webhook-tbc` - TBC callback handler
- `payment-webhook-bog` - BOG callback handler
- `payment-verify` - Verifies payment status

### 5. ✅ Database Schema
- `002_payment_transactions.sql` migration
- `payment_transactions` table
- RPC functions for payment management

---

## How to Run Locally (See Changes)

### Option 1: Manual Terminal

1. Open Terminal/PowerShell/CMD
2. Navigate to project:
   ```bash
   cd C:\Users\G.K\Desktop\cityroute
   ```
3. Run dev server:
   ```bash
   npm run dev
   ```
4. Open browser: http://localhost:5173/

### Option 2: Use Batch File

Double-click `start-dev.bat` file

### What You'll See

✅ **New Pricing**: Single premium plan at 99 GEL/month  
✅ **Payment Buttons**: TBC Bank and BOG buttons on expired trial page  
✅ **Simplified Plan Selection**: Shows only premium package features

⚠️ **Payment buttons won't work yet** - they need backend configuration (see below)

---

## Full Payment Setup (Production)

### Step 1: Database Migration

1. Go to [Supabase Dashboard](https://supabase.com/dashboard/project/tuylbbdhvfcobxynwtnt/sql)
2. Open SQL Editor
3. Copy contents of `supabase/migrations/002_payment_transactions.sql`
4. Paste and execute

This creates:
- `payment_transactions` table
- `create_payment_transaction()` RPC
- `update_payment_status()` RPC  
- Indexes for performance

### Step 2: Get Bank Credentials

#### TBC Bank
1. Register at https://developers.tbcbank.ge/
2. Create developer app → get **API Key**
3. Register as E-Commerce merchant → get **Client ID** and **Client Secret**
4. In merchant dashboard at ecom.tbcpayments.ge:
   - Add callback URL: `https://YOUR_PROJECT.supabase.co/functions/v1/payment-webhook-tbc`
   - Add return URL: `https://YOUR_APP_URL/payment/return?provider=tbc`

#### Bank of Georgia
1. Register at https://api.bog.ge/
2. Create OAuth2 application → get **Client ID** and **Secret Key**
3. Configure:
   - Callback URL: `https://YOUR_PROJECT.supabase.co/functions/v1/payment-webhook-bog`
   - Return URL: `https://YOUR_APP_URL/payment/return?provider=bog`

### Step 3: Deploy Edge Functions

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Link to project:
   ```bash
   supabase link --project-ref tuylbbdhvfcobxynwtnt
   ```

3. Create `.env` in `supabase/functions/`:
   ```bash
   SUPABASE_URL=https://tuylbbdhvfcobxynwtnt.supabase.co
   SUPABASE_ANON_KEY=your_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   
   TBC_API_KEY=your_tbc_api_key
   TBC_CLIENT_ID=your_tbc_client_id
   TBC_CLIENT_SECRET=your_tbc_client_secret
   
   BOG_CLIENT_ID=your_bog_client_id
   BOG_SECRET_KEY=your_bog_secret_key
   
   APP_URL=https://cityroute.vercel.app
   ```

4. Deploy functions:
   ```bash
   cd supabase/functions
   
   supabase functions deploy payment-initialize
   supabase functions deploy payment-webhook-tbc
   supabase functions deploy payment-webhook-bog
   supabase functions deploy payment-verify
   ```

5. Set environment variables:
   ```bash
   supabase secrets set --env-file .env
   ```

### Step 4: Test Payment Flow

1. Run app locally or on production
2. Create account and wait for 24h trial to expire
3. Click TBC or BOG payment button
4. You should be redirected to bank's payment page
5. Complete test payment (use sandbox credentials)
6. You'll be redirected back to `/payment/return`
7. Payment status is verified
8. If successful, premium subscription is activated

---

## Payment Flow Diagram

```
User clicks "Pay with TBC/BOG"
    ↓
PaymentButton calls Supabase Edge Function
    ↓
payment-initialize creates payment with bank API
    ↓
Returns payment URL
    ↓
User redirected to bank payment page
    ↓
User completes payment
    ↓
Bank sends webhook to payment-webhook-tbc/bog
    ↓
Webhook updates payment_transactions table
    ↓
If successful, activates subscription in profiles table
    ↓
User redirected to /payment/return
    ↓
payment-verify checks final status
    ↓
Shows success/failure message
```

---

## Monitoring & Debugging

### View Edge Function Logs

```bash
# Real-time logs
supabase functions logs payment-initialize --follow

# Check webhook
supabase functions logs payment-webhook-tbc --follow
```

### Check Payment Transactions

```sql
-- In Supabase SQL Editor
select * from payment_transactions 
order by created_at desc 
limit 10;
```

### Check User Subscription Status

```sql
select id, full_name, subscription_status, subscription_plan, subscription_expires_at 
from profiles 
where subscription_status = 'active';
```

---

## Testing with Sandbox

Both TBC and BOG provide sandbox environments:

- **TBC Sandbox**: Use test credentials from TBC developer portal
- **BOG Sandbox**: Use test credentials from BOG API portal

Test cards are provided by each bank for successful/failed payment scenarios.

---

## Security Notes

✅ All payment API calls go through Supabase Edge Functions (server-side)  
✅ Client never sees bank credentials  
✅ Payment verification happens on callback AND on return  
✅ Webhook endpoints verify with bank API before updating database  
✅ Service role key needed to update subscription status

---

## Support & Documentation

- **TBC API Docs**: https://developers.tbcbank.ge/docs/checkout-overview
- **BOG API Docs**: https://api.bog.ge/docs/en/payments/introduction
- **Supabase Functions**: https://supabase.com/docs/guides/functions
- **Full Setup Guide**: `supabase/functions/README.md`

---

## Quick Reference

| File | Purpose |
|------|---------|
| `src/lib/payments/tbc.ts` | TBC Bank API client |
| `src/lib/payments/bog.ts` | BOG Bank API client |
| `src/components/PaymentButton.tsx` | Payment UI component |
| `src/pages/PaymentReturnPage.tsx` | Payment result page |
| `supabase/functions/payment-initialize/` | Creates payment |
| `supabase/functions/payment-webhook-tbc/` | TBC callback handler |
| `supabase/functions/payment-webhook-bog/` | BOG callback handler |
| `supabase/functions/payment-verify/` | Verifies payment |
| `supabase/migrations/002_payment_transactions.sql` | Database schema |

---

**Status**: ✅ All code ready | ⚠️ Needs backend configuration to work
