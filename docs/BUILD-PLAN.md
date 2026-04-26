# Build Plan & Progress Tracker

Single source of truth for "where are we in the buildout." Each phase has milestones; each milestone has acceptance criteria. Update this file when a milestone starts, completes, or its scope changes.

**Status legend:** `⬜ Not started` · `🟡 In progress` · `✅ Complete` · `⏸ Blocked`

---

## Current focus

> **Now:** ✅ M6 complete — ready for M7
> **Next up:** M7 — Request-to-book + Stripe Checkout
> **Open carryovers:** see [`CARRYOVERS.md`](CARRYOVERS.md) — small loose ends not tied to a single milestone (deploy items, deferred infra, conditional refactors).

Last updated: 2026-04-25 (after M6; 281 tests passing)

---

## ⚠️ Testing requirement (READ THIS FIRST)

**Every module and feature requires BOTH unit tests AND end-to-end tests.** Not "unit OR e2e" — both. A milestone is not ✅ until:

1. **Unit tests** cover the pure logic of every new service / hook / schema / utility (target: every public method or branch).
2. **E2E tests** cover every new HTTP endpoint, every user-visible flow, and every state transition (auth, booking lifecycle, etc.).
3. **Both run green in `pnpm test:all`** before the milestone status flips to ✅.

If a feature has no testable behavior at either level (rare — usually pure config), document why in the milestone notes.

The full discipline (what to write, where it lives, runners, hooks) is detailed at the bottom of this file: § "Testing discipline".

---

## Phase 0 — Planning & Architecture

| ID | Milestone | Status |
|---|---|---|
| P0.1 | PRD written | ✅ |
| P0.2 | Supplemental plans (PriceLabs / Tax / Calendar Sync) | ✅ |
| P0.3 | Architecture document | ✅ |
| P0.4 | Decision log seeded (D-001 → D-019) | ✅ |
| P0.5 | Scaffolding plan | ✅ (folded into M1 directly — no separate doc needed) |

---

## Phase 1 — Foundation (MVP direct-booking engine)

**Goal:** Property can take direct bookings end-to-end.

### M1 — Monorepo skeleton
**Status:** ✅ Complete

- [x] pnpm workspace root, `apps/*` and `packages/*` wired
- [x] `apps/api` (NestJS) boots with health endpoint
- [x] `apps/web` (Astro) renders placeholder homepage
- [x] `apps/admin` (Vite + React + React Router v6) renders shell
- [x] `apps/build-worker` builds; consumes BullMQ job stub
- [x] `packages/shared` exports a Zod schema both api + web import
- [x] `packages/prisma` — schema covers all V1 entities (incl. Outbox, WebhookEvent, AuditLogEntry, CleanerRequestToken, TaxJurisdiction, PricingCacheEntry)
- [x] `prisma migrate dev` runs cleanly against host Postgres
- [x] Seed script populates Property + 2 TaxJurisdictions + default MessageTemplates + AdminUser placeholder
- [x] Docker Compose runs Redis + api + web + admin + build-worker; `media` and `web-dist` volumes mounted per ARCHITECTURE.md §11.1
- [x] `.env.example` complete; api env validated by Zod at boot

**Acceptance:** `pnpm install && pnpm -r run build` succeeds for all four apps + both packages. API `node dist/main.js` boots and `curl http://localhost:3000/health` → 200 with `{"status":"ok","uptime":...}`. Web and admin produce static `dist/` output. Verified 2026-04-25.

All M1 acceptance criteria pass. Postgres `owlsnest` role + database created on host; migration applied; seed verified.

**Tests:** `apps/api/test/health.e2e-spec.ts` covers the `/health` endpoint.

---

### M2 — Admin auth (login + TOTP)
**Status:** ✅ Complete

- [x] `AuthModule` admin login endpoint (Argon2id)
- [x] TOTP enrollment + verification flow (otplib v13 + QR code data URL)
- [x] Recovery codes generated and hashed at rest (10 codes, single-use, hashed with Argon2id)
- [x] Redis-backed session with MemoryStore fallback for dev; `__Host-admin-session` cookie in prod, `admin_session` in dev
- [x] CSRF middleware (csrf-csrf double-submit, session-bound, auto-rotated on session regenerate)
- [x] Admin SPA: login page, TOTP entry page, recovery-code redemption, first-time setup flow
- [x] Lockout after 5 failed attempts (per account, 15-min lock)
- [x] AuditLogEntry on every auth event (login.success/failed/locked, totp.success/failed, recovery.success/failed, logout, setup.password, setup.totp.enrolled)

