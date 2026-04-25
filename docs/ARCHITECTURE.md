# The Owl's Nest Platform — Architecture

**Companion to:** `docs/PRD.md`
**Supplemental plans:** `docs/pricelabs-integration.md`, `docs/loging-tax-plan.md`, `docs/calendar-sync-plan.md`
**Decision log:** `docs/DECISION-LOG.md`
**Version:** 1.0
**Date:** 2026-04-25

This document translates the PRD into concrete technical decisions: repo layout, module boundaries, data layer, auth flows, integrations, deployment, and a Phase-1 build map. It is the canonical engineering reference for the platform. All decisions captured here have a corresponding entry in the Decision Log.

---

## 1. System Overview

### 1.1 Runtime topology

```
                  ┌──────────────────────┐
                  │   Public Internet    │
                  └──────────┬───────────┘
                             │  HTTPS
                  ┌──────────▼───────────┐
                  │  Cloudflare Tunnel   │  (TLS, DDoS, edge caching for static assets)
                  └──────────┬───────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │                     │                     │
┌──────▼───────┐    ┌────────▼────────┐    ┌──────▼─────────┐
│  web (Astro) │    │   api (NestJS)  │    │ admin (React)  │
│  static SSG  │    │  REST + workers │    │  Vite SPA      │
│  + React     │    │                 │    │                │
│  islands     │    │                 │    │                │
└──────┬───────┘    └────────┬────────┘    └──────┬─────────┘
       │                     │                    │
       │ build-time fetch    │ TCP                │ HTTPS
       │                     │                    │
       │            ┌────────▼────────┐           │
       │            │  Postgres       │  (on host machine, not containerized)
       │            └────────┬────────┘           │
       │                     │                    │
       │            ┌────────▼────────┐           │
       └───────────►│  Redis (BullMQ) │◄──────────┘
                    └────────┬────────┘
                             │
                  ┌──────────▼──────────┐
                  │  build-worker       │  (Astro rebuild consumer)
                  │  (Docker container) │
                  └─────────────────────┘

External services consumed by api / build-worker:
  - Stripe (payments, refunds, webhooks)
  - Twilio (SMS in/out, webhook)
  - MailerSend (transactional email)
  - PriceLabs Customer API (daily rate fetch)
  - OTA iCal feeds (Airbnb, VRBO)
```

### 1.2 Key requests

| Request | Path |
|---|---|
| Guest visits homepage | Cloudflare → `web` container (static HTML) |
| Guest opens booking calendar | Cloudflare → `web` (HTML) → React island fetches `/api/v1/availability` from `api` |
| Guest submits inquiry | `web` (React island) → `POST /api/v1/inquiries` on `api` |
| OTA polls availability | Cloudflare → `api` `/api/v1/calendar/export.ics` |
| Cleaner clicks accept link in SMS | Cloudflare → `api` `/cleaner/respond` |
| Stripe webhook | Cloudflare → `api` `/webhooks/stripe` |
| Twilio inbound SMS webhook | Cloudflare → `api` `/webhooks/twilio` |
| Admin loads dashboard | Cloudflare → `admin` (SPA shell) → `api` for data |
| Admin publishes blog post | `admin` → `api` → enqueue `rebuild-site` BullMQ job → `build-worker` runs `astro build`, swaps `web` output |
| iCal poll (every 30 min) | `api` BullMQ scheduler → fetches Airbnb/VRBO feeds → writes `blocked_date` rows |

---

## 2. Repository Layout

Single pnpm-workspaces monorepo. Branchless package boundaries via TypeScript project references.

