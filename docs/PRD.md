# The Owl's Nest — Platform PRD

**Product Requirements Document**
**Version:** 1.0
**Date:** April 25, 2026
**Author:** Travis
**Status:** Draft

---

## 1. Executive Summary

The Owl's Nest Platform is a custom-built, self-hosted system that serves as both the public-facing brand and booking website for The Owl's Nest short-term rental property (147 SW 4th St, Redmond, OR 97756) and the operational backend for managing bookings, cleaning schedules, guest communications, and financials.

The platform replaces the previously planned NestReady mobile app and Beds24 channel manager with a unified, owner-operated system. It consolidates the guest experience, booking engine, cleaner coordination, and property management into a single product under full owner control.

### Goals

- Establish a distinctive direct booking presence that reflects The Owl's Nest brand
- Eliminate recurring channel manager fees (Beds24) by owning the booking engine
- Provide a centralized admin dashboard for all property operations
- Automate cleaner scheduling with a priority-based SMS request system
- Enable two-way guest communication via SMS
- Sync availability across OTA platforms via iCal
- Integrate dynamic pricing via PriceLabs
- Maintain full financial visibility with per-booking reporting

---

## 2. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GUEST-FACING LAYER                      │
│                                                             │
│  Astro Static Site (SSG)                                    │
│  ├── Brand pages (About, Gallery, Area Guide)               │
│  ├── Blog (Markdown/MDX, admin-managed)                     │
│  ├── Reviews page                                           │
│  ├── Booking calendar + inquiry/checkout flow                │
│  └── Guest account (magic link auth)                        │
│                                                             │
│  Rebuilds triggered via admin publish action                 │
└──────────────────────────┬──────────────────────────────────┘
                           │ API calls
┌──────────────────────────▼──────────────────────────────────┐
│                      API LAYER (NestJS)                      │
│                                                             │
│  ├── Booking Engine (availability, pricing, reservations)    │
│  ├── Cleaner Management (assignments, SMS waterfall)         │
│  ├── Guest Messaging (two-way SMS, templates)                │
│  ├── Content Management (blog CRUD, publish trigger)         │
│  ├── Review Management (own + curated OTA reviews)           │
│  ├── Financial Reporting (revenue, per-booking breakdown)    │
│  ├── iCal Sync (import + export)                             │
│  ├── Auth (magic link for guests, session-based for admin)   │
│  └── Stripe Integration (payments, refunds)                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                     DATA & SERVICES                          │
│                                                             │
│  PostgreSQL (on host machine)                                │
│  Stripe (payment processing)                                 │
│  Twilio (SMS — guest messaging + cleaner requests)           │
│  PriceLabs (dynamic pricing — integration TBD)               │
│  iCal feeds (Airbnb, VRBO, Booking.com, Google)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     ADMIN LAYER                              │
│                                                             │
│  React SPA (web + mobile responsive)                         │
│  ├── Booking management (approve/decline, calendar view)     │
│  ├── Cleaner scheduling (assign, trigger SMS, track status)  │
│  ├── Guest messaging (conversation threads, templates)       │
│  ├── Content editor (blog posts, area guides, publish)       │
│  ├── Review management (add own, curate OTA reviews)         │
│  ├── Financial dashboard (revenue, per-booking detail)       │
│  ├── Property settings (pricing rules, min stays, taxes)     │
│  └── iCal feed management                                    │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Guest-facing site | Astro (SSG) | Static generation, React islands for interactive components |
| Interactive components | React | Booking calendar, review carousel, embedded in Astro islands |
| API server | NestJS (TypeScript) | REST API, background jobs (iCal polling, SMS) |
| Admin dashboard | React | SPA, web + mobile responsive, communicates with NestJS API |
| Database | PostgreSQL | Hosted on bare metal (not containerized) |
| Payment processing | Stripe | Checkout sessions, payment intents, refunds |
| SMS / messaging | Twilio | Programmable SMS, webhooks for inbound |
| Dynamic pricing | PriceLabs | Integration mechanism TBD (see Open Questions) |
| Calendar sync | iCal (RFC 5545) | Bidirectional — export feed + poll OTA feeds |
| Containerization | Docker Compose | NestJS + Astro containers; Postgres on host |
| Networking | Cloudflare Tunnel | Exposes local server to public internet |
| Language | TypeScript | End-to-end across all layers |

---

