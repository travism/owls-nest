# The Owl's Nest

Self-hosted booking and operations platform for **The Owl's Nest** short-term rental at 147 SW 4th St, Redmond, OR. Replaces a Beds24 + NestReady setup with a single owner-operated system that owns the booking engine, the brand site, and all day-to-day operational tooling.

## What it does

- **Direct booking site** — Astro-rendered marketing pages with a React-island booking calendar, request-to-book flow, and Stripe Checkout for payments.
- **Owner admin dashboard** — React SPA for approving bookings, managing pricing and availability, scheduling cleaners, messaging guests, editing blog content, and reviewing financials.
- **Cleaner coordination** — priority-ranked SMS waterfall via Twilio. Cleaners accept/decline turnovers via single-click links; portal pages show their upcoming assignments.
- **Two-way guest messaging** — single Twilio number, inbound routing by sender match, threaded conversations in the admin.
- **OTA calendar sync** — iCal import from Airbnb and VRBO every 30 minutes; export feed for OTAs to consume. Request-to-book approval is the primary double-booking safeguard.
- **Dynamic pricing** — daily pull from PriceLabs Customer API into a Postgres rate cache.
- **Tax handling** — per-jurisdiction tracking for Oregon State (1.5%) + City of Redmond (9%) transient lodging tax with monthly/quarterly filing reports.
- **Admin auth** — single user with TOTP 2FA + recovery codes, Argon2id password hashing, lockout after 5 failed attempts.

See [`docs/PRD.md`](docs/PRD.md) for the full product spec, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the technical design, [`docs/DECISION-LOG.md`](docs/DECISION-LOG.md) for the locked-in decisions, and [`docs/BUILD-PLAN.md`](docs/BUILD-PLAN.md) for the milestone tracker.

## Tech stack

| Layer | Technology |
|---|---|
| Guest site (`apps/web`) | Astro 4 SSG + React islands |
| Admin SPA (`apps/admin`) | Vite + React 18 + React Router v6 + TanStack Query |
| API (`apps/api`) | NestJS 10 + Pino + Argon2id + otplib + csrf-csrf |
| Build worker (`apps/build-worker`) | BullMQ consumer (`rebuild-site` queue) |
| Shared (`packages/shared`) | Zod schemas |
| Database (`packages/prisma`) | Prisma 5 + Postgres 14+ |
| Queue / sessions | Redis 7 (Compose service in prod, MemoryStore fallback in dev) |
| Containerization | Docker Compose |
| Public ingress | Cloudflare Tunnel |

## Repository layout

```
owls-nest/
├── apps/
│   ├── api/              NestJS API + queue workers
│   ├── web/              Astro guest site
│   ├── admin/            Vite + React admin SPA
│   └── build-worker/     Astro rebuild consumer
├── packages/
│   ├── shared/           Zod schemas, shared types
│   └── prisma/           Schema, migrations, generated client, seed
├── docker/               Compose + Dockerfiles + nginx configs
├── docs/                 PRD, ARCHITECTURE, DECISION-LOG, BUILD-PLAN, plan docs
└── .husky/               Git hooks (pre-commit, pre-push)
```

---

## Setup on a new dev machine

### Prerequisites

| Tool | Version | How to install (macOS) |
|---|---|---|
| Node.js | 20.x LTS | `nvm install 20 && nvm use` |
| pnpm | 9.x | `npm install -g pnpm@9` (after Node) |
| Postgres | 14+ | Postgres.app, `brew install postgresql@16`, or Postgres.app installer |
| Git | any recent | typically pre-installed |
| Docker | optional | only needed for `docker compose up` (production-like) |
| Redis | optional | only needed for full dev (sessions/queues); MemoryStore fallback works otherwise |

`.nvmrc` pins Node 20 — `nvm use` in the repo root will pick it up. `package.json` pins `pnpm@9.15.9` via `packageManager`.

### 1. Clone and install

```bash
git clone <repo-url> owls-nest
cd owls-nest
nvm use                        # picks up .nvmrc
pnpm install
```

### 2. Postgres setup

