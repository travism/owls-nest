# Carryovers

Loose ends and deferred work — things noticed during a milestone that didn't block the milestone but need to land before production, before a future milestone, or "if X happens."

Not the same as future features (those live in `PRD.md` + `BUILD-PLAN.md` phasing). Carryovers are *small things we owe ourselves* that don't fit a feature milestone.

**Status:** `🟢 Open` · `🟡 In progress` · `✅ Done` · `🚫 Won't fix`

When closing a carryover, mark `✅ Done` with the commit/branch reference and the date — keep the row for history.

---

## Open

### CO-1 — Real Redis on host (or Compose) for dev sessions
- **Origin:** M2
- **Type:** infrastructure
- **Status:** 🟢 Open

The API currently falls back to `express-session` MemoryStore when Redis is unreachable. Fine for local dev, but:
- Sessions die on API restart (re-login required after every code change)
- Production *must* use Redis (multi-process, persistence)
- BullMQ queues (cleaner waterfall, iCal poll, etc.) won't work without Redis — blocking M2.x

**Resolution paths:**
1. Install Redis on the host (`brew install redis` once Xcode CLT is available, or download a precompiled binary).
2. Run Redis in Compose only (already wired in `docker/docker-compose.yml`); skip host install entirely. `docker compose up redis` and set `REDIS_HOST=localhost` in dev `.env`.

**When:** before starting M2.x (Phase 2: cleaner waterfall).

---

### CO-2 — Cloudflare path rewrite for `/calendar.ics`
- **Origin:** M4
- **Type:** deploy
- **Status:** 🟢 Open

Production should expose the iCal feed at the clean URL `https://owlsnest.com/calendar.ics`. The actual route is `/api/v1/calendar/export.ics`. Cloudflare Tunnel rules need a path rewrite.

**When:** production deploy step. Add to the deploy runbook (CO-5).

---

### CO-3 — `webcal.fyi` validator pass
- **Origin:** M4
- **Type:** deploy
- **Status:** 🟢 Open

The export feed needs to validate cleanly against `webcal.fyi` (or equivalent RFC 5545 validator). Requires a public hostname so an external service can fetch it.

**When:** part of the production deploy checklist, once Cloudflare Tunnel is up.

---

### CO-4 — Production deploy runbook
- **Origin:** ongoing — referenced by CO-2, CO-3
- **Type:** deploy
- **Status:** 🟢 Open

We don't yet have a step-by-step "deploy to production" doc. PRD §13 sketches the architecture but not the procedure. Should cover:
- `git pull` + `pnpm install --frozen-lockfile` + `pnpm prisma migrate deploy`
- `docker compose -f docker/docker-compose.yml up -d --build`
- `cloudflared` configuration (tunnel + path rewrites — addresses CO-2)
- Initial admin TOTP enrollment
- Backup setup (`pg_dump` + `age` + offsite copy)
- Smoke tests (CO-3 + sanity checks)

**When:** before the first guest can book directly. Probably mid-Phase 1 (after M7 ships the booking flow).

---

### CO-5 — Multi-admin / RBAC schema
- **Origin:** D-013 (single admin with TOTP from day one)
- **Type:** future-only
- **Status:** 🚫 Won't fix until needed

`AdminUser` is a regular table; the schema supports multiple admins. RBAC is not built. Revisit only if multiple humans need admin access. PRD does not require it.

**When:** never, unless requirements change.

---

### CO-6 — App-level encryption of PII (email/phone)
- **Origin:** D-006 (defense-in-depth at infrastructure layer only)
- **Type:** future-only
- **Status:** 🚫 Won't fix until multi-tenant

Disk encryption + encrypted backups are sufficient at single-property scale. Revisit if the platform expands to multi-tenant or B2B.

**When:** never, unless scope changes per D-006.

---

### CO-7 — Per-date pricing overrides + PriceLabs cache
- **Origin:** M3 notes
- **Type:** feature deferred
- **Status:** 🟢 Open (M3.10 + M3.9 in Phase 3)

`PricingOverride` table exists in the schema but isn't wired. PriceLabs Customer API integration scoped for Phase 3.

**When:** Phase 3 (M3.9, M3.10).

---

### CO-11 — Rate limiting on the API (`@nestjs/throttler`)
- **Origin:** M6 (became real with the first spam-attractive public POST)
- **Type:** hardening
- **Status:** 🟢 Open

ARCHITECTURE.md §12.3 specifies `@nestjs/throttler` globally at 100 req/min/IP for `/api/v1/*` with stricter limits on `/auth/*` and public POSTs. Currently nothing throttles. This was tolerable while every public endpoint was an idempotent GET (property, availability, pricing/quote, calendar/export.ics) — caching at Cloudflare absorbs most abuse. M6 just shipped `POST /api/v1/inquiries`, which writes a DB row + an Outbox row per request. M7 will add `POST /api/v1/bookings`, same shape. Both are ripe for spam.

Per arch §12.3, limits to wire:
- Global: 100 req/min/IP across `/api/v1/*`
- `/api/v1/auth/admin/login`: 5/min/IP + 5/min/email
- `/api/v1/auth/guest/request-link` (M3.7): 3/min/email
- `/api/v1/inquiries`: distinct stricter limit (suggest 5/min/IP, 20/day/IP)
- `/api/v1/bookings` (M7): same shape as inquiries

**When:** before M7 ships, or as a small dedicated commit between M6 and M7. Adds `@nestjs/throttler` dep, a global guard registration, and per-route `@Throttle()` decorators on the sensitive endpoints. Tests: an e2e that fires N+1 requests and asserts the last one is 429 RATE_LIMITED.

---

### CO-10 — Lighthouse perf ≥ 90 on Home
- **Origin:** M5
- **Type:** deploy
- **Status:** 🟢 Open

PRD non-functional requirement: guest site pages load in under 2 seconds; Lighthouse perf ≥ 90 on Home. Needs to be measured against the production-built site over the network (not the dev server, which is unminified and serves source maps). Should be part of the production deploy checklist alongside CO-3 (webcal.fyi).

**When:** part of CO-4 (production deploy runbook).

---

### CO-8 — Media volume → S3-compatible migration
- **Origin:** D-016
- **Type:** infrastructure (conditional)
- **Status:** 🚫 Won't fix until needed

Host filesystem media is fine until volume usage approaches 80% of host disk OR distribution becomes an issue (CDN concerns at scale). Admin notification fires at 80% capacity (per D-018) — that's the trigger.

**When:** only if the 80% notification fires.

---

## Done

*(Move closed carryovers here with date + commit reference. Keep the original entry for history.)*

### CO-9 — CSRF error envelope unification (RESOLVED)
- **Origin:** M2
- **Type:** refactor
- **Status:** ✅ Done — 2026-04-25, commit `525e36b` (merge `f6a1947`)

Global `ApiExceptionFilter` normalizes every error into `{error: {code, message, details?}}`. SPA + TestClient now retry on `code === 'CSRF_INVALID'` only.

---

## How to use this file

- **When you finish a milestone and notice something deferred:** add a `CO-N` entry under "Open."
- **When you start a carryover:** flip status to 🟡, optionally branch as `fix/CO-N-description`.
- **When you close one:** flip to ✅ Done with the commit reference and date. Move under "Done." Don't delete — keep the history.
- **Reference carryovers from BUILD-PLAN milestones** by ID (e.g., "depends on CO-1"). That keeps the milestone tight and the carryover discoverable.

The "Current focus" pointer at the top of `BUILD-PLAN.md` should link here so anyone scanning the plan sees the open list.
