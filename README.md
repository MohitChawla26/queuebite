# QueueBite

Restaurant table booking and restaurant operations on the existing Supabase project. The customer website is at `/`; the separate management website is at `/manage`. Both use the same Supabase data. There are no seeded restaurants, menu items, tables, orders, bookings, or analytics.

## Run locally

Requires Node.js 22.13 or newer. From this directory:

```powershell
npm run install:ci
npm run dev
```

Open the local address printed by the server, normally <http://127.0.0.1:5173/>. `npm run build` builds the production Worker, and `npm start` previews that build.

Copy `.env.example` to `.env.local` and enter your Supabase project URL and publishable key. Payment endpoints additionally need `SUPABASE_SERVICE_ROLE_KEY` and `RAZORPAY_KEY_SECRET`. Both are server-only values. Never put them in `NEXT_PUBLIC_` variables or commit them. The Razorpay test key ID is public; the secret is not.

## Database

The connected Supabase project has the base tables, and the SQL files in `supabase/` record the booking-platform extensions and access rules applied to it. `supabase/schema.sql` is the original base schema without demo data. Row level security is enabled for all added public tables. Availability is checked by the database against opening hours, closures, table capacity, blocks, existing bookings, booking duration, and cleaning buffer; a PostgreSQL exclusion constraint rejects overlaps when two customers book concurrently.

Restaurant owners or managers must add real opening hours and publish their floor map and menu before customers can book or pre-order. The public site displays honest empty states when these records are absent.

## Authentication and payments

Customers browse anonymously and sign in only before confirmation. Google sign-in and temporary Supabase email OTP are supported in the UI; configure the Google provider and redirect URL in Supabase Auth. Supabase email OTP is a temporary adapter until a custom email service is available.

The app creates a ten-minute pending booking hold, saves optional pre-orders with prices checked in PostgreSQL, creates a ₹50 Razorpay test order on the server, verifies the checkout signature and the captured payment through Razorpay, and only then confirms the booking. The payment routes refuse to operate until both private keys are configured. Do not treat a pending booking as confirmed. Paid cancellations need a restaurant-side refund process; automated refunds are not implemented.

## Management

Only assigned staff can enter `/manage`. Owners and managers manage restaurant settings, hours, holidays, menus, tables, layout, bookings, orders, staff, and bills. Waiters use the orders/tables surface. Roles are checked in Supabase policies. Menu and restaurant images upload to the `queuebite-images` Supabase Storage bucket. Saved floor elements and tables are rendered on the customer website.

The POS can create orders, add available dishes, advance kitchen status, print a KOT, and save a bill. Bill calculation is performed in PostgreSQL; a unique constraint prevents the ₹50 deposit from being deducted from more than one bill for a booking. Dashboard figures are derived from actual records.

## Current setup requirements

- Configure `RAZORPAY_KEY_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in the server runtime to enable payment.
- Enable Google as an Auth provider and allow the Site and local redirect URLs if Google sign-in is desired.
- Add each restaurant's operating hours, map, bookable tables, dishes, and real profile information.
- Decide whether the hosted customer site should be public. The existing Site is currently owner-private.