**Acceptance:** all 8 criteria pass via /tmp/m2-e2e.mjs end-to-end script:
- setup password → TOTP enrollment → 10 recovery codes generated
- login → TOTP verify → whoami returns session user
- logout → whoami returns 401
- 5 wrong passwords → 6th attempt 403 (locked)
- recovery code login works; same code rejected on second use

Verified 2026-04-25.

**Carryovers:** tracked centrally in [`CARRYOVERS.md`](CARRYOVERS.md):
- CO-1 (Redis on host or Compose) — open
- CO-9 (CSRF error envelope unification) — ✅ resolved 2026-04-25

**Tests:**
- Unit: `apps/api/src/auth/password.service.spec.ts`, `totp.service.spec.ts`, `lockout.service.spec.ts` (18 tests).
- E2E: `apps/api/test/auth.e2e-spec.ts` covers full setup → login → TOTP → whoami → logout cycle, /setup conflict, wrong password, invalid TOTP, lockout, recovery code single-use, audit log writes, CSRF rejection (8 tests).
- Frontend: `apps/admin/src/pages/Login.test.tsx` (component sanity, 2 tests).

---

### M3 — Property settings + manual pricing/availability
**Status:** ✅ Complete

- [x] `PropertyModule` settings CRUD (name, address, check-in/out, max guests, pricing, cancellation policy)
- [x] `PricingModule` — manual base rate + min-stay + cleaning fee → public `/api/v1/pricing/quote`
- [x] `BlockedDate` manual block CRUD; admin date-range picker; OTA-imported blocks correctly read-only
- [x] `TaxModule` — per-jurisdiction calculation (Oregon State 1.5% + Redmond City 9%) with 30-night exemption + Oregon round-down rule
- [x] `/api/v1/pricing/quote` returns breakdown matching `loging-tax-plan.md` §5.3 (3 nights × $175 + $75 cleaning + tax = $663)
- [x] **Unit tests** — `PropertyService` (6), `PricingService` (5), `TaxService` (8), `BlockedDateService` (8) — 27 unit tests added
- [x] **E2E tests** — pricing quote (7), property GET/PATCH (6), blocked-date CRUD (7) — 20 e2e tests added
- [x] **Admin component tests** — `PropertySettings` (3), `BlockedDates` (3) — 6 component tests added
- [x] **Schema tests** — `Property` (21), `BlockedDate` (8) — 29 schema tests added
- [x] `pnpm test:all` green (129 tests total at M3 completion; 146 after the CSRF envelope fix that landed immediately after)

**Acceptance:** all checklist items pass; smoke test confirms API serves both endpoints with correct payloads. Verified 2026-04-25.

**Notes:**
- CSRF protection extended to all non-GET `/api/v1/*` (was admin-only); booking inquiry / request endpoints will inherit this when they land in M6/M7.
- `AuditLogEntry.action` enum extended with `property.update`, `blocked_date.create`, `blocked_date.delete`, plus forward-looking `booking.*` actions.
- New TestClient methods (`patch`, `delete`) plus `enrollAdmin` + `signIn` helpers — used by every auth-gated e2e test from here on.
- `PricingOverride` table exists in the schema but isn't wired up; per-date manual overrides + PriceLabs cache come in M3.10/M3.9 (Phase 3).

---

### M4 — iCal export feed
**Status:** ✅ Complete

**Why this scope is so narrow:** The export is consumed by OTAs (Airbnb, VRBO, future Booking.com / Google). Each OTA holds its own bookings authoritatively and syncs *between* the OTAs by importing every other OTA's feed in addition to ours. Our feed therefore needs to carry only the **direct** bookings + manual/maintenance blocks the OTAs have no other way of learning about. Re-exporting an OTA-imported booking back to its source OTA causes dashboard duplication; re-exporting it to the *other* OTAs is redundant since they already pull each other's feeds. Either way: don't.

**Inclusion / exclusion rules** (locked in D-015 + `calendar-sync-plan.md` §3.2):

