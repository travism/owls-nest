# Build Plan & Progress Tracker

Single source of truth for "where are we in the buildout." Each phase has milestones; each milestone has acceptance criteria. Update this file when a milestone starts, completes, or its scope changes.

**Status legend:** `⬜ Not started` · `🟡 In progress` · `✅ Complete` · `⏸ Blocked`

---

## Current focus

> **Now:** ✅ M2 complete — ready for M3
> **Next up:** M3 — Property settings + manual pricing/availability

Last updated: 2026-04-25

---

## Phase 0 — Planning & Architecture

| ID | Milestone | Status |
|---|---|---|
| P0.1 | PRD written | ✅ |
| P0.2 | Supplemental plans (PriceLabs / Tax / Calendar Sync) | ✅ |
| P0.3 | Architecture document | ✅ |
| P0.4 | Decision log seeded (D-001 → D-019) | ✅ |
| P0.5 | Scaffolding plan | ⬜ |

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
- CSRF error envelope unification (csrf-csrf throws ForbiddenError caught by Nest's default filter as `{statusCode, message}`; SPA + e2e script handle this via lenient retry logic). A global exception filter mapping these to the standard `{error: {code, message}}` envelope is a small follow-up.

**Tests:**
- Unit: `apps/api/src/auth/password.service.spec.ts`, `totp.service.spec.ts`, `lockout.service.spec.ts` (18 tests).
- E2E: `apps/api/test/auth.e2e-spec.ts` covers full setup → login → TOTP → whoami → logout cycle, /setup conflict, wrong password, invalid TOTP, lockout, recovery code single-use, audit log writes, CSRF rejection (8 tests).
- Frontend: `apps/admin/src/pages/Login.test.tsx` (component sanity, 2 tests).

---

### M3 — Property settings + manual pricing/availability
**Status:** ⬜ Not started

- [ ] `PropertyModule` settings CRUD (name, address, check-in/out, max guests)
- [ ] `PricingModule` — manual base rate, min-stay, cleaning fee
- [ ] `BlockedDate` manual block CRUD with date-range picker in admin
- [ ] `TaxModule` — calculation against seeded jurisdictions (1.5% state + 9% city)
- [ ] `/api/v1/pricing/quote` returns breakdown matching `loging-tax-plan.md` §5.3 sample

**Acceptance:** Admin can edit property, pricing, manual blocks; quote endpoint returns correct two-tax breakdown.

---

### M4 — iCal export feed
**Status:** ⬜ Not started

- [ ] `CalendarModule` export controller + `CalendarExportService` per `calendar-sync-plan.md` §3
- [ ] Cloudflare path rewrite for `/calendar.ics` → `/api/v1/calendar/export.ics`
- [ ] Excludes OTA-imported blocks (per D-015)
- [ ] Passes `webcal.fyi` validator

**Acceptance:** Pasting `https://owlsnest.com/calendar.ics` into Airbnb/VRBO succeeds; feed contains all confirmed direct bookings + manual blocks; no OTA-imported re-exports.

---

### M5 — Public Astro site (Home / About / Gallery / Book / House Rules)
**Status:** ⬜ Not started

- [ ] Astro pages aligned with brand (per PRD §3.2)
- [ ] Booking calendar React island calling `/api/v1/availability` + `/api/v1/pricing/quote`
- [ ] Min-stay enforcement on calendar
- [ ] TLT line-item display (Oregon Lodging Tax 1.5%, Redmond Lodging Tax 9.0%)
- [ ] Media volume serving gallery images at `/media/gallery/*`
- [ ] Lighthouse perf ≥ 90 on Home

**Acceptance:** Calendar renders 365 days within 1s; quote endpoint matches admin-side calculation byte-for-byte.

---

### M6 — Inquiry submission
**Status:** ⬜ Not started

- [ ] `InquiryModule` POST endpoint with Zod validation
- [ ] Astro Book page → React inquiry form → API
- [ ] Admin "Inquiries" view: list, detail, mark responded, convert to booking request
- [ ] Email + SMS admin notification on new inquiry (per D-018)

**Acceptance:** Submit inquiry → `Inquiry` row created → admin gets email + SMS → visible in admin SPA.

---

### M7 — Request-to-book + Stripe Checkout
**Status:** ⬜ Not started

- [ ] `BookingModule` request → `pending_approval` state
- [ ] Admin approval action: creates Stripe Checkout Session, sends payment link via SMS + email
- [ ] Webhook handler for `checkout.session.completed` → flips booking to confirmed
- [ ] Outbox emits confirmation SMS/email + `rebuild-site` job
- [ ] Conflict detection at approval time (calls `AvailabilityService`)
- [ ] WebhookEvent idempotency table prevents double-processing

**Acceptance:** Full happy path — guest selects dates → submits request → admin approves → guest pays → confirmation arrives → `BlockedDate` exists → export `.ics` updated.

---

### M8 — Booking management actions
**Status:** ⬜ Not started

- [ ] Decline action with notification
- [ ] Cancel with refund per cancellation tier (configurable thresholds)
- [ ] Modify dates (re-quotes price; refund or charge difference)
- [ ] Refund flow wraps Stripe call in Prisma transaction
- [ ] All four actions write AuditLogEntry

**Acceptance:** All four actions work end-to-end; cancellation tier logic applied; audit log captures every action.

---

**Phase 1 done when:** all M1–M8 ✅ and the property can take a real direct booking from a guest.

---

## Phase 2 — Operations (cleaner SMS, guest messaging, iCal import)

**Goal:** Day-to-day operations automated. Status: ⬜ Not started.

Milestones to be detailed when Phase 1 is ~75% complete. Scope per PRD §14:

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

Scope per PRD §14:

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

Scope per PRD §14:

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

**Every milestone ships with tests.** Acceptance criteria for any new feature must include the relevant tests passing in CI before the milestone is marked ✅.

**Test runners:**
- `apps/api` — Jest. Unit tests co-located as `*.spec.ts`; E2E tests under `test/*.e2e-spec.ts` (boots full Nest app + Postgres test DB).
- `packages/shared` — Vitest (Zod schema tests).
- `apps/admin` — Vitest + Testing Library (component / hook tests).

**Commands:**
- `pnpm test` — fast unit suites across all packages (~30s).
- `pnpm test:e2e` — API integration tests (~50s, requires Postgres on host).
- `pnpm test:all` — full suite.

**Test database:** `owlsnest_test` Postgres database (separate from dev `owlsnest`). Migrations applied on creation; `truncateAll` helper wipes all rows between tests so each spec runs on a clean slate.

**Git hooks (husky):**
- `pre-commit` — `pnpm typecheck && pnpm test` (unit tests only, fast).
- `pre-push` — `pnpm test:all` (full suite incl. E2E). Skip with `--no-verify` only when intentional.

**For each new feature:**
- Pure logic → unit test in the same package.
- Service touching DB / external → e2e test that hits the real endpoint via supertest.
- React component → component test rendering with required providers.
- New Zod schema → exhaustive valid + invalid cases in `*.test.ts`.