```
owls-nest/
├── apps/
│   ├── web/                  # Astro SSG guest site (+ React islands)
│   ├── admin/                # React + Vite admin SPA
│   ├── api/                  # NestJS API + BullMQ producers/consumers
│   └── build-worker/         # Astro rebuild consumer (BullMQ worker)
├── packages/
│   ├── shared/               # Zod schemas, DTO types, shared enums
│   └── prisma/               # Prisma schema, migrations, generated client, seed
├── docker/
│   ├── docker-compose.yml
│   ├── docker-compose.prod.yml
│   ├── Dockerfile.api
│   ├── Dockerfile.web
│   ├── Dockerfile.admin
│   └── Dockerfile.build-worker
├── docs/                     # PRD, ARCHITECTURE, DECISION-LOG, plan docs
├── .env.example
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Conventions:**
- Apps depend on `packages/*`; packages never depend on apps.
- `packages/shared` exports Zod schemas; both `api` (validation) and `web`/`admin` (form types) import from it. This keeps the wire contract single-sourced.
- `packages/prisma` exports the generated client and a small repository-pattern wrapper. Other apps import the client; the schema lives only here.

---

## 3. NestJS Module Boundaries

One Nest module per PRD domain. Domain modules depend on the `IntegrationsModule`; never the reverse.

| Module | Responsibilities | Key external deps |
|---|---|---|
| `AuthModule` | Admin login + TOTP, guest magic links, cleaner token resolution, session/JWT issuance, CSRF | MailerSend (magic link delivery) |
| `BookingModule` | Inquiry → request → approval → confirmation lifecycle, cancellation, refunds | Stripe, Pricing |
| `InquiryModule` | Lightweight no-account inquiry capture; conversion to booking request | — |
| `GuestModule` | Guest profile CRUD, booking history | — |
| `CleanerModule` | Roster, priority ranking, turnover assignment, SMS waterfall, cleaner portal | Twilio |
| `MessagingModule` | Outbound SMS, inbound webhook, conversation threads, templates with `{{var}}` interpolation | Twilio, MailerSend |
| `ContentModule` | Blog post CRUD, draft/publish, area-guide content, media references; emits `rebuild-site` jobs | BullMQ |
| `ReviewModule` | Direct review collection, OTA review curation, visibility toggles | — |
| `FinancialsModule` | Per-booking ledger, monthly/quarterly tax reports, CSV export | Tax |
| `CalendarModule` | iCal export, OTA feed import polling, conflict detection (`AvailabilityService`) | BullMQ |
| `PricingModule` | PriceLabs daily sync, manual overrides, quote calculation (calls Tax) | PriceLabs |
| `TaxModule` | Per-jurisdiction tax calculation (Oregon State + Redmond City), exemption rules | — |
| `PropertyModule` | Property settings (single row in V1, schema ready for multi) | — |
| `IntegrationsModule` | Adapter implementations: Stripe, Twilio, MailerSend, PriceLabs, iCal fetcher | All externals |
| `JobsModule` | BullMQ queue registration, schedulers, dead-letter handling | Redis |
| `WebhooksModule` | Public webhook endpoints (Stripe, Twilio); signature verification → dispatch into domain modules | — |

**Dependency rules (enforced via ESLint + tsconfig path restrictions):**
- Domain → Integrations: ✅
- Domain → Domain: ✅ when domain dependency is unidirectional and obvious (e.g., Booking → Pricing → Tax)
- Integrations → Domain: ❌
- Anything → Webhooks: ❌ (webhooks are entry points only)

---

## 4. Data Layer (Prisma + Postgres)

### 4.1 ORM

**Prisma** is the ORM. Schema in `packages/prisma/schema.prisma`, generated client published to `@owlsnest/prisma`. Migrations live alongside the schema.

**Why Prisma over TypeORM:**
- Schema-first migrations vs. decorator drift
- Better type inference for query results
- Simpler nested writes for the booking → tax-breakdown → blocked-date flows
- DECISION-LOG entry: D-003

### 4.2 Schema (informed by PRD §12 + tax plan + calendar plan)

The PRD's high-level data model is the starting point. The tax plan replaces the single `tax_rate_percentage` and `tax_amount` fields with per-jurisdiction tracking (see `docs/loging-tax-plan.md` §5.1, Option B), and the calendar plan refines the `blocked_date` and `calendar_sync` shapes (see `docs/calendar-sync-plan.md` §4.2).

Final V1 entity list:

- `Property` (single row in V1)
- `TaxJurisdiction` (≥2 rows: state, city) — supersedes the PRD's single `tax_rate_percentage`
- `Guest`
- `MagicLinkToken` (hashed, single-use, 15-min expiry)
- `AdminUser` (single row in V1, schema ready for multi)
- `AdminSession` (Redis-backed; not a Prisma model — see §6)
- `Inquiry`
- `Booking` — with per-jurisdiction tax columns (`state_tlt_amount`, `city_tlt_amount`, `total_tax_amount`, `state_admin_fee_retained`, `tax_exempt`, `ota_remitted_state`, `ota_remitted_city`)
- `Cleaner`
- `CleanerToken` (long-lived, hashed, revocable; portal access)
- `CleanerRequestToken` (single-use, signed, scoped to one assignment + action; defeats CSRF/replay)
- `TurnoverAssignment` — with `request_history` JSON array
- `Message` (inbound + outbound SMS)
- `MessageTemplate`
- `BlogPost`
- `Review`
- `CalendarSync` (one row per OTA feed)
- `BlockedDate` (manual blocks + imported OTA bookings)
- `PricingOverride`
- `PricingCacheEntry` — one row per (date, listing) holding PriceLabs-sourced rate + min-stay
- `PromoCode` (deferred; schema only)
- `AuditLogEntry` — every admin action that touches money or guest data
- `WebhookEvent` — Stripe/Twilio event idempotency table (PK = provider event id)
- `Outbox` — outbound side-effects (SMS to send, jobs to enqueue) committed in the same transaction as the originating write, drained by a worker

### 4.3 Schema conventions

- All tables: `id` (UUID v7 generated by Postgres extension), `created_at`, `updated_at` (`@updatedAt`)
- Soft-delete only where it changes domain semantics (`Cleaner.active`, `MessageTemplate.archived_at`); otherwise hard delete
- Money: `Decimal(10,2)` (Postgres `NUMERIC`) — never floats
- Dates that are calendar dates (check-in, check-out, blocked ranges): Postgres `DATE`, never `TIMESTAMPTZ`
- Foreign keys: explicit, `ON DELETE RESTRICT` unless cascade is the obvious right choice (e.g., `MagicLinkToken` → `Guest`)
- Tax-collected and remittance fields on `Booking` mirror the columns specified in `docs/loging-tax-plan.md` §5.1

### 4.4 Migrations & seed

- Dev: `prisma migrate dev` creates timestamped migrations
- Prod: `prisma migrate deploy` applied as part of API container start (single-property, low risk; revisit if multi-tenant)
- Seed (`packages/prisma/seed.ts`):
  - Single `Property` row for 147 SW 4th St, Redmond, OR
  - Two `TaxJurisdiction` rows: Oregon State (1.5%), City of Redmond (9.0%) — values per `docs/loging-tax-plan.md`
  - Default `MessageTemplate` rows: Booking Confirmed, Pre-Arrival, Post-Stay
  - One `AdminUser` placeholder; password + TOTP secret rotated on first login

### 4.5 Backups

- `pg_dump` nightly via host cron, encrypted with `age` before being copied offsite (cloud storage)
- WAL archiving enabled for point-in-time recovery
- Restore drill quarterly (manual checklist)

---

## 5. API Conventions

### 5.1 Surface

- Mounted at `/api/v1`
- REST resource shapes; no GraphQL
- JSON, `application/json; charset=utf-8`
- Public webhook endpoints under `/webhooks/{provider}` (outside `/api/v1` because they aren't part of the versioned client contract)
- The Astro guest site's iCal export is at `/api/v1/calendar/export.ics`, also reachable at `/calendar.ics` via Cloudflare path rewrite for a clean public URL

### 5.2 Validation

- DTOs declared as Zod schemas in `packages/shared`
- A single Nest `ZodValidationPipe` parses request bodies/queries/params into branded TS types
- Same Zod schemas are imported by `web` (booking forms) and `admin` (every form) for client-side validation — no schema drift

### 5.3 Errors

Uniform envelope:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "...", "details": { ... } } }
```

Codes are stable strings (`UNAUTHENTICATED`, `MFA_REQUIRED`, `MIN_STAY_VIOLATION`, `DOUBLE_BOOKING`, `WEBHOOK_SIGNATURE_INVALID`, …). HTTP status codes follow normal REST semantics (400/401/403/404/409/422/429/500).

A global Nest exception filter maps thrown `DomainError` subclasses to the envelope; unknown errors return a generic 500 and are logged at `error` level with the request ID.

### 5.4 Pagination

Cursor-based for all list endpoints. Page size capped at 100; default 25. Cursors are opaque base64-encoded `(created_at, id)` tuples.

### 5.5 Versioning

The `/v1` prefix is the contract. Breaking changes ship as `/v2` and run side-by-side until clients migrate. There are no internal-only endpoints — admin uses the same versioned API as guests, just with different auth scope.

---

## 6. Authentication & Authorization

Three independent flows. No shared session store between them — different cookie names, different scopes, different lifetimes.

### 6.1 Admin auth (single user, mandatory TOTP 2FA)

| Step | Detail |
|---|---|
| Credential storage | `AdminUser.password_hash` = Argon2id (memory 64 MB, iter 3) |
| TOTP secret | Stored encrypted at rest with an app-level key from env (`ADMIN_TOTP_KEY`); 6-digit, 30-second window |
| Login flow | `POST /api/v1/auth/admin/login` → returns `{ challenge: "totp" }` and a short-lived signed challenge token; `POST /api/v1/auth/admin/totp` with code + challenge issues the session |
| Session | Server-side, stored in Redis with 8-hour idle timeout, 24-hour absolute timeout |
| Cookie | `__Host-admin-session`, `httpOnly`, `Secure`, `SameSite=Strict`, `Path=/` |
| CSRF | Double-submit cookie token on every state-changing request to `/api/v1/admin/*` |
| Recovery | One-time recovery codes generated at TOTP setup, stored hashed; user prints/saves them |
| Lockout | 5 failed attempts → 15-min lockout per IP + per account |
| Audit | Every login (success/fail) logged to `AuditLogEntry` |

The PRD allows future expansion to multiple admins. The schema supports it (`AdminUser` is a regular table); RBAC is not built in V1 — the single user has full access.

### 6.2 Guest auth (magic link)

| Step | Detail |
|---|---|
| Trigger | Guest enters email at `/book` after selecting dates → `POST /api/v1/auth/guest/request-link` |
| Token | 32 bytes random → URL-safe base64 (44 chars); we store the SHA-256 hash, never the plaintext |
| Email | MailerSend transactional template, link expires in 15 minutes, single-use |
| Activation | `GET /api/v1/auth/guest/verify?token=...` → marks token consumed → issues a session JWT (HS256, 7-day expiry) |
| Cookie | `__Host-guest-session`, `httpOnly`, `Secure`, `SameSite=Lax` (Lax so the link works cross-origin from email) |
| Refresh | JWT rotation on each successful API call within last 24h of expiry |
| Cleanup | Daily BullMQ job purges consumed and expired tokens older than 30 days |

Guests can browse / inquire without auth. Auth is only required for "request to book" and viewing past bookings.

### 6.3 Cleaner auth (two distinct token types)

**Portal token (`CleanerToken`):**
- Long-lived, opaque (32 bytes random, hashed at rest)
- One per cleaner; revocable from admin
- Embedded in URL: `https://owlsnest.com/cleaner/<token>`
- Read-only access scoped to that cleaner's assignments
- No session, no cookie — the URL itself is the credential. (Acceptable because cleaners only see their own data; URL is sent only via SMS to their personal number.)

**Request action token (`CleanerRequestToken`):**
- Short-lived (typically the cleaner-response timeout window: 2 hours default), single-use, signed (HMAC over `{assignment_id, cleaner_id, action, expiry}` with a server secret)
- Generated when an SMS request is sent
- Embedded in accept/decline links: `https://owlsnest.com/cleaner/respond?t=<signed-token>`
- Defeats CSRF (token bound to specific assignment + action) and replay (single-use)
- After consumption, the next cleaner in priority gets a freshly-issued token

This split is deliberate: the portal token is a long-lived view credential; the request token is a one-shot action credential. Compromising the portal URL doesn't let an attacker accept assignments on the cleaner's behalf.

### 6.4 Webhook auth

- Stripe: signature verification via `Stripe-Signature` header against signing secret; replay protection by storing event IDs in `WebhookEvent` and rejecting duplicates
- Twilio: HMAC-SHA1 verification via `X-Twilio-Signature`; same replay protection on `MessageSid`

---

## 7. Background Jobs (BullMQ)

Redis is a Compose service (no host install). All jobs go through BullMQ; nothing uses `setInterval` or `@nestjs/schedule` for production work.

### 7.1 Queues

| Queue | Producer | Consumer | Frequency / trigger |
|---|---|---|---|
| `ical-import` | Repeatable (every 30 min) + manual "Sync Now" | api worker | Polls each `CalendarSync` row, parses, upserts `BlockedDate` (logic per `docs/calendar-sync-plan.md` §4.3) |
| `cleaner-waterfall` | `CleanerService.requestCleaner()` | api worker | Sends SMS to current cleaner; on timeout (default 2h) advances to next |
| `cleaner-timeout-check` | Repeatable (every 5 min) | api worker | Detects unresponded requests and fans out to next priority |
| `magic-link-cleanup` | Repeatable (daily, 03:00 UTC) | api worker | Deletes expired/consumed magic-link tokens older than 30 days |
| `pricelabs-sync` | Repeatable (daily, 06:00 PT) | api worker | Calls PriceLabs Customer API, populates `PricingCacheEntry` (per `docs/pricelabs-integration.md`) |
| `rebuild-site` | `ContentService.publish()`, settings changes affecting public site | build-worker | Runs `astro build`, atomically swaps `web` output dir |
| `stripe-webhook-retry` | On webhook handler failure | api worker | Exponential backoff retry; dead-letter after 24h |
| `twilio-outbound` | All outbound SMS | api worker | Single point for Twilio API calls; allows rate limiting + retry |
| `email-outbound` | All transactional email | api worker | Same pattern: single point for MailerSend API calls |
| `outbox-drain` | Repeatable (every 5s, with leader election in Redis) | api worker | Drains the `Outbox` table, enqueues real jobs — guarantees side effects after DB transactions |

### 7.2 Job conventions

- Idempotency key on every job (`bookingId:event-name` style) — workers no-op on duplicates
- Exponential backoff: 1m, 5m, 30m, 2h, 6h
- Dead-letter queue per source queue; admin dashboard surfaces DLQ depth
- Workers boot health-check at `/health/queues`

### 7.3 Outbox pattern

Side effects that must happen iff a DB write commits (e.g., "send confirmation SMS when booking confirmed") are written to the `Outbox` table in the same Prisma transaction. The `outbox-drain` job picks them up and enqueues the real BullMQ job. This avoids double-firing on retry and avoids the inverse problem of a transaction rolling back after we've already sent a message.

### 7.4 Astro rebuild mechanism

Decision **D-005**: option C from the planning conversation — BullMQ-orchestrated build job, no Docker-socket exposure.

Flow:
1. Admin clicks "Publish" → `POST /api/v1/content/blog/:id/publish`
2. API updates `BlogPost.status = published`, writes an `Outbox` row, commits
3. Outbox drain enqueues `rebuild-site`
4. `build-worker` consumes: writes posts as MDX into a working dir, runs `astro build`, atomically renames `dist/` of the running `web` container's mounted volume
5. The `web` container's nginx serves the new `dist/` immediately (no restart needed)

This avoids Docker socket exposure (option A) and is simpler to reason about than file-watch (option B).

---

## 8. Integrations

All adapters live under `apps/api/src/integrations/{provider}/`. Each provider exports an interface (`StripeAdapter`, `TwilioAdapter`, …) and a concrete implementation. Domain modules depend on the interface, never the concrete. Test doubles implement the interface for unit tests.

### 8.1 Stripe

- **Standard account**, not Connect (decision D-007 — multi-property is a future concern; standard suffices)
- Payment links via Stripe Checkout Sessions (`mode: 'payment'`)
- Customer object created on first booking → enables card-on-file recourse
- Webhook events: `checkout.session.completed`, `payment_intent.succeeded`, `charge.refunded`, `charge.dispute.created`
- Refunds: triggered from admin, automated per cancellation tier, idempotent via Prisma transaction
- Fee data pulled from `BalanceTransaction` for financial reporting
- All amounts sent to Stripe in cents (integer); converted to/from `Decimal(10,2)` at the boundary

### 8.2 Twilio

- **Single phone number** (decision D-008) for both guest messaging and cleaner requests
- Inbound routing: `WebhooksModule` matches the inbound `From` against (a) active cleaner phones and (b) booking guest phones; routes accordingly. Ambiguous matches surface to admin.
- Outbound flows through the `twilio-outbound` BullMQ queue for centralized rate limiting and retry
- Delivery status webhooks update `Message.delivered_at`

### 8.3 MailerSend

- Transactional templates managed in MailerSend dashboard, referenced by template ID in env config
- Templates: `magic_link`, `booking_confirmation`, `booking_decline`, `payment_link`, `post_stay_review_request`, `admin_notification`
- Variable interpolation handled MailerSend-side; we just pass the variables JSON
- Delivery + bounce webhooks consumed for email reputation monitoring

### 8.4 PriceLabs

- Customer API ($1/listing/month), key in env, daily sync via `pricelabs-sync` BullMQ job (06:00 PT, after PriceLabs's overnight recompute)
- Implementation follows `docs/pricelabs-integration.md` Phase 1–4 verbatim, but data lands in Postgres `PricingCacheEntry`, not Firestore
- Read-only: PriceLabs is a rate source; availability and bookings stay in Postgres
- Fallback: `PricingCacheEntry` rows persist on sync failure; if cache is older than 48 hours, admin sees a banner. Quote endpoint never reads PriceLabs live — always cache.

### 8.5 iCal

- Export: NestJS controller streams a generated `.ics` file at `/api/v1/calendar/export.ics`. Generation is the algorithm in `docs/calendar-sync-plan.md` §3.4.
- Import: `node-ical` parses each configured feed every 30 minutes (decision D-009). Upsert + cancellation logic per `docs/calendar-sync-plan.md` §4.3.
- The platform's `AvailabilityService` queries direct `Booking` rows (active statuses) plus all `BlockedDate` rows. The same service powers (a) the public booking calendar, (b) the admin booking-approval pre-check, and (c) the manual "Sync Now" button.

### 8.6 Cloudflare Tunnel

- `cloudflared` runs as a host service (not in Compose)
- Routes:
  - `owlsnest.com` and `www.owlsnest.com` → `web:80`
  - `owlsnest.com/api/*` → `api:3000`
  - `owlsnest.com/webhooks/*` → `api:3000`
  - `owlsnest.com/calendar.ics` → `api:3000` (rewrite to `/api/v1/calendar/export.ics`)
  - `admin.owlsnest.com` → `admin:80` (subdomain isolates the admin SPA from public surface area)

---

## 9. Astro ↔ API Contract

### 9.1 Build-time data

The blog and area-guide content is read from Postgres at build time:

```ts
// apps/web/src/lib/api.ts
export async function getPublishedPosts(): Promise<Post[]> {
  const res = await fetch(`${process.env.INTERNAL_API_URL}/api/v1/content/published`);
  return res.json();
}
```

`INTERNAL_API_URL` is the Compose-network URL (`http://api:3000`), not the public URL. Build-time fetches use a service-internal token, not a guest session.

### 9.2 Runtime data (React islands)

- **Booking calendar** (`apps/web/src/components/booking/Calendar.tsx`): React island, hydrated on visible. Fetches `/api/v1/availability?from=...&to=...` and `/api/v1/pricing/quote?...` from the public origin.
- **Inquiry form**: hydrated on interaction. POSTs to `/api/v1/inquiries`.
- **Magic-link request form**: hydrated on interaction. POSTs to `/api/v1/auth/guest/request-link`.

Islands share Zod schemas with the API via `@owlsnest/shared`. Validation is identical client-side and server-side.

### 9.3 Rebuild trigger

Anything that changes guest-visible static content enqueues `rebuild-site`:
- Publishing/unpublishing a blog post
- Editing area-guide content
- Editing the homepage hero/featured reviews block (admin-managed)
- Updating property settings that appear on the marketing site (check-in time, max guests, etc.)

The rebuild job is **debounced** with a 30-second window — rapid successive edits coalesce into one build.

---

## 10. Admin SPA

- Vite + React 18 + TypeScript
- Routing: React Router v6 (decision D-017 — mainstream, largest ecosystem, well-documented with TanStack Query)
- Server state: TanStack Query (caching, optimistic updates, retry)
- Forms: react-hook-form + Zod resolvers (using `@owlsnest/shared` schemas)
- Styling: Tailwind + a small component layer matching the brand
- Auth: every route under `/` is gated by an `<AuthBoundary>` that calls `/api/v1/auth/admin/whoami` on mount
- Session refresh: TanStack Query's `onError` catches 401 → redirects to `/login`
- All charts in financials view: a single charting lib (recharts or visx) — no per-page lib choices
- Mobile responsive end-to-end: the dashboard is used as much from a phone (turnover triggers, message replies) as from desktop

---

## 11. Build & Deploy

### 11.1 Docker Compose

```yaml
# docker/docker-compose.yml (shape; not literal)
services:
  api:
    build: { dockerfile: docker/Dockerfile.api }
    environment_file: .env
    extra_hosts: ["host.docker.internal:host-gateway"]
    volumes: ["media:/var/owlsnest/media"]
    depends_on: [redis]
  build-worker:
    build: { dockerfile: docker/Dockerfile.build-worker }
    volumes:
      - "web-dist:/app/web/dist"
      - "media:/var/owlsnest/media:ro"
    depends_on: [redis]
  web:
    build: { dockerfile: docker/Dockerfile.web }
    volumes:
      - "web-dist:/usr/share/nginx/html:ro"
      - "media:/usr/share/nginx/html/media:ro"
  admin:
    build: { dockerfile: docker/Dockerfile.admin }
  redis:
    image: redis:7-alpine
    volumes: ["redis-data:/data"]

volumes:
  web-dist:
  media:
  redis-data:
```

Postgres runs on the host, not in Compose (per PRD §13). Containers reach it via `host.docker.internal`.

### 11.2 Environment

- One `.env` at repo root (gitignored), checked-in `.env.example`
- All secret values referenced by env-var name in code; never inline
- Per-app config validated at boot via Zod (`apps/api/src/config/env.ts`); the API refuses to start with missing/malformed env

### 11.3 Local dev

- `pnpm dev` runs:
  - `api` in watch mode against the host Postgres + a local Redis (Docker run as one-liner)
  - `web` in `astro dev` (HMR)
  - `admin` in `vite dev` (HMR)
  - `build-worker` is **not** run in dev (the `web` dev server already shows current content)

### 11.4 Production deploy

- `git pull` on the host
- `pnpm install --frozen-lockfile`
- `pnpm prisma migrate deploy`
- `docker compose -f docker/docker-compose.yml up -d --build`
- `cloudflared` already running as host service

No CI/CD in V1 — single owner, single host, manual is fine. Revisit if multiple contributors or staging environment is needed.

### 11.5 Media storage

Decision D-016: media (gallery photos, blog featured images, future uploads) lives on a Compose-managed `media` volume mounted at `/var/owlsnest/media` in `api` (read-write) and at `/usr/share/nginx/html/media` (read-only) in `web`. Public URLs: `https://owlsnest.com/media/<path>`.

Layout:
```
/var/owlsnest/media/
├── gallery/         # property gallery images
├── blog/            # blog post featured images + inline media
├── reviews/         # optional photos attached to direct reviews
└── tmp/             # in-progress uploads, swept nightly
```

Upload flow:
1. Admin selects file → `POST /api/v1/media/upload` (multipart)
2. API validates: MIME type + magic-byte sniff, max size 10 MB, allowed types (`image/jpeg`, `image/png`, `image/webp`)
3. `sharp` resizes (cap dimension 2400px), strips EXIF, encodes original + responsive variants (`@1x`, `@2x`, webp)
4. Final files written to the appropriate subdirectory with content-hashed filenames (cache-friendly, no overwrite collisions)
5. DB row references the canonical filename only

Backups: the `media` volume is included in the nightly `pg_dump` + tarball routine and `age`-encrypted before offsite copy. Cloudflare cache rules on `/media/*` set long TTL (1 year) since filenames are content-hashed.

If volume usage approaches 80% of host disk, admin notification fires (see §12.4). Migration to S3-compatible storage (Cloudflare R2, Backblaze B2) is a future-plan trigger if storage growth or distribution becomes an issue.

---

## 12. Cross-Cutting Concerns

### 12.1 Logging

- Pino JSON logger across all Node services
- Request ID middleware: every inbound request gets a UUID, propagated to every log line and downstream call
- Log levels: `debug` (dev), `info` (default), `warn`, `error`. No `console.log` in committed code.
- Sensitive fields redacted at log-formatter level: `password`, `token`, `authorization`, `phone`, `email`

### 12.2 Error handling

- `DomainError` base class with `code: string`
- Global Nest exception filter maps domain errors → API error envelope
- Unhandled errors → 500 + structured log with stack + request ID
- Background jobs: errors propagate to BullMQ retry; permanent failures land in DLQ with full context

### 12.3 Rate limiting

- `@nestjs/throttler` globally: 100 req/min/IP for `/api/v1/*`
- Stricter on auth endpoints: `POST /auth/admin/login` 5/min/IP, `POST /auth/guest/request-link` 3/min/email
- Webhook endpoints are not rate-limited per IP (Stripe/Twilio routes through Cloudflare); they verify signatures instead

### 12.4 Audit logging

`AuditLogEntry` is written for every admin action that touches money or guest PII:
- Booking approval/decline/cancel/refund
- Guest record edits
- Cleaner roster changes
- Tax-rate changes
- Admin login (success + failure)

Each entry: actor (`admin_user_id`), action, target type+id, before/after JSON snapshot, IP, user-agent, timestamp.

### 12.5 Admin notifications

Decision D-018 (supersedes the trigger list portion of D-010; channels remain email + SMS simultaneous).

Every notification is delivered via **both** channels in parallel: MailerSend transactional email and Twilio SMS to the owner's phone. No browser/push notifications.

**Trigger events:**

| Category | Event | Source |
|---|---|---|
| Guest activity | New inquiry submitted | `InquiryService.create()` |
| Guest activity | New booking request submitted | `BookingService.requestToBook()` |
| Guest activity | Inbound guest SMS reply | Twilio webhook → `MessagingService` |
| Money | Stripe payment received (booking confirmed) | `checkout.session.completed` webhook |
| Money | Stripe dispute / chargeback opened | `charge.dispute.created` webhook |
| Cleaner | A cleaner accepted a turnover assignment | `CleanerService.handleAccept()` |
| Cleaner | Cleaner waterfall exhausted (all declined / timed out) | `CleanerWaterfallProcessor` |
| System | iCal sync failing for 24h+ | `CalendarSyncMonitor` daily check |
| System | PriceLabs sync failing | `PricelabsSyncProcessor` failure DLQ |
| System | Webhook processing errors (after retry exhaustion) | DLQ depth alert |
| System | Media volume usage > 80% of host disk | Health check job |

Notifications are produced by writing an `Outbox` row in the same transaction as the originating change; the drain enqueues `email-outbound` + `twilio-outbound` jobs. This guarantees notifications fire only when the source event durably commits.

Templates live in MailerSend with stable IDs. SMS bodies live in `MessageTemplate` rows of type `admin_notification` (one per event), allowing the owner to edit the wording.

### 12.6 Observability

- Health endpoints: `/health` (liveness), `/health/queues` (BullMQ depth + last-success per repeatable queue), `/health/integrations` (last successful sync timestamps for PriceLabs, Stripe webhook, each iCal feed)
- Admin dashboard surfaces these on a System view
- No external APM in V1 (single property, single host); revisit if reliability becomes an issue

---

## 13. Security Model

### 13.1 Token lifetimes

| Token | Length | Lifetime | Storage |
|---|---|---|---|
| Admin password hash | n/a | n/a | Argon2id at rest |
| Admin TOTP secret | 20 bytes | rotated on user request | encrypted at rest with `ADMIN_TOTP_KEY` |
| Admin recovery code | 12 chars (Crockford base32) × 10 codes | until used | hashed at rest |
| Admin session | 256-bit | 8h idle / 24h absolute | Redis |
| Guest magic link | 32 bytes | 15 min, single-use | SHA-256 hash in `MagicLinkToken` |
| Guest session JWT | HS256 | 7 days, rotating | client cookie |
| Cleaner portal token | 32 bytes | until revoked | SHA-256 hash in `CleanerToken` |
| Cleaner request action token | HMAC | 2h, single-use | not stored — verified by signature |
| Webhook event id | provider-supplied | 30 days | `WebhookEvent` (idempotency) |

### 13.2 Webhook signature verification

- Stripe: `Stripe-Signature` verified via `stripe.webhooks.constructEvent`; replay-protected by `WebhookEvent.id` unique constraint
- Twilio: `X-Twilio-Signature` verified via Twilio's documented HMAC-SHA1 algorithm using auth token
- MailerSend (delivery/bounce): signature verification per their docs
- All webhook handlers idempotent on `event.id`; second arrival is a no-op

### 13.3 PII handling

Decision D-006: **no app-level encryption** of guest PII (email/phone). Defense-in-depth at infrastructure layer:
- Full-disk encryption on the host (FileVault / LUKS)
- `pg_dump` backups encrypted with `age` before leaving the box
- Strict Postgres role permissions: app role has table-level grants only, no superuser
- TLS for every network hop (handled by Cloudflare Tunnel for ingress; internal traffic stays on Docker bridge)
- `AuditLogEntry` records every admin read/edit of guest data

### 13.4 PCI scope

Stripe Checkout (hosted) handles all card data. The platform's database **never** stores PAN, CVV, or any cardholder data. We store only Stripe object IDs (`stripe_customer_id`, `stripe_payment_intent_id`). Scope is SAQ A.

### 13.5 Cleaner accept/decline link safety

The PRD calls out unauthenticated accept/decline links — these are CSRF-vulnerable if naively implemented. Mitigations:
- Action token is single-use (consumed atomically via `UPDATE … WHERE used_at IS NULL RETURNING id`)
- Token is HMAC-bound to `(assignment_id, cleaner_id, action)`; an attacker can't substitute one for the other
- Token expires at the waterfall timeout (default 2h)
- Confirmation interstitial: clicking the link lands on a Nest-served page that requires a final "Confirm Accept" / "Confirm Decline" button. Defeats accidental email-scanner pre-fetching.

### 13.6 Inputs

- All inputs validated by Zod at the API edge
- HTML sanitization in blog post bodies via DOMPurify before rendering
- File uploads (gallery images, blog featured images) validated by MIME type + magic-byte sniff; stored under non-executable path; resized via `sharp` to strip EXIF + cap dimensions

---

## 14. Open Questions Resolved

The PRD §15 questions — and how this architecture resolves them:

| # | Question | Resolution |
|---|---|---|
| 1 | PriceLabs integration path | Customer API ($1/listing/mo), daily pull, cached in Postgres. Full plan: `docs/pricelabs-integration.md` |
| 2 | Oregon TLT rates | Oregon State **1.5%** + City of Redmond **9.0%** = **10.5%** combined. Deschutes County does **not** apply (property is within Redmond city limits). Two-jurisdiction data model. Full plan: `docs/loging-tax-plan.md` |
| 3 | iCal sync reliability | Poll each OTA feed every **30 min**. Worst-case sync delay is bounded by the OTAs' own poll cadence (Airbnb 2–3h, VRBO 30m). Request-to-book + manual "Sync Now" before approval is the real safeguard. Full plan: `docs/calendar-sync-plan.md` |
| 4 | Twilio number strategy | Single Twilio number for both guest messaging and cleaner requests; inbound routing matches sender against active cleaner / guest phones. (Decision D-008.) |
| 5 | Admin notification mechanism | **Simultaneous email + SMS** to admin for: new inquiry, inbound guest SMS, cleaner waterfall exhausted, payment received, dispute opened, iCal sync failure (after 24h). No browser notifications. (Decision D-010.) |
| 6 | Review scraping | Manual curation. Volume is small enough to be manageable; third-party services have ToS issues with Airbnb/VRBO. (Decision D-011.) |
| 7 | Stripe Connect vs. standard | Standard Stripe account. Connect is for marketplaces; multi-property under one owner doesn't need it. (Decision D-007.) |
| 8 | Astro rebuild performance | BullMQ-orchestrated build job with debouncing; rebuild expected under 60s for the V1 content footprint. Revisit incremental builds only if this exceeds 2 minutes. (Decision D-005.) |

PII-at-rest encryption (added during architecture review): infrastructure-level only, not app-level. (Decision D-006.)

---

## 15. Build Plan — Phase 1 Milestones

This maps PRD §14 Phase 1 to concrete, ordered milestones with the modules they touch. Each milestone has acceptance criteria; the next milestone doesn't start until criteria pass.

### M1 — Skeleton

- pnpm monorepo with workspaces wired
- `apps/api`, `apps/web`, `apps/admin`, `apps/build-worker`, `packages/shared`, `packages/prisma` exist and build
- Docker Compose runs Redis; api/web/admin/build-worker images build successfully
- Prisma schema written to V1 (all entities in §4.2); `prisma migrate dev` runs cleanly against host Postgres
- Seed script populates Property, two TaxJurisdiction rows, default MessageTemplates, one AdminUser
- `.env.example` complete; api boots with env validation passing

**Acceptance:** `pnpm install && docker compose up` produces a system where `curl http://localhost:3000/health` returns 200, `http://localhost` serves the Astro homepage placeholder, and `http://admin.localhost` serves the Vite admin shell.

### M2 — Admin auth (login + TOTP)

- `AuthModule` admin login endpoint, TOTP setup + verify, recovery codes
- Redis-backed session, CSRF middleware
- Admin login page + TOTP entry page in admin SPA
- Audit log entries on login success/failure

**Acceptance:** Admin can complete first-time TOTP enrollment; subsequent logins require TOTP; lockout after 5 failed attempts works; recovery codes work end-to-end.

### M3 — Property settings + manual pricing/availability

- `PropertyModule` settings CRUD
- `PricingModule` manual base rate + min-stay + cleaning fee
- `BlockedDate` manual block CRUD in admin (date-range picker)
- `TaxModule` calculation against the seeded jurisdictions

**Acceptance:** Admin can edit property details, base rate, min-stay; can add/remove manual blocks; calling `/api/v1/pricing/quote?from=…&to=…` returns the breakdown matching the tax plan §5.3 sample response.

### M4 — iCal export feed

- `CalendarModule` export controller + service (per `docs/calendar-sync-plan.md` §3)
- Cloudflare path rewrite for `/calendar.ics`

**Acceptance:** Pasting `https://owlsnest.com/calendar.ics` into Airbnb/VRBO imports succeeds; export feed contains all confirmed direct bookings + manual blocks; does **not** contain OTA-imported bookings; passes `webcal.fyi` validator.

### M5 — Public Astro site (Home / About / Gallery / Book / House Rules)

- Astro pages, brand-aligned design pulled from PRD §3.2
- Booking calendar React island calling `/api/v1/availability` and `/api/v1/pricing/quote`
- Min-stay enforcement and TLT line-item display

**Acceptance:** Lighthouse perf ≥ 90 on Home; calendar renders availability for the next 365 days within 1s; quote endpoint matches admin-side calculation byte-for-byte.

### M6 — Inquiry submission

- `InquiryModule` POST endpoint + Zod validation
- Astro Book page → React form → API
- Admin "Inquiries" view: list, detail, mark responded, convert to booking request
- MailerSend "new inquiry" email to admin

**Acceptance:** Submitting an inquiry from the public site lands an `Inquiry` row, sends admin an email + SMS, and is visible in the admin SPA.

### M7 — Request-to-book + Stripe Checkout

- `BookingModule` request → pending_approval state
- Admin approval action: creates Stripe Checkout Session, sends payment link via SMS + email
- Webhook handler for `checkout.session.completed` → flips booking to confirmed, emits `Outbox` rows for confirmation SMS/email and `rebuild-site`
- Conflict detection at approval time (calls `AvailabilityService` after a forced "Sync Now" on configured iCal feeds — but iCal **import** is not in Phase 1; in M7 the sync-now is a no-op until M2-of-Phase-2)

**Acceptance:** Full happy path — guest selects dates → submits booking request → admin approves → guest receives Stripe link → completes payment → confirmation SMS arrives → `BlockedDate` entry exists → export `.ics` reflects the new booking.

### M8 — Booking management actions

- Decline (with notification), cancel (with refund per cancellation tier), modify dates
- Refund flow: Prisma transaction wraps Stripe refund call to ensure consistency

**Acceptance:** All four actions work; cancellation tier logic uses configurable thresholds from Property settings; audit log captures every action.

**Phase 1 done:** the property can take direct bookings end-to-end. Phase 2 (cleaner SMS waterfall, guest messaging, iCal import) builds on this foundation.

---

## 16. What This Document Doesn't Cover

- Phase 2/3/4 milestone breakdowns at the same granularity — added as those phases approach
- Specific UX flows / page wireframes — that's design's job, this is engineering architecture
- Exact NestJS module file layouts (`*.module.ts`, `*.service.ts`, `*.controller.ts`) — that's for the implementing PR, not architecture
- Test strategy beyond high-level: per-module unit tests (Vitest) + a small E2E suite (Playwright) hitting the booking flow and webhook handlers. Detailed test plan added during M1.

When in doubt: this document is the source of truth for *how the system is built*; the PRD is the source of truth for *what it does*; the supplemental plans (`pricelabs-integration.md`, `loging-tax-plan.md`, `calendar-sync-plan.md`) are the source of truth for *how each integration works*.