| Source | Include in export? |
|---|---|
| `Booking` where `source = 'direct'` AND `status IN ('approved', 'confirmed', 'completed')` | ✅ |
| `Booking` where `source IN ('airbnb', 'vrbo', 'booking_com', 'google')` | ❌ never (would reflect OTA bookings back to themselves) |
| `BlockedDate` where `reason IN ('manual_block', 'maintenance')` | ✅ |
| `BlockedDate` where `reason = 'ota_booking'` (any `sourcePlatform`) | ❌ never |
| `Booking` where `status IN ('inquiry', 'pending_approval', 'cancelled')` | ❌ |

**Tasks:**

- [x] `CalendarModule` export controller + `CalendarExportService` per `calendar-sync-plan.md` §3
- [x] **Both filters wired:** `Booking.source = 'direct'` AND `BlockedDate.reason IN (manual_block, maintenance)`
- [→] Cloudflare path rewrite for `/calendar.ics` *(carryover CO-2 — production deploy)*
- [x] `Content-Type: text/calendar; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate`, `Content-Disposition: inline; filename="owlsnest-calendar.ics"`, CRLF line endings, `TRANSP:OPAQUE` on every VEVENT, RFC 5545 escaping
- [x] Stable UIDs (`booking-<uuid>@owlsnest.com`, `block-<uuid>@owlsnest.com`) — never regenerated on feed refresh
- [x] Line folding at 75 octets, byte-aware (multibyte safe)
- [x] **Unit tests** — `apps/api/src/calendar/ical.spec.ts` (17 tests covering formatDate, formatDateTime, escapeText, foldLine, buildVEvent, buildVCalendar) + `calendar-export.service.spec.ts` (15 tests covering every inclusion/exclusion branch from the truth table + UID stability)
- [x] **E2E tests** — `apps/api/test/calendar.e2e-spec.ts` (16 tests: response headers, public access, empty calendar, every inclusion path, every exclusion path, mixed scenario asserting exact event count, UID stability across consecutive requests, CRLF + TRANSP:OPAQUE checks)
- [x] `pnpm test:all` green (194 tests total)

**Acceptance:** smoke test confirms feed serializes correctly with mixed direct/OTA rows in the dev DB. Direct bookings + manual blocks present; OTA Booking row absent (no `booking-22222…` UID); OTA-imported BlockedDate rows would be absent if any existed. Verified 2026-04-25.

**Carryovers** (tracked in [`CARRYOVERS.md`](CARRYOVERS.md)):
- CO-2 — Cloudflare path rewrite for `/calendar.ics`
- CO-3 — `webcal.fyi` validator pass

**Notes:**
- iCal helpers (`apps/api/src/calendar/ical.ts`) are a pure-functional module — easy to reuse from M2.9 (iCal import) and any future calendar feature.
- `Booking.checkIn`/`Booking.checkOut` already follow the iCal exclusive-DTEND convention (check-out is the first available day), so no transformation needed.

---

### M5 — Public Astro site (Home / About / Gallery / Book / House Rules)
**Status:** ✅ Complete

- [x] Astro pages aligned with brand (PRD §3.2 — high-desert palette tokenized in `apps/web/src/styles/tokens.css`, vintage-poster-meets-modern type via Playfair Display + system sans)
- [x] Booking calendar React island calling `/api/v1/availability` + `/api/v1/pricing/quote` (`apps/web/src/components/BookingCalendar.tsx` using `react-day-picker` v9)
- [x] Min-stay enforcement on calendar (client-side hint + server-side `MIN_STAY_VIOLATION` rejection)
- [x] TLT line-item display (Oregon Lodging Tax 1.5%, Redmond Lodging Tax 9.0%) in the quote sidebar
- [x] Media volume serving gallery images at `/media/gallery/*` — placeholder gradient cards in M5; real images load from the same paths once provided (no code change needed)
- [x] **Schema tests** — `AvailabilityRequest` + `AvailabilityResponse` (6 tests in `packages/shared`)
- [x] **Unit tests** — `AvailabilityService` (11 tests covering every status filter + same-day turnaround + sort)
- [x] **E2E tests** — `/api/v1/availability` happy path + every filter branch (cancelled excluded, OTA-imports included, validation errors) — 9 tests
- [x] **Astro page render tests** — `apps/web/src/test/pages.test.ts` parses each .astro source for required Site layout, title prop, h1, plus layout-level OG meta tags + nav structure (20 tests)
- [x] **Component tests** — `BookingCalendar` (3 tests: loading state, hydrated form structure, error path)
- [x] `pnpm test:all` green (243 tests total)

