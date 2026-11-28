# CityRoute — ავტოსკოლის (Driving-school) პაკეტები

Branch `preview/design-plus-pin-audio-20261104` (base `602cf97`). Not committed, not deployed, no SQL applied anywhere.

## How the individual packages work today (unchanged)

| Package | Where it lives |
|---|---|
| 1 car = 99 ₾, 2 cars = 179 ₾ | `device_slot_packages`, created on Preview (`agtcdzxltvtcfxmpnwxr`) by migration `029_dynamic_device_limits.sql`, which seeds exactly two rows `premium/1/99` and `premium/2/179` with broad CHECKs (`device_slots` 1–100, `price_amount > 0`, `currency = 'GEL'`). `0291_bog_fixed_device_slot_packages.sql` (strict 99/179-only CHECK) is an alternative for an empty DB and is **not** applied on Preview (its preflight aborts when the table exists). The 99/179 rows are protected by FORCE RLS with SELECT-only grants for `anon`/`authenticated` (only `postgres`/`service_role` can write), BOG initialize pricing only from this table, and BOG settlement (`bog_fixed_device_package_matches`) matching the paid amount to the row. |
| Checkout | `PaymentButton` → `POST /api/payments/bog/initialize` with `deviceSlots` → `bog-production.ts` reads the price from `device_slot_packages` → `create_bog_pending_payment` → BOG; callback/verify → `update_bog_payment_status` (production only, `VERCEL_ENV === 'production'`) |
| Rights | `profiles.subscription_*` + `profiles.device_slots`; the paid BOG transaction's `metadata.device_slots` is re-verified by `current_verified_premium_device_slots` |
| "Second car" of 179 ₾ | `device_slots = 2` → `current_device_session_limit` = 2 → two concurrent device sessions (`activate_current_session`, `src/lib/device.ts`, `AuthContext`) |

## Architecture chosen — fully separate

Nothing of the above is read, written or replaced. The school system has its own tables, RPCs, client module, components and route.

* `supabase/migrations/038_driving_school_packages.sql` (new)
  * `driving_schools` — one row per owner (`unique(owner_id)`), name, contact, phone, email, address, city, optional registration code, verification info, `status` pending/approved/rejected, review fields.
  * `driving_school_packages` — `car_count in (5, 10)`, `price_amount` **NULL = ფასი დაზუსტდება**, 30 days. Seeded 5/10 with NULL price.
  * `driving_school_licenses` — car_count, `expires_at`, status active/replaced/revoked, source admin/bog, reserved `bog_payment_id`; **at most one active license per school** (partial unique index).
  * `driving_school_cars` — one row per car slot (`unique(school_id, slot_number)`), `status` active/disabled, `android_device_id` + `device_bound_at` + `device_last_seen_at` (ready for Android binding); **one device can hold only one active car** (partial unique index). Trigger `driving_school_cars_limit` enforces slot ≤ license car count and active cars ≤ car count, using only approved, non-expired licenses.
  * RLS forced on all four tables; owners/admins can only SELECT; all writes via RPCs:
    `submit_driving_school_application` (create/resubmit → pending; approved is locked),
    `admin_review_driving_school` (support admins; reject revokes active license),
    `admin_grant_driving_school_license` (support admins; approved only; disables cars above a smaller limit),
    `driving_school_package_purchasable` (approved + active + priced),
    `owner_upsert_driving_school_car`, `owner_set_driving_school_car_status` (disable / enable / release_device = replace device).
* `src/lib/driving-school.ts` — types, catalog/school loaders (fallback to 5/10 "price TBD" if 038 is not applied yet), purchase gate, form validation mirroring the DB checks, submit RPC.
* `src/components/DrivingSchoolPackages.tsx` — 5/10 cards, school status, link to registration. **No PaymentButton / BOG call.** When a school is Approved and a price exists the button becomes "შეძენის მოთხოვნა" → `/support`.
* `src/pages/DrivingSchoolRegistrationPage.tsx` + route `/driving-school` (inside `ProtectedRoute`, outside `PlanGate`).
* `src/pages/PlanSelectionPage.tsx` — adds category tabs "ინსტრუქტორი" (default; existing 1/2 block rendered unchanged) / "ავტოსკოლა". The tab is display-only; the 1/2 state, PaymentButton and trial are untouched.
* `src/types/database.ts` — additive types for the two read tables and the submit RPC.
* `src/pages/subscription-page.css` — appended tab/form styles.