The platform uses Postgres on the host (not containerized) per the architecture decision. You need two databases — one for dev, one for the test suite:

```bash
# Create a role with login + createdb
psql -d postgres -c "CREATE ROLE owlsnest WITH LOGIN CREATEDB PASSWORD 'owlsnest';"

# Create both databases owned by that role
psql -d postgres -c "CREATE DATABASE owlsnest OWNER owlsnest;"
psql -d postgres -c "CREATE DATABASE owlsnest_test OWNER owlsnest;"

# Verify
PGPASSWORD=owlsnest psql -U owlsnest -h localhost -d owlsnest -c "SELECT current_user, current_database();"
```

The default credentials (`owlsnest` / `owlsnest`) are fine for local dev. **Change them for any non-local deployment** — see `.env.example` for the full set of secrets.

### 3. Environment

```bash
cp .env.example .env
```

For local dev, the only critical change is the `DATABASE_URL` host. The example file uses `host.docker.internal` (correct for Compose); local dev should use `localhost`:

```
DATABASE_URL=postgresql://owlsnest:owlsnest@localhost:5432/owlsnest
```

The integration secrets (Stripe / Twilio / MailerSend / PriceLabs / etc.) can stay empty until you wire those features. The API treats empty env values as "not configured" rather than errors.

For production, generate strong secrets:

```bash
# 32+ char random strings
openssl rand -hex 32   # ADMIN_TOTP_KEY
openssl rand -hex 32   # SESSION_SECRET
openssl rand -hex 32   # CLEANER_TOKEN_SECRET
```

### 4. Database migrations + seed

```bash
# Apply schema migrations to dev DB
pnpm prisma:migrate

# Apply migrations to the test DB (run once)
DATABASE_URL="postgresql://owlsnest:owlsnest@localhost:5432/owlsnest_test" \
  pnpm --filter @owlsnest/prisma exec prisma migrate deploy

# Seed the dev DB with the property + tax jurisdictions + default templates
pnpm prisma:seed
```