**Acceptance:** All 5 pages build successfully (`astro build` produces `index.html` for each route); booking calendar fetches availability + quote and renders the TLT breakdown; quote endpoint output matches admin-calculated values byte-for-byte (verified via shared TaxService). Smoke-tested live: `/api/v1/availability?from=…&to=…` returns the right shape. Verified 2026-04-25.

**Notes:**
- New `AvailabilityService` (in `apps/api/src/calendar/`) is the central "is this range bookable?" service — used by the public calendar and reusable from M7 booking approval (per ARCHITECTURE.md §8.5).
- `AvailabilityService` includes `pending_approval` bookings to hold inventory while owner reviews — prevents double-promising the same dates.
- `apps/web/src/test/pages.test.ts` parses `.astro` source for structure rather than rendering (Astro's container API is still experimental in v4). Astro's `astro build` step in CI proves every page actually compiles.

**Carryovers** (tracked in [`CARRYOVERS.md`](CARRYOVERS.md)):
- CO-10 — Lighthouse perf ≥ 90 on Home (needs production-built site over the network; deferred to deploy checklist)
- Real gallery photography is a content task, not a code carryover.

---

### M6 — Inquiry submission
**Status:** ✅ Complete

- [x] `InquiryModule` POST endpoint with Zod validation (public, no auth/CSRF)
- [x] Astro Book page → `InquiryForm` React island → API (client + server share `InquiryCreateSchema` so validation messages match)
- [x] Admin "Inquiries" view: list, filter by status, expandable detail row, mark responded / close / convert
- [x] Outbox row written in the same Prisma transaction as the inquiry — drained later by the `outbox-drain` worker (M2.x) to fan out admin email + SMS per D-018
- [x] Audit log entries for `inquiry.transition` and `inquiry.convert`
- [x] **Unit tests** — `InquiryService` (13 tests covering create + outbox write + every status transition + every illegal transition + convert + double-convert)
- [x] **E2E tests** — `apps/api/test/inquiry.e2e-spec.ts` (13 tests: public submit without CSRF, validation errors, full admin lifecycle, illegal transitions, double-convert CONFLICT, 404/400 on unknown id)
- [x] **Component tests** — `InquiryForm` (5 tests: structure, client-side date validation, email validation, successful submission, API error display); `InquiriesPage` (3 tests: list rendering, action visibility, filter chips)
- [x] CSRF middleware refactored: public endpoints (currently `POST /api/v1/inquiries`) explicitly excluded since they don't carry session credentials. Forward-looking allowlist for M7's `POST /api/v1/bookings`.
- [x] `pnpm test:all` green (281 tests total)

**Acceptance:** smoke-tested: public POST with no cookies/CSRF → 201 → Inquiry row in DB + Outbox row keyed `inquiry.new:{id}`. Verified 2026-04-25.

**Notes:**
- Audit action enum extended with `inquiry.transition` and `inquiry.convert`.
- CSRF rule moved from "all non-GET /api/v1" to "all non-GET /api/v1 except a public allowlist." Test app mirrors the rule. CORS + Origin checking guards public POSTs.
- Conversion to a real `Booking` row lands in M7 — for now `convert` flips status to `converted` so the inquiry leaves the active queue.

---

### M7 — Request-to-book + Stripe Checkout
**Status:** ⬜ Not started

- [ ] `BookingModule` request → `pending_approval` state
- [ ] Admin approval action: creates a `BookingCharge` of `kind='initial'` (D-020), opens a Stripe Checkout Session against it, sends the payment link via SMS + email
- [ ] Stripe adapter creates/reuses a Stripe Customer keyed on the guest email; saves `Booking.stripeCustomerId` for off-session use later (extensions, damage charges in M8)
- [ ] Webhook handler for `checkout.session.completed` → flips both the `BookingCharge` to `succeeded` and the `Booking` to `confirmed`
- [ ] Webhook handler also pulls and records `BookingCharge.stripeFee` from the matched `BalanceTransaction`
- [ ] Outbox emits confirmation SMS/email + `rebuild-site` job
- [ ] Conflict detection at approval time (calls `AvailabilityService`)
- [ ] `WebhookEvent` idempotency table prevents double-processing
- [ ] **Unit tests** — `BookingService` state machine (every transition allowed + every disallowed transition rejected); `AvailabilityService.checkAvailability()` (no conflict / direct conflict / OTA conflict / same-day turnaround); Stripe adapter (with injected fake) — assert it creates one `BookingCharge` per approval, never two
- [ ] **E2E tests** — full happy path through `POST /api/v1/bookings/request` → admin approve → simulated Stripe webhook → confirmation. Asserts both the booking and the initial charge end up in the right states. Includes: conflict detection at approval; webhook idempotency (same event id processed twice → no duplicate `BookingCharge` rows or side-effects); webhook signature verification rejects bad signatures
- [ ] **Component tests** — public request-to-book form; admin booking-detail view + approval action
- [ ] `pnpm test:all` green

**Acceptance:** Full happy path — guest selects dates → submits request → admin approves → guest pays → confirmation arrives → `BlockedDate` exists → export `.ics` updated. Booking has exactly one `BookingCharge` row of `kind='initial'`, status `succeeded`, with the right Stripe IDs and fee captured.

---

### M8 — Booking management actions (incl. ad-hoc charges + extensions)
**Status:** ⬜ Not started

Five admin actions on an existing booking, all built on top of `BookingCharge` (D-020) so the data model stays uniform:

- [ ] **Decline** — with notification to guest
- [ ] **Cancel** — auto-refund per cancellation tier (configurable thresholds): updates `BookingCharge.refundedAmount` on the `initial` charge, refunds via Stripe, transactionally
- [ ] **Modify dates** — re-quotes price for the new range; if the new total is higher, suggests creating an ad-hoc `extension` charge for the delta; if lower, refunds the difference against the `initial` charge. PRD §4.6 (stay extensions) is this action + send-payment-request composed together.
- [ ] **Send ad-hoc payment request** — new flow per PRD §4.5. Admin picks `kind` (`extension | damage | incidental`), enters amount + description, system creates a `BookingCharge`, opens a Checkout Session, sends the payment link via SMS + email. Saves the `stripeCheckoutSessionId` for status tracking.
- [ ] **Refund any charge** — partial or full refund on a specific `BookingCharge`. Updates `refundedAmount` + writes the Stripe refund event back via webhook.
- [ ] All five actions write AuditLogEntry with before/after JSON
- [ ] **Unit tests** — cancellation tier resolver (every threshold boundary including off-by-one); ad-hoc charge amount validation (positive; reasonable max); extension delta calculator (re-quote new total minus already-paid); per-charge refund-amount calculator
- [ ] **E2E tests** — decline (sends notification, transitions status); cancel at each tier (30+ days = full refund of `initial` charge, 14–29 = 50%, <14 = $0); modify dates that increase total → admin gets prompted to create extension charge; modify dates that decrease total → refund issued against `initial`; ad-hoc charge happy path (creates `BookingCharge`, sends link, webhook flips to `succeeded`); ad-hoc charge for each `kind`; refund failure rolls back DB state; AuditLogEntry written for each action
- [ ] **Component tests** — admin booking-detail action buttons (cancel confirms, modify-dates form, send-payment-request modal with kind picker + amount + description)
- [ ] `pnpm test:all` green

**Acceptance:** All five actions work end-to-end. After M7 + M8 the owner can: take an initial booking; decline/cancel/modify it; send extension or damage charges later. Cancellation tier logic applied to the initial charge; audit log captures every action.

---

**Phase 1 done when:** all M1–M8 ✅ and the property can take a real direct booking from a guest.

### Inter-milestone fixes

Small fixes shipped between milestones that don't fit a milestone scope:

- **2026-04-25 — Unified API error envelope.** Global `ApiExceptionFilter` normalizes every error (domain HttpExceptions, csrf-csrf http-errors, unknown errors) into `{error: {code, message, details?}}`. Resolves the M2 carryover. Adds `BAD_REQUEST` + `CSRF_INVALID` to the shared `ErrorCode` enum. SPA + TestClient retry on `code === 'CSRF_INVALID'` only — no more lenient regex fallbacks. +12 unit + 5 e2e tests.

---

## Phase 2 — Operations (cleaner SMS, guest messaging, iCal import)

**Goal:** Day-to-day operations automated. Status: ⬜ Not started.

Milestones to be detailed (with explicit unit + e2e test checkboxes per the testing discipline rule above) when Phase 1 is ~75% complete. Scope per PRD §14:

- [ ] **M2.1** Cleaner roster + priority ranking
- [ ] **M2.2** Cleaner SMS waterfall via Twilio (BullMQ `cleaner-waterfall` queue)
- [ ] **M2.3** Cleaner accept/decline link handling (`CleanerRequestToken`)
- [ ] **M2.4** Cleaner portal (unique URLs, `CleanerToken`)
- [ ] **M2.5** Turnover status tracking in admin
- [ ] **M2.6** Two-way SMS guest messaging (single Twilio number, inbound routing)
- [ ] **M2.7** Message templates with `{{var}}` interpolation
- [ ] **M2.8** Conversation thread view in admin
- [ ] **M2.9** iCal import — multi-feed architecture (one configurable feed per OTA: Airbnb + VRBO at launch, schema already supports adding Booking.com / Google later). Each feed:
  - Stored as a `CalendarSync` row (URL, platform, sync interval, active flag, last-sync status)
  - Polled independently every 30 min per D-009 (one BullMQ job per feed; failure of one doesn't block the others)
  - Parsed via `node-ical`; events upserted into `BlockedDate` keyed on `(sourceEventUid, calendarSyncId)`; cancellations detected via UID disappearance per `calendar-sync-plan.md` §4.3
  - Zero-event safety check: feed returning 0 events when prior sync had >0 → preserve existing blocks, mark sync as `warning` (not delete)
- [ ] **M2.10** Admin "iCal feeds" settings page — add/edit/remove/toggle each OTA feed; show last-sync status, error message, event count per feed
- [ ] **M2.11** Conflict detection on booking approval (`AvailabilityService.checkAvailability()` reads ALL feeds + direct `Booking` rows + manual blocks)
- [ ] **M2.12** Manual "Sync Now" button — global (poll all feeds) and per-feed

---

## Phase 3 — Content & Growth (blog, reviews, guest accounts, dynamic pricing)

**Goal:** Brand presence + repeat-guest infrastructure + dynamic pricing. Status: ⬜ Not started.

Milestones to be detailed with explicit unit + e2e test checkboxes per the testing discipline rule above. Scope per PRD §14:

- [ ] **M3.1** Blog post editor + publish flow → `rebuild-site` job
- [ ] **M3.2** Area guide content management
- [ ] **M3.3** SEO (structured data, sitemap)
- [ ] **M3.4** Direct review collection (post-stay link)
- [ ] **M3.5** Curated OTA review entry
- [ ] **M3.6** Review display on guest site
- [ ] **M3.7** Guest magic-link auth (MailerSend)
- [ ] **M3.8** Booking history for repeat guests
- [ ] **M3.9** PriceLabs Customer API integration (per `pricelabs-integration.md`)
- [ ] **M3.10** Pricing override management

---

## Phase 4 — Polish & Scale (financials, expanded OTA, deferred features)

**Goal:** Reporting, analytics, growth-ready. Status: ⬜ Not started.

Milestones to be detailed with explicit unit + e2e test checkboxes per the testing discipline rule above. Scope per PRD §14:

- [ ] **M4.1** Revenue dashboard with charts
- [ ] **M4.2** Per-booking financial breakdown
- [ ] **M4.3** Tax filing reports (monthly city, quarterly state) per `loging-tax-plan.md` §5.4
- [ ] **M4.4** CSV export for accounting
- [ ] **M4.5** Booking source analytics
- [ ] **M4.6** Booking.com iCal sync
- [ ] **M4.7** Google Vacation Rentals iCal sync
- [ ] **M4.8** Promo code activation (schema already in place)
- [ ] **M4.9** Automated message triggers (optional)

---

## How to use this document

- **At the start of each milestone:** flip status to 🟡, update "Current focus" at the top.
- **As tasks complete within a milestone:** check off the boxes — they're durable progress markers.
- **At milestone completion:** flip status to ✅, update "Current focus" to the next one.
- **If blocked:** flip status to ⏸, add a note explaining the blocker and required unblock.
- **If scope changes:** edit the bullets directly. If the change is substantive (changes acceptance criteria), add a Decision Log entry.
- **New milestones discovered mid-phase:** insert with the next available number; renumber subsequent milestones if helpful.

This file is the answer to "where are we?" — keep it accurate.

---

## Testing discipline

### The rule: both, every time

**Every module and every user-visible feature ships with both a unit test suite and an end-to-end test suite.** A milestone does not move to ✅ until both pass in `pnpm test:all`.

This is not a nice-to-have. The whole point of the harness is regression detection — if a future change breaks auth, breaks the booking lifecycle, or loosens a Zod schema, a `git push` should fail loudly. That only works if coverage is comprehensive at both levels.

### What to write — by code shape

| You wrote… | Unit test (always) | E2E test (always) |
|---|---|---|
| **NestJS service** (e.g. `BookingService`) | `*.spec.ts` next to it; mock Prisma at the boundary; cover every public method, every error branch | hit the controller endpoints that call it via supertest in `test/*.e2e-spec.ts`; assert DB state changed correctly |
| **NestJS controller / endpoint** | usually skip — controllers should be thin (validation + delegation) | required in `test/*.e2e-spec.ts` — every HTTP method × path combo; happy path + at least one failure mode (auth, validation, conflict, etc.) |
| **NestJS guard / pipe / interceptor** | `*.spec.ts` with the request/response harness | covered indirectly by the e2e test of any endpoint it protects — but specifically test that it BLOCKS unauth'd traffic |
| **Zod schema** in `packages/shared` | `*.test.ts` — every required field, every refinement, every invalid case (Vitest) | covered indirectly by the e2e test of the endpoint that uses it |
| **React page / component** | `*.test.tsx` — render with providers, assert structure + a11y attributes (Vitest + RTL) | hit the user flow via the api e2e test of the endpoints the page calls; full browser-level e2e via Playwright is a future addition |
| **Background worker / BullMQ processor** | `*.spec.ts` — call the processor function directly with a fake job | e2e: enqueue a real job, await consumption, assert side-effects |
| **Integration adapter** (Stripe / Twilio / etc.) | `*.spec.ts` against an injected fake | e2e: webhook handler test with a signed payload; provider adapter itself tested with a real sandbox account in a separate suite (out of CI) |

### What "covered" means

- **Every public service method** has at least one unit test exercising the happy path and at least one for each error branch.
- **Every endpoint** has at least one e2e test for the happy path AND at least one for each documented failure mode (401, 403, 409, validation).
- **Every state transition** in a lifecycle (e.g. booking inquiry → pending → confirmed → cancelled) has an e2e test that walks it.
- **Every Zod schema** has a valid case AND an invalid case for every required field / refinement.

If you find yourself thinking "this is too small to test" — write the test anyway. The cost of writing a tiny test is far less than the cost of debugging a regression six months from now.

### Test runners

- `apps/api` — Jest. Unit specs co-located as `*.spec.ts`; e2e under `test/*.e2e-spec.ts` (boots full Nest app + Postgres test DB).
- `packages/shared` — Vitest (Zod schema tests).
- `apps/admin` — Vitest + Testing Library (component / hook tests).

### Commands

- `pnpm test` — unit suites across all packages (~30s).
- `pnpm test:e2e` — API integration tests (~50s, requires Postgres on host).
- `pnpm test:all` — full suite (must pass before pushing).

### Test database

`owlsnest_test` Postgres database (separate from dev `owlsnest`). Migrations applied on creation; `truncateAll` helper in `apps/api/test/test-helpers.ts` wipes all tables before each spec so e2e tests are isolated.

### Git hooks (husky)

- `pre-commit` — `pnpm typecheck && pnpm test` (unit tests only, fast).
- `pre-push` — `pnpm test:all` (full suite incl. e2e). Skip with `--no-verify` only when truly intentional.

### Per-milestone checklist template

Every milestone in this file should include test line items in its checklist. Pattern:

```
- [ ] {Feature implementation}
- [ ] Unit tests for {service / schema / hook / etc.}
- [ ] E2E tests for {endpoint / flow}
- [ ] `pnpm test:all` green
```

Don't mark the milestone ✅ until the test items are checked AND the whole suite is green.
