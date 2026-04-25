# Build Plan & Progress Tracker

Single source of truth for "where are we in the buildout." Each phase has milestones; each milestone has acceptance criteria. Update this file when a milestone starts, completes, or its scope changes.

**Status legend:** `⬜ Not started` · `🟡 In progress` · `✅ Complete` · `⏸ Blocked`

---

## Current focus

> **Now:** ✅ M3 complete — ready for M4
> **Next up:** M4 — iCal export feed

Last updated: 2026-04-25 (after CSRF envelope fix; 146 tests passing)

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

**Carryovers:**
- Real Redis on host (currently using MemoryStore — fine for dev, must use Compose Redis for prod). Revisit when infrastructure lands.
- ~~CSRF error envelope unification.~~ Resolved 2026-04-25 via `ApiExceptionFilter` (`apps/api/src/common/api-exception.filter.ts`) — every error now uses `{error: {code, message, details?}}` shape; SPA and TestClient retry on `code === 'CSRF_INVALID'` only, no more regex fallbacks.

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
**Status:** ⬜ Not started

- [ ] `CalendarModule` export controller + `CalendarExportService` per `calendar-sync-plan.md` §3
- [ ] Cloudflare path rewrite for `/calendar.ics` → `/api/v1/calendar/export.ics`
- [ ] Excludes OTA-imported blocks (per D-015)
- [ ] Passes `webcal.fyi` validator
- [ ] **Unit tests** — `CalendarExportService.generateExportFeed()`, VEVENT formatter, date-format helpers, special-character escaping (RFC 5545 edge cases)
- [ ] **E2E tests** — `/api/v1/calendar/export.ics` returns `text/calendar`, Cache-Control no-cache, valid VCALENDAR; with empty data; with direct bookings only; with manual blocks; OTA-imported blocks correctly excluded; UID stability across requests
- [ ] `pnpm test:all` green

**Acceptance:** Pasting `https://owlsnest.com/calendar.ics` into Airbnb/VRBO succeeds; feed contains all confirmed direct bookings + manual blocks; no OTA-imported re-exports; full test suite green.

---

### M5 — Public Astro site (Home / About / Gallery / Book / House Rules)
**Status:** ⬜ Not started

- [ ] Astro pages aligned with brand (per PRD §3.2)
- [ ] Booking calendar React island calling `/api/v1/availability` + `/api/v1/pricing/quote`
- [ ] Min-stay enforcement on calendar
- [ ] TLT line-item display (Oregon Lodging Tax 1.5%, Redmond Lodging Tax 9.0%)
- [ ] Media volume serving gallery images at `/media/gallery/*`
- [ ] Lighthouse perf ≥ 90 on Home
- [ ] **Unit tests** — date-utility helpers (calendar grid, available-day classification), tax line-item formatter, currency display
- [ ] **E2E tests** — `/api/v1/availability?from=…&to=…` (correct unavailable ranges from blocked + bookings), build-time content endpoint
- [ ] **Astro page render tests** — every page renders without errors, has expected H1/title/meta tags
- [ ] **Component tests** — booking calendar React island (date selection, min-stay enforcement UI, quote breakdown display)
- [ ] `pnpm test:all` green

**Acceptance:** Calendar renders 365 days within 1s; quote endpoint matches admin-side calculation byte-for-byte; full test suite green.

---

### M6 — Inquiry submission
**Status:** ⬜ Not started

- [ ] `InquiryModule` POST endpoint with Zod validation
- [ ] Astro Book page → React inquiry form → API
- [ ] Admin "Inquiries" view: list, detail, mark responded, convert to booking request
- [ ] Email + SMS admin notification on new inquiry (per D-018)
- [ ] **Unit tests** — `InquiryService` (create + status transitions + convert-to-booking); inquiry → outbox notification dispatch logic
- [ ] **E2E tests** — `POST /api/v1/inquiries` (happy path + validation errors + invalid date range); admin `GET /inquiries` + status transitions; outbox row created with the right notification job
- [ ] **Component tests** — public inquiry form (validation surfacing, submit, success state); admin inquiry list + detail
- [ ] **Schema tests** — already covered for `InquiryCreateSchema` in `packages/shared`; add cases for any new fields
- [ ] `pnpm test:all` green

**Acceptance:** Submit inquiry → `Inquiry` row created → admin gets email + SMS → visible in admin SPA; full test suite green.

---

### M7 — Request-to-book + Stripe Checkout
**Status:** ⬜ Not started

- [ ] `BookingModule` request → `pending_approval` state
- [ ] Admin approval action: creates Stripe Checkout Session, sends payment link via SMS + email
- [ ] Webhook handler for `checkout.session.completed` → flips booking to confirmed
- [ ] Outbox emits confirmation SMS/email + `rebuild-site` job
- [ ] Conflict detection at approval time (calls `AvailabilityService`)
- [ ] WebhookEvent idempotency table prevents double-processing
- [ ] **Unit tests** — `BookingService` state machine (every transition allowed + every disallowed transition rejected); `AvailabilityService.checkAvailability()` (no conflict / direct conflict / OTA conflict / same-day turnaround); Stripe adapter (with injected fake)
- [ ] **E2E tests** — full happy path through `/api/v1/bookings/request` → admin approve → simulated Stripe webhook → confirmation; conflict detection at approval; webhook idempotency (same event id processed twice → no duplicate side-effects); webhook signature verification rejects bad signatures
- [ ] **Component tests** — public request-to-book form; admin booking-detail view + approval action
- [ ] `pnpm test:all` green

**Acceptance:** Full happy path — guest selects dates → submits request → admin approves → guest pays → confirmation arrives → `BlockedDate` exists → export `.ics` updated; full test suite green.

---

### M8 — Booking management actions
**Status:** ⬜ Not started

- [ ] Decline action with notification
- [ ] Cancel with refund per cancellation tier (configurable thresholds)
- [ ] Modify dates (re-quotes price; refund or charge difference)
- [ ] Refund flow wraps Stripe call in Prisma transaction
- [ ] All four actions write AuditLogEntry
- [ ] **Unit tests** — cancellation tier resolver (every threshold boundary including off-by-one); refund-amount calculator; modify-dates re-quote logic
- [ ] **E2E tests** — decline (sends notification, transitions status); cancel at each tier (30+ days = full refund, 14–29 = 50%, <14 = $0); modify dates (refund vs. charge difference); refund failure rolls back DB state; AuditLogEntry written for each action with correct before/after
- [ ] **Component tests** — admin booking-detail action buttons (cancel confirms, modify-dates form)
- [ ] `pnpm test:all` green

**Acceptance:** All four actions work end-to-end; cancellation tier logic applied; audit log captures every action; full test suite green.

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
- [ ] **M2.9** iCal import from Airbnb + VRBO (30-min poll per D-009)
- [ ] **M2.10** Conflict detection on booking approval
- [ ] **M2.11** Manual "Sync Now" button

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