The seed inserts:
- One `Property` row (The Owl's Nest, Redmond)
- Two `TaxJurisdiction` rows (Oregon State 1.5%, Redmond City 9%)
- Seven `MessageTemplate` rows (booking confirmation, pre-arrival, post-stay, plus four admin-notification templates)
- One `AdminUser` placeholder (`admin@owlsnest.local`) with the password set to `PLACEHOLDER-MUST-RESET` — first login redirects to the setup flow.

### 5. Run dev servers

```bash
pnpm dev
```

This starts three apps in parallel:

| URL | App |
|---|---|
| http://localhost:3000/health | API (NestJS) |
| http://localhost:4321 | Guest site (Astro) |
| http://localhost:5173 | Admin SPA (Vite + React) |

Ports listed but not started by `pnpm dev`:
- `apps/build-worker` requires Redis. Start it with `pnpm dev:build-worker` only after Redis is up locally.

### 6. First-time admin login

1. Open http://localhost:5173/login
2. Sign in as `admin@owlsnest.local` with any password ≥ 12 characters — the API detects the placeholder and redirects to `/setup`.
3. On the setup page: confirm password, scan the QR code with any TOTP app (Google Authenticator, 1Password, Authy), enter the 6-digit code.
4. Save the 10 recovery codes shown — they're only displayed once.
5. You'll land on the dashboard.

To reset the admin (e.g. to re-run the setup flow):

```bash
PGPASSWORD=owlsnest psql -U owlsnest -h localhost -d owlsnest -c \
  "UPDATE admin_user SET password_hash='PLACEHOLDER-MUST-RESET', totp_secret_encrypted=NULL, totp_enrolled_at=NULL, recovery_codes_hashed='{}', failed_attempts=0, locked_until=NULL WHERE email='admin@owlsnest.local';"
```

---

## Common commands

| Command | Effect |
|---|---|
| `pnpm dev` | API + web + admin in parallel (watch mode) |
| `pnpm build` | Build all apps + packages |
| `pnpm typecheck` | TypeScript check across the workspace |
| `pnpm test` | Unit suites (shared + admin + api unit) — fast |
| `pnpm test:e2e` | API e2e tests (boots Nest + hits real Postgres test DB) |
| `pnpm test:all` | Full suite (unit + e2e) |
| `pnpm prisma:migrate` | Apply Prisma migrations to dev DB |
| `pnpm prisma:seed` | Run the seed script |
| `pnpm --filter @owlsnest/prisma exec prisma studio` | Open Prisma Studio against dev DB |

## Testing

Two runners:

- **Jest** for `apps/api` — unit specs co-located as `*.spec.ts`; e2e under `apps/api/test/*.e2e-spec.ts` boot the full Nest app via `@nestjs/testing` and hit endpoints with supertest.
- **Vitest** for `packages/shared` and `apps/admin`.

Tests run automatically on git operations:
- `pre-commit` → typecheck + unit tests (~30s)
- `pre-push` → full suite incl. e2e (~80s, requires Postgres)

To bypass in an emergency (don't make a habit of it): `git commit --no-verify` / `git push --no-verify`.

**Discipline rule:** every milestone ships with tests. Acceptance criteria for any new feature includes the relevant tests passing. See `docs/BUILD-PLAN.md` § "Testing discipline".

---

## Production deploy (preview)

Production uses Docker Compose for `api` / `web` / `admin` / `build-worker` / `redis`, with Postgres on the host and Cloudflare Tunnel handling ingress. Compose file at `docker/docker-compose.yml`. Detailed deploy runbook lands with the production milestone.

---

## Documentation map

| File | What it covers |
|---|---|
| `docs/PRD.md` | Product requirements, features, scope. The "what and why." |
| `docs/ARCHITECTURE.md` | Technical design — modules, data layer, auth, integrations, security. The "how." |
| `docs/DECISION-LOG.md` | Locked-in decisions with rationale. Append-only; supersede rather than rewrite. |
| `docs/BUILD-PLAN.md` | Milestone tracker — current focus, completed work, what's next. |
| `docs/pricelabs-integration.md` | PriceLabs Customer API integration plan. |
| `docs/loging-tax-plan.md` | Oregon transient lodging tax — rates, filing schedule, data model. |
| `docs/calendar-sync-plan.md` | iCal import/export implementation reference. |
| `CLAUDE.md` | Development directives followed by AI agents working on this repo. |

---

## Status

| Milestone | Status |
|---|---|
| M1 — Monorepo skeleton + Compose + Prisma schema | ✅ Complete |
| M2 — Admin auth (login + TOTP + recovery + lockout) | ✅ Complete |
| M3 — Property settings + manual pricing/availability + tax quote | ⬜ Next |
| M4 — iCal export feed | ⬜ |
| M5 — Public Astro site (Home/About/Gallery/Book/House Rules) | ⬜ |
| M6 — Inquiry submission | ⬜ |
| M7 — Request-to-book + Stripe Checkout | ⬜ |
| M8 — Booking management actions | ⬜ |

See `docs/BUILD-PLAN.md` for milestone detail.

---

## Working with Claude Code on this repo

This codebase is built collaboratively with Claude Code. A new machine setup that lets Claude Code pick up where it left off:

1. Run the **Setup on a new dev machine** steps above (clone, install, Postgres, env, migrations, seed).
2. Start Claude Code in the repo root: `claude` (or open in your IDE with the Claude Code extension).
3. Ask: *"Where are we in the build plan?"* — Claude will read `docs/BUILD-PLAN.md` "Current focus" and continue.

Claude follows the directives in `CLAUDE.md` (read code before answering, ask before major changes, keep changes simple, log decisions, etc.). The four canonical sources of truth Claude reads first:

- `docs/PRD.md` — what the platform is supposed to do
- `docs/ARCHITECTURE.md` — how it's designed
- `docs/DECISION-LOG.md` — what's already been decided (and why)
- `docs/BUILD-PLAN.md` — what's done and what's next

If you switch machines mid-milestone, commit work-in-progress to a feature branch first; Claude can pick up the branch on the other machine without losing context.