## 3. Guest-Facing Website (Astro)

### 3.1 Site Structure

The guest-facing site is a full brand website — not just a booking widget. It serves as the primary online presence for The Owl's Nest, built to rank well in search and convert visitors into direct bookings.

**Pages:**

- **Home** — Hero imagery, value proposition, quick booking entry point, featured reviews, seasonal highlights
- **About** — Property story, brand personality, what makes The Owl's Nest different
- **Gallery** — Photo gallery showcasing the property, backyard, design details, and surrounding landscape
- **Area Guide** — Central Oregon attractions, Smith Rock, Crooked River Gorge, local restaurants, seasonal events. Structured as browsable content (not just a list)
- **Reviews** — Guest reviews from direct bookings + curated OTA reviews
- **Book** — Full booking flow (calendar, pricing, inquiry/account creation, checkout)
- **Blog** — SEO-driven content: local guides, seasonal activity posts, event coverage, travel tips
- **House Rules** — Pre-booking transparency on property rules
- **FAQ** — Common questions about the property and area

### 3.2 Design Direction

All visual design should follow The Owl's Nest Brand Guide:

- Color palette rooted in high desert golden hour (Desert Gold, Juniper Dark, Canyon Terracotta, Sage Green, Dusk Purple, Soft Sand, Warm Cream)
- Typography and layout inspired by vintage travel posters meets modern web design
- Photography-forward with golden hour lighting
- Warm, inviting, retro-cool aesthetic — not generic vacation rental template

### 3.3 Content Management

Blog posts and editable page content are managed through the admin dashboard:

- Admin provides a rich text / markdown editor for creating and editing posts
- Each post has a **draft** and **published** state
- Clicking **Publish** (or unpublish) triggers an Astro site rebuild
- Rebuild mechanism: admin hits a NestJS endpoint → NestJS runs `astro build` inside the Astro Docker container (via Docker exec or a build webhook)
- Blog posts stored in PostgreSQL, rendered to Markdown/MDX files at build time
- Area guide content follows the same content management flow

### 3.4 SEO Requirements