Why not reuse `device_slot_packages` / BOG initialize: the table is the individual 99/179 catalog (on Preview, from 029, its CHECK allows 1–100 devices, so it is the data and the restricted write access — not a strict CHECK — that keep it at 1/99 and 2/179), BOG initialize accepts any `deviceSlots` in 1–100 that exists in that table, and `current_verified_premium_device_slots` grants concurrent sessions from `metadata.device_slots`. Adding 5/10 there would let any (unapproved) user buy them and would change individual entitlement logic — so school packages live elsewhere.

## Applying the migration (not done)

Apply `038_driving_school_packages.sql` to the **Preview** Supabase project (`agtcdzxltvtcfxmpnwxr`) via the SQL editor or `supabase db push`, check it, and only then plan Production separately. The preflight aborts if the driving_school tables already exist. Until it is applied, the UI shows 5/10 with "ფასი დაზუსტდება" and registration submit fails gracefully.

To set a price later: `update public.driving_school_packages set price_amount = <n> where car_count = 5;` (service role / SQL editor).

## Preview state after migration 038 (2026-11-28)

* Migration 038 was applied by the user in the Preview SQL Editor (`agtcdzxltvtcfxmpnwxr`) and is recorded in Preview's migration history as `038 — driving_school_packages`.
* Post-migration read-only checks: the four `driving_school_*` tables exist with RLS enabled and forced; all eight SECURITY DEFINER functions exist; school packages are 5 and 10 with price NULL (TBD).
* Individual packages: `device_slot_packages` still holds only `1 = 99 GEL` and `2 = 179 GEL` (from 029). 029 is applied on Preview; 0291 is not, so the strict `device_slot_packages_fixed_bog_packages_check` constraint does not exist there — it never did, and 038 neither removes nor alters anything on `device_slot_packages`.

## Security audit follow-up (2026-11-28)

* **F1 — fixed.** The preflight now aborts unless the migration role (`current_user`) has `rolsuper` or `rolbypassrls` (same idea as migration 028's helper-owner check). A postflight before `commit` re-checks the real `proowner` of all eight new SECURITY DEFINER functions and aborts the transaction if any owner cannot bypass RLS. Reason: the four tables use FORCE RLS with no write policies, so writes only work through RLS-bypassing definer functions.
  Optional read-only check on Preview before applying: `select rolbypassrls from pg_roles where rolname = 'postgres';`
* **F2 — fixed.** `owner_set_driving_school_car_status(car, 'release_device')` now only clears `android_device_id` / `device_bound_at` / `device_last_seen_at` (it no longer writes `status`) and works for the school owner even when the license expired/was revoked or the school is no longer approved. The car-limit trigger additionally skips UPDATEs that keep an already-active car active in the same slot and school (they add no car). Inserts, disabled → active, and slot/school changes are still fully checked; `disable`/`enable` still require an approved school.
* **F3 — documented (not built).** When Android binding / school route access is built, **every device use must be authorised on the server**, in one SECURITY DEFINER check, never on the client. It must verify all of:
  1. the school's status is `approved`;
  2. the school has an `active` license (`driving_school_licenses.status = 'active'`);
  3. that license has not expired (`expires_at > now()`);
  4. the car's `slot_number ≤` the license's `car_count`;
  5. the school's number of active cars `≤ car_count` (i.e. `driving_school_active_car_limit(school_id)`), and the car itself is `active`;
  6. the calling device is the one bound to that car (`android_device_id` matches an authenticated, server-verified device identity), with the car owned by that school.
  Expired licenses do not change car rows to `disabled`, so this check — not the stored car status — is what must stop access after expiry.
* **F4 — left as is (documented).** The owner's SELECT on `driving_schools` returns the whole row, including `reviewed_by` (the reviewing admin's user id) and `review_note`. Low risk; if it should be hidden later, use a column-level grant or a view for owners.

## Remaining for later

1. Android device binding: RPCs to bind/heartbeat a car's `android_device_id` from the app and to let a school car license grant route access (requires a reviewed change to access checks — intentionally not done to keep individual users unaffected).
2. School prices (currently NULL).
3. Dedicated school BOG checkout (separate endpoint/RPC writing `driving_school_licenses` with `source = 'bog'`; must not reuse `/api/payments/bog/initialize`).
4. Admin UI for approve/reject and license grant (RPCs exist; currently callable from SQL editor as a support admin).
5. Owner car-management UI (RPCs exist).