- Server-rendered static HTML (Astro's default)
- Proper meta tags, Open Graph, structured data (vacation rental schema)
- Sitemap generation
- Clean URLs (`/blog/best-hikes-near-redmond` not `/blog?id=123`)
- Image optimization (Astro's built-in image handling)
- Fast load times (Astro ships minimal JS by default)

---

## 4. Booking Engine

### 4.1 Booking Flow

The booking flow is designed to give the owner screening control while maintaining a professional guest experience.

**Step 1 — Browse Availability**

- Guest visits the Book page
- Sees a calendar displaying available dates with per-night pricing
- Pricing is driven by PriceLabs integration (dynamic) with manual override capability
- Blocked dates (OTA bookings via iCal, direct bookings, manual blocks) shown as unavailable
- Minimum stay requirements enforced visually and at submission

**Step 2 — Select Dates & Review Pricing**

- Guest selects check-in and check-out dates
- System displays pricing breakdown:
  - Nightly rate × number of nights (cleaning fee baked into nightly rate, not shown as line item)
  - Transient Lodging Tax (TLT) — auto-calculated per Oregon/Deschutes County rates
  - Total
- Guest count selector (max 4 guests)

**Step 3a — Inquiry (No Account Required)**

- Guest can submit an inquiry without creating an account
- Fields: name, email, phone number, selected dates, optional message
- Inquiry is visible in admin dashboard
- Owner can respond via SMS or convert to a booking request

**Step 3b — Request to Book (Account Required)**

- Guest creates an account (magic link auth via email) or logs in
- Submits a booking request for selected dates
- Guest provides: full name, email, phone, number of guests, optional message
- Account stores guest info for repeat bookings

**Step 4 — Owner Approval**

- Booking request appears in admin dashboard
- Owner reviews guest details
- Owner approves or declines the request
- On approval: system sends guest a Stripe payment link via SMS and/or email
- On decline: system sends a polite decline notification

**Step 5 — Payment & Confirmation**

- Guest completes payment via Stripe (card on file for potential damage charges)
- On successful payment: booking is confirmed
- System sends booking confirmation with reservation details
- iCal feed updated → OTA calendars sync blocked dates
- Cleaner assignment flow becomes available for this reservation's checkout date

### 4.2 Pricing

| Component | Details |
|---|---|
| Nightly rate | Set dynamically via PriceLabs, with manual override in admin |
| Cleaning fee | Set as a fixed amount in admin; baked into the displayed nightly rate (not a separate line item) |
| Taxes | Transient Lodging Tax (TLT) auto-calculated and added as a line item |
| Pet fee | None |
| Security deposit | None — Stripe card on file provides recourse |
| Minimum stay | Configurable in admin (enforced on calendar) |

### 4.3 Cancellation Policy

Tiered cancellation policy applied automatically to direct bookings:

| Window | Refund |
|---|---|
| 30+ days before check-in | Full refund |
| 14–29 days before check-in | 50% refund |
| Less than 14 days before check-in | No refund |

Cancellation tier thresholds should be configurable in admin. Refunds processed automatically via Stripe when owner approves a cancellation.

### 4.4 Guest Accounts

- **Authentication:** Magic link (passwordless) via email
- **Flow:** Guest enters email → receives a time-limited, single-use link → clicks to authenticate
- **Session:** JWT or session cookie with reasonable expiry
- **Account stores:** Name, email, phone, booking history, saved preferences
- **Repeat guests:** Logged-in guests skip the info entry step when booking
- **No account required for:** Browsing, viewing availability/pricing, submitting inquiries

### 4.5 Additional Payment Requests

A booking is not necessarily a single payment. The platform models payments as a one-to-many relationship (`Booking → BookingCharge[]` per D-020) so the owner can send additional payment requests without having to create new bookings or work around the data model.

**Charge kinds:**

| Kind | When |
|---|---|
| `initial` | The first payment when a booking is approved (M7) — the original deposit / full price |
| `extension` | Additional nights added to an existing booking (see §4.6) |
| `damage` | Post-stay damage assessed against the card on file |
| `incidental` | Late check-out, accidental pet, broken-thing replacement, etc. |

**Admin-side flow (M8):**

1. Admin opens any booking in the dashboard
2. Clicks "Send payment request"
3. Picks a kind, enters an amount + description ("HVAC service called for guest stay", "Late check-out fee", etc.)
4. System creates a `BookingCharge`, generates a Stripe Checkout Session, sends the link via SMS + email
5. Webhook flips the charge status to `succeeded` on payment

The same `stripeCustomerId` carries across charges so the guest's saved payment method (card on file) can be used for off-session charges where appropriate (PRD §11.1).

### 4.6 Stay Extensions

Common case: a guest is staying or about to stay and wants to add nights. As long as the requested nights are available, the owner can extend the booking.

**Flow (admin-driven, V1):**

1. Guest contacts owner (SMS, email, or in-person — no dedicated guest UI in V1)
2. Owner opens the booking, checks the calendar for availability of the additional nights
3. Owner uses **"Modify dates"** (M8) to extend `checkOut`
4. System recalculates booking totals (subtotal + tax) for the new date range
5. System suggests the delta amount; owner confirms and clicks **"Send payment request"** (the §4.5 ad-hoc flow)
6. A new `BookingCharge` of `kind='extension'` is created and a payment link goes to the guest
7. On payment success: booking dates are confirmed extended; iCal export feed reflects the new range; cleaner waterfall (if scheduled) is rescheduled

Self-service guest extensions (a "request extension" button in a future guest portal) are deferred — when that lands, it composes the same primitives.

### 4.7 Discount & Promo Infrastructure (Deferred)

Not in V1, but the data model and booking engine should be built to support:

- Promo codes (percentage or fixed discount)
- Repeat guest discounts
- Seasonal promotions
- The booking flow should have a "promo code" field that is hidden/disabled until this feature is activated

---

## 5. Calendar Sync (iCal)

### 5.1 Overview

The platform is the source of truth for availability. It syncs with OTA platforms via iCal (RFC 5545), which is the standard supported by all major booking platforms without requiring API partnerships.

### 5.2 Export (Platform → OTAs)

- The platform generates an iCal feed URL (e.g., `https://owlsnest.com/calendar.ics`)
- This feed contains all blocked dates: confirmed direct bookings, manually blocked dates, and maintenance blocks
- Each OTA (Airbnb, VRBO, future Booking.com, Google) imports this feed
- Feed updates immediately when a booking is confirmed or dates are manually blocked

### 5.3 Import (OTAs → Platform)

- Admin configures iCal feed URLs from each OTA (Airbnb provides one, VRBO provides one, etc.)
- NestJS background job polls each OTA feed on a configurable interval (default: every 15 minutes)
- Imported events block corresponding dates on the platform's availability calendar
- iCal events carry only date ranges (no guest details) — this is a known limitation
- OTA bookings appear on the admin calendar as "External Booking (Airbnb)" etc.

### 5.4 Double-Booking Prevention

Because iCal sync has a 15–30 minute delay, the request-to-book flow (owner manually approves) serves as the primary safeguard against double bookings. The owner can see the full calendar state (including recently imported OTA blocks) before approving.

Additionally:

- When a booking request comes in, the system checks against both direct bookings AND the latest imported iCal data
- If a conflict is detected, the system flags it to the owner during the approval step
- A manual "sync now" button in admin allows the owner to force-poll all iCal feeds before approving

### 5.5 Supported Platforms

| Platform | Status | Sync Direction |
|---|---|---|
| Airbnb | V1 | Bidirectional (import + export) |
| VRBO | V1 | Bidirectional (import + export) |
| Booking.com | Future | Bidirectional |
| Google Vacation Rentals | Future | Bidirectional |

---

## 6. Cleaner Management

### 6.1 Cleaner Roster

- Admin maintains a list of cleaners with: name, phone number, priority rank
- Priority rank determines the order in which cleaners are contacted for assignments
- Cleaners do NOT have accounts or logins — they interact via SMS and unique URLs

### 6.2 Assignment Workflow

**Step 1 — Identify Turnovers**

- Admin views the calendar in the dashboard
- Checkout dates that need a cleaner assigned are highlighted
- Standard turnover window: 11:00 AM checkout → 3:00 PM check-in (4-hour window)

**Step 2 — Trigger SMS Request**

- Admin clicks a "Request Cleaner" button on a specific turnover date
- System sends an SMS to the highest-priority cleaner:
  - Message includes: date, property name, turnover window, and accept/decline links
  - Links point to the NestJS API (e.g., `https://owlsnest.com/cleaner/respond?token=abc&action=accept`)

**Step 3 — Waterfall Logic**

- If the cleaner clicks **Accept**: assignment is confirmed, admin is notified
- If the cleaner clicks **Decline**: system automatically sends the same request to the next cleaner in priority order
- If the cleaner does not respond within a configurable timeout (default: 2 hours): system escalates to the next cleaner and notifies admin
- Process continues until a cleaner accepts or the roster is exhausted
- If all cleaners decline/timeout: admin is notified to handle manually

**Step 4 — Confirmation**

- Once a cleaner accepts, the turnover appears on their unique URL page
- Admin sees the confirmed assignment in the dashboard

### 6.3 Cleaner Portal (Unique URLs)

Each cleaner has a unique, tokenized URL (no login required) that shows:

- List of their upcoming assigned turnover dates
- Property address
- Check-out and check-in times for each turnover
- Any special instructions the admin has added

URL format: `https://owlsnest.com/cleaner/<unique-token>`

Tokens are long-lived but revocable by the admin.

### 6.4 Turnover Status

The owner verifies turnover completion manually. No cleaner-side status updates in V1.

Admin dashboard shows turnover status as:

| Status | Meaning |
|---|---|
| Unassigned | Checkout date exists, no cleaner assigned |
| Requested | SMS sent, waiting for cleaner response |
| Assigned | Cleaner has accepted |
| Complete | Owner has manually marked as complete |

---

## 7. Guest Messaging

### 7.1 Overview

Two-way SMS messaging between the owner and guests via Twilio. Messages are sent from a dedicated Twilio phone number that serves as The Owl's Nest's business line.

### 7.2 Sending Messages

- Admin selects a guest from the booking/guest list
- Default message template pre-populates based on message type
- Admin can edit/personalize the message before sending
- Message is sent via Twilio SMS to the guest's phone number
- Sent message is logged in the conversation thread

### 7.3 Message Templates

Admin maintains saved templates for common message types. Templates are editable in admin settings. Suggested defaults:

| Template | Trigger | Example Content |
|---|---|---|
| Booking Confirmed | After payment received | Confirmation details, next steps |
| Pre-Arrival | 1–2 days before check-in | Check-in instructions, access code, local tips |
| Post-Stay | Day after checkout | Thank you, review request |

Templates support variable interpolation (e.g., `{{guest_name}}`, `{{checkin_date}}`, `{{access_code}}`).

All messages are sent manually by the admin — no automated triggers in V1. The admin selects the template, optionally personalizes it, and clicks send.

### 7.4 Inbound Messages

- Guests can reply to the Twilio number
- Inbound messages are received via Twilio webhook → NestJS endpoint
- Messages are matched to the guest's phone number and added to their conversation thread
- Admin sees inbound messages in the messaging section of the dashboard
- Admin is notified of new inbound messages (notification mechanism TBD — could be browser notification, SMS to admin, or polling)

### 7.5 Conversation View

The admin dashboard shows a threaded conversation view per guest:

- All sent and received messages in chronological order
- Timestamp and direction (sent/received) for each message
- Quick-reply with template or freeform text
- Link to the associated booking

---

## 8. Admin Dashboard (React)

### 8.1 Overview

A React single-page application, fully responsive for web and mobile use. The admin dashboard is the primary operational interface for managing all aspects of the property.

### 8.2 Authentication

Admin auth is separate from guest auth. Simple session-based login with email + password (single admin user). Potentially expandable to multiple admin users in the future.

### 8.3 Dashboard Views

**Calendar View (Home)**

- Month/week view showing all bookings, blocked dates, and turnover assignments
- Color-coded by type: direct booking, OTA booking (Airbnb, VRBO, etc.), manual block, turnover
- Click a booking to see details
- Click an unassigned turnover to trigger cleaner request

**Bookings**

- List of all bookings (past, current, upcoming) with filters and search
- Booking detail view: guest info, dates, pricing breakdown, payment status, cancellation policy, messaging thread, source (direct vs. OTA)
- Pending approval queue for request-to-book flow
- Actions: approve, decline, cancel (with refund per cancellation tier), modify dates

**Inquiries**

- List of inquiries submitted without accounts
- Convert inquiry to booking request
- Reply via SMS

**Cleaners**

- Cleaner roster management (add, edit, remove, reorder priority)
- Turnover calendar showing assigned/unassigned/requested/completed status
- Trigger cleaner request for specific dates
- View SMS request history and responses

**Messaging**

- Conversation threads organized by guest
- Template management (create, edit, delete templates)
- Compose new message (select guest, select template or freeform)
- Inbound message notifications

**Content**

- Blog post editor (rich text or markdown)
- Draft/published status management
- Publish button triggers Astro rebuild
- Area guide content management
- Photo/media management for gallery

**Reviews**

- List of all reviews (direct + curated OTA)
- Add new review (manual entry for OTA reviews)
- Toggle visibility (show/hide on guest site)
- Direct reviews collected post-stay (linked from post-stay SMS)

**Financials**

- Revenue dashboard: monthly/quarterly/yearly totals, trend charts
- Per-booking financial breakdown:
  - Nightly rate × nights
  - Cleaning fee (internal tracking, even though baked into rate)
  - Taxes collected (TLT)
  - Stripe processing fees
  - Net revenue
- Booking source breakdown (direct vs. each OTA)
- Export capability (CSV for tax/accounting purposes)

**Settings**

- Property details (name, address, check-in/out times, max guests)
- Pricing: base nightly rate, cleaning fee amount, minimum stay rules
- Tax rates (TLT percentage, configurable)
- Cancellation policy tier thresholds
- iCal feed management (add/remove OTA feeds, set polling interval, manual sync)
- Twilio configuration
- Stripe configuration
- PriceLabs configuration
- Promo code management (infrastructure present, feature deferred)

---

## 9. Financial Reporting

### 9.1 Revenue Dashboard

The dashboard provides at-a-glance financial visibility:

- Total revenue (selectable time period)
- Average nightly rate
- Occupancy rate
- Average booking value
- Revenue by source (direct, Airbnb, VRBO, etc.) — note: OTA revenue is manually entered or estimated since iCal doesn't include pricing data

### 9.2 Per-Booking Financials

Each booking record tracks:

| Field | Description |
|---|---|
| Nightly rate | Rate charged per night |
| Number of nights | Duration of stay |
| Subtotal | Nightly rate × nights |
| Cleaning fee | Internal cost tracking (baked into rate for guest) |
| TLT collected | Tax amount charged to guest |
| Stripe fees | Processing fee deducted by Stripe |
| Net revenue | Subtotal + TLT − Stripe fees (or subtotal − Stripe fees if tracking revenue excluding tax) |
| Booking source | Direct, Airbnb, VRBO, etc. |
| Payment status | Pending, paid, partially refunded, fully refunded |

### 9.3 Export

- CSV export of all bookings with financial data for a selected date range
- Useful for tax filing and accountant handoff

---

## 10. Reviews

### 10.1 Direct Reviews

- After checkout, the post-stay SMS template includes a link to leave a review
- Review form: star rating (1–5), written review, guest name
- Reviews are submitted and held for admin approval before appearing on the site
- Admin can approve, hide, or delete reviews

### 10.2 Curated OTA Reviews

- Admin manually copies select reviews from Airbnb, VRBO, etc.
- Entry form: guest name, platform source, star rating, review text, date
- Displayed on the reviews page alongside direct reviews with platform attribution

---

## 11. Integrations

### 11.1 Stripe

| Feature | Implementation |
|---|---|
| Payment collection | Stripe Checkout Sessions per `BookingCharge` row — initial deposit, extension, damage, incidental (per §4.5 / D-020). Link sent via SMS + email. |
| Card on file | Stored via Stripe Customer objects on `Booking.stripeCustomerId`; reused for off-session charges (extensions, damage). |
| Multiple charges per booking | One booking can have many `BookingCharge` rows. Each has its own `stripePaymentIntentId`, status, and per-charge `stripeFee` for accurate financial reporting. |
| Refunds | Per-charge: `BookingCharge.refundedAmount` tracks partial/full refunds. Cancellation tiers apply to the `initial` charge automatically; admin-triggered refunds for any other charge. |
| Webhooks | `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`. Idempotent on `event.id` via the `WebhookEvent` table. |
| Fee tracking | Stripe fee data pulled per charge into `BookingCharge.stripeFee` for financial reporting (M4.2). |

### 11.2 Twilio

| Feature | Implementation |
|---|---|
| Outbound SMS (guests) | Programmable SMS from dedicated Twilio number |
| Outbound SMS (cleaners) | Turnover request messages with accept/decline links |
| Inbound SMS | Webhook endpoint receives guest replies |
| Phone number | Single Twilio number serves as The Owl's Nest business line |

### 11.3 PriceLabs

**Status: Requires research spike.**

PriceLabs typically pushes pricing data to channel managers (Beds24, Guesty, etc.) via their API. Since this platform is a custom booking engine (not a recognized channel manager), the integration approach needs investigation.

Possible approaches:

- **PriceLabs Direct API** — PriceLabs may offer an API for custom integrations to pull pricing data
- **PriceLabs CSV export** — Manual or scheduled import of pricing data from CSV
- **PriceLabs webhook** — If PriceLabs supports pushing to a custom endpoint
- **Alternative provider** — Evaluate other dynamic pricing tools with better custom integration support (Wheelhouse, Beyond, DPGO)

**Action item:** Research PriceLabs API documentation and reach out to their support to determine the best integration path for a custom booking engine.

**Fallback:** Manual price management in admin with seasonal rate rules until dynamic pricing integration is resolved.

---

## 12. Data Model (High Level)

### Core Entities

```
Property
├── id, name, address, check_in_time, check_out_time, max_guests
├── base_nightly_rate, cleaning_fee, min_stay
├── tax_rate_percentage
└── cancellation_policy (JSON: tier thresholds + refund percentages)

Booking
├── id, property_id, guest_id (nullable for OTA bookings)
├── check_in, check_out, num_guests
├── status (inquiry | pending_approval | approved | confirmed | cancelled | completed)
├── source (direct | airbnb | vrbo | booking_com | google)
├── nightly_rate, num_nights, subtotal, cleaning_fee_internal
├── tax_amount, stripe_fee, net_revenue
├── stripe_payment_intent_id, stripe_customer_id
├── cancellation_tier_applied, refund_amount
└── created_at, updated_at

Guest
├── id, name, email, phone
├── magic_link_token, token_expires_at
├── created_at, last_login
└── → bookings (one-to-many)

Inquiry
├── id, name, email, phone
├── check_in, check_out, message
├── status (new | responded | converted | closed)
├── converted_booking_id (nullable)
└── created_at

Cleaner
├── id, name, phone, priority_rank
├── unique_token (for portal URL)
├── active (boolean)
└── → turnover_assignments (one-to-many)

TurnoverAssignment
├── id, booking_id, cleaner_id (nullable until assigned)
├── date, checkout_time, checkin_time
├── status (unassigned | requested | assigned | completed)
├── special_instructions
├── request_history (JSON: [{cleaner_id, sent_at, responded_at, response}])
└── created_at, updated_at

Message
├── id, guest_id, booking_id (nullable)
├── direction (inbound | outbound)
├── body, template_id (nullable)
├── twilio_sid
├── sent_at, delivered_at
└── created_at

MessageTemplate
├── id, name, type (confirmation | pre_arrival | post_stay | custom)
├── body (with {{variable}} placeholders)
├── is_default (boolean)
└── created_at, updated_at

BlogPost
├── id, title, slug, body (markdown)
├── excerpt, featured_image_url
├── status (draft | published)
├── published_at
├── seo_title, seo_description
└── created_at, updated_at

Review
├── id, guest_name, platform (direct | airbnb | vrbo | booking_com)
├── rating (1-5), body
├── booking_id (nullable, for direct reviews)
├── visible (boolean)
├── review_date
└── created_at

CalendarSync
├── id, platform (airbnb | vrbo | booking_com | google)
├── ical_import_url
├── last_synced_at
├── sync_interval_minutes
└── active (boolean)

BlockedDate
├── id, property_id
├── start_date, end_date
├── reason (manual_block | maintenance | oта_booking)
├── source_platform, source_event_uid
└── created_at

PricingOverride
├── id, date
├── nightly_rate (overrides PriceLabs/base rate for this date)
├── min_stay_override (nullable)
└── created_at, updated_at

PromoCodes (deferred — schema only)
├── id, code, discount_type (percentage | fixed)
├── discount_value, valid_from, valid_to
├── max_uses, current_uses, active
└── created_at
```

---

## 13. Infrastructure & Deployment

### 13.1 Deployment Architecture

```
Local Server (Host Machine)
├── PostgreSQL (installed directly on host)
├── Docker Compose
│   ├── nestjs-api (NestJS application container)
│   ├── astro-site (Astro build + static file serving container)
│   └── (optional: nginx reverse proxy container)
└── Cloudflare Tunnel (exposes services to public internet)
```

### 13.2 Docker Compose Services

| Service | Purpose | Notes |
|---|---|---|
| `nestjs-api` | API server, background jobs (iCal polling, SMS timeout handling) | Connects to host Postgres via `host.docker.internal` or host network |
| `astro-site` | Serves pre-built static files (nginx or similar) | Rebuilt on publish via admin trigger |
| `nginx` (optional) | Reverse proxy, SSL termination | May be handled by Cloudflare Tunnel instead |

### 13.3 Cloudflare Tunnel

- Routes public traffic from the domain to the local server
- Handles SSL termination
- Provides DDoS protection and caching for static assets
- Domain DNS pointed to Cloudflare

### 13.4 Background Jobs

The NestJS application runs several scheduled/background tasks:

| Job | Frequency | Description |
|---|---|---|
| iCal import polling | Every 15 min (configurable) | Fetches and parses iCal feeds from each OTA |
| Cleaner request timeout | Event-driven (check every 5 min) | Escalates to next cleaner if no response within timeout window |
| Magic link cleanup | Daily | Expires old/unused magic link tokens |
| Astro rebuild | On-demand (admin trigger) | Runs `astro build` when content is published |

### 13.5 Backups

- PostgreSQL: scheduled `pg_dump` to local backup directory + offsite (cloud storage or rsync to remote)
- Frequency: daily full backup, consider WAL archiving for point-in-time recovery
- Uploaded media/images: included in backup routine

---

## 14. Phasing Plan

### Phase 1 — Foundation (MVP)

Core booking engine and guest site with essential operational tools.

**Guest Site:**
- Home, About, Gallery, Book, House Rules pages
- Booking calendar with manual pricing (no PriceLabs yet)
- Inquiry submission (no account required)
- Request-to-book flow with Stripe payment

**Admin Dashboard:**
- Booking management (approve/decline, calendar view)
- Manual pricing and availability management
- Basic settings (property info, check-in/out times, min stay, tax rate)
- iCal export feed

**Infrastructure:**
- Docker Compose setup with Cloudflare Tunnel
- PostgreSQL schema and migrations
- Stripe integration (payment links, webhooks)
- Admin authentication

### Phase 2 — Operations

Cleaner management, guest messaging, and iCal import.

**Cleaner Management:**
- Cleaner roster with priority ranking
- SMS request waterfall via Twilio
- Accept/decline link handling
- Cleaner portal (unique URLs)
- Turnover status tracking in admin

**Guest Messaging:**
- Two-way SMS via Twilio
- Message templates with variable interpolation
- Conversation thread view in admin
- Inbound message handling (webhooks)

**Calendar Sync:**
- iCal import from Airbnb and VRBO
- Polling job with configurable interval
- Conflict detection on booking approval

### Phase 3 — Content & Growth

Blog, reviews, guest accounts, and dynamic pricing.

**Content:**
- Blog post editor and management in admin
- Publish → rebuild flow
- Area guide content management
- SEO optimization (structured data, sitemap)

**Reviews:**
- Direct review collection (post-stay link)
- Curated OTA review entry
- Review display on guest site

**Guest Accounts:**
- Magic link authentication
- Booking history for repeat guests
- Streamlined re-booking flow

**Dynamic Pricing:**
- PriceLabs integration (or alternative, based on research spike)
- Pricing override management in admin

### Phase 4 — Polish & Scale

Financial reporting, additional OTA support, and deferred features.

**Financials:**
- Revenue dashboard with charts
- Per-booking financial breakdown
- CSV export for accounting
- Booking source analytics

**Expanded OTA Support:**
- Booking.com iCal sync
- Google Vacation Rentals iCal sync

**Deferred Features (when ready):**
- Promo codes and discount infrastructure
- Automated message triggers (optional)
- Cleaner checklists and photo capture
- Multi-property support architecture

---

## 15. Open Questions & Research Spikes

| # | Question | Impact | Priority |
|---|---|---|---|
| 1 | **PriceLabs integration path** — Does PriceLabs offer a direct API for custom booking engines? What are the alternatives if not? | Pricing automation, Phase 3 | High |
| 2 | **Oregon TLT rates** — What are the exact transient lodging tax rates for Redmond/Deschutes County? Are there city + county + state layers? | Tax calculation accuracy, Phase 1 | High |
| 3 | **iCal sync reliability** — What is the actual polling frequency and delay for Airbnb/VRBO iCal feeds? Do they rate-limit requests? | Double-booking risk, Phase 2 | Medium |
| 4 | **Twilio number strategy** — Single number for both guest messaging and cleaner requests? Or separate numbers? | Messaging architecture, Phase 2 | Medium |
| 5 | **Admin notification mechanism** — How should the admin be notified of new inquiries, inbound messages, and cleaner responses? (Push notification, SMS to admin, browser notification, email) | Admin responsiveness, Phase 2 | Medium |
| 6 | **Review scraping feasibility** — If manual OTA review curation becomes too tedious, are there legal/compliant third-party services that aggregate reviews? | Review management efficiency, Phase 3 | Low |
| 7 | **Stripe Connect vs. standard** — Is Stripe Connect needed for future multi-property support, or is a standard Stripe account sufficient? | Payment architecture, Phase 1 | Low |
| 8 | **Astro rebuild performance** — How long does an Astro rebuild take with blog content from the DB? Does it need an incremental build strategy? | Content publishing UX, Phase 3 | Low |

---

## 16. Non-Functional Requirements

### Performance
- Guest site pages load in under 2 seconds (Astro static + Cloudflare caching)
- Booking calendar renders availability within 1 second
- iCal feed generation responds in under 500ms
- Admin dashboard loads core views within 2 seconds

### Security
- All traffic over HTTPS (Cloudflare Tunnel)
- Magic link tokens: cryptographically random, single-use, 15-minute expiry
- Cleaner portal tokens: long-lived, revocable, non-guessable
- Stripe payment data never touches the platform's database (handled by Stripe)
- Admin session management with secure cookies
- Rate limiting on auth endpoints and public API routes
- Input sanitization on all forms

### Reliability
- Database backups: daily automated with offsite copy
- iCal sync: retry logic with exponential backoff on failures
- Twilio SMS: delivery status tracking, retry on failure
- Graceful degradation: if PriceLabs is unavailable, fall back to manual/base pricing

### Monitoring
- Application-level logging (NestJS built-in logger)
- Background job health monitoring (iCal sync last-run, success/failure)
- Stripe webhook processing monitoring
- Disk space and database connection monitoring on host

---

*End of PRD — The Owl's Nest Platform v1.0*