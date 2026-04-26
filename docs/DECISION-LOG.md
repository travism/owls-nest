# Decision Log — The Owl's Nest Platform

This log captures architectural and product decisions that shape the platform. New features must not violate existing decisions without an explicit superseding entry.

**Format:** each entry has a stable ID (`D-NNN`), date, status, decision, alternatives considered, rationale, and consequences.

---

## D-001 — Email provider: MailerSend

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Use MailerSend for all transactional email (magic links, booking confirmations, decline notices, payment links, post-stay review requests, admin notifications).

**Alternatives considered:** Postmark, Resend, AWS SES.

**Rationale:** MailerSend offers a free tier sufficient for a single-property operation, hosted templates with variable interpolation, good deliverability, and webhook-based delivery/bounce reporting.

**Consequences:** Templates managed in MailerSend dashboard, referenced by template ID in env config. Requires sender-domain DNS setup (SPF, DKIM, DMARC) before going live. Lock-in is shallow — adapter pattern in `IntegrationsModule` allows future swap.

---

## D-002 — Job queue: BullMQ on Redis

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** BullMQ (Redis-backed) is the only job/queue mechanism in production. Nothing uses `setInterval` or `@nestjs/schedule` for production work.

**Alternatives considered:** `@nestjs/schedule` cron (DB-polled), Temporal, RabbitMQ.

**Rationale:** BullMQ gives us repeatable jobs, exponential backoff, dead-letter queues, and idempotency keys with minimal infrastructure. Redis is the only added moving part. The cleaner waterfall, iCal poll, magic-link cleanup, PriceLabs sync, and Astro rebuild all benefit from the same infrastructure.

**Consequences:** Redis added as a Compose service. All side-effecting workflows go through queues, paired with the Outbox pattern for transactional consistency. Adds operational requirement: Redis persistence configured, backed up.

---

## D-003 — ORM: Prisma

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Prisma is the ORM. Schema lives in `packages/prisma/schema.prisma`; migrations are timestamped and version-controlled.

**Alternatives considered:** TypeORM, Drizzle, Kysely.

**Rationale:** Schema-first migrations avoid decorator drift; better type inference for nested writes (booking → tax breakdown → blocked date); strong DX for the small team.

**Consequences:** Generated client published as `@owlsnest/prisma`. Single source of truth for schema. Migrations applied in production via `prisma migrate deploy` on api container start.

---

## D-004 — Repo structure: pnpm monorepo

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Single pnpm-workspaces monorepo containing apps (`web`, `admin`, `api`, `build-worker`) and packages (`shared`, `prisma`).

**Alternatives considered:** Polyrepo (one repo per service), Nx, Turborepo.

**Rationale:** Single owner, single deployment. Sharing Zod schemas between Astro/admin/api is the primary driver — schema drift is the most likely source of bugs in a typed contract. pnpm workspaces are minimal overhead vs. Nx/Turbo.

**Consequences:** Apps depend on packages; packages never depend on apps. ESLint enforces this. Adding a new app/package is a one-line workspace addition.

---

## D-005 — Astro rebuild mechanism: BullMQ-orchestrated build worker

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Publishing content enqueues a `rebuild-site` BullMQ job. A dedicated `build-worker` container consumes the job, runs `astro build`, and atomically swaps the `web` container's mounted output volume. Builds are debounced with a 30-second window.

**Alternatives considered:**
- A. NestJS `docker exec`s into the web container to run `astro build` — requires Docker socket inside the api container, broad blast radius if api is compromised.
- B. Shared filesystem trigger file watched by build-worker — works but reinvents queue mechanics.

**Rationale:** Reuses the BullMQ infrastructure already in stack. No Docker socket exposure. Built-in retry/observability. Debouncing handles rapid successive publishes.

**Consequences:** `build-worker` is a fourth service in Compose. Volume layout: `web-dist` named volume mounted ro into `web`, rw into `build-worker`. Builds expected under 60s for V1 content footprint; revisit incremental builds only if this exceeds 2 minutes.

---

## D-006 — PII at rest: infrastructure-level encryption only

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Guest PII (email, phone) is stored in plaintext in Postgres. Encryption is provided at the infrastructure layer: full-disk encryption on the host, `age`-encrypted backups before they leave the box, strict Postgres role permissions, TLS for all network hops.

**Alternatives considered:** Application-level column encryption (encrypt `email`/`phone` columns with a KMS key); transparent data encryption at the Postgres layer.

**Rationale:** Single-property operation, single host the owner physically controls; Stripe handles all payment data (PCI offloaded). The realistic threat model is stolen host, leaked backup, or compromised app. Disk + backup encryption addresses the first two; app-level column encryption adds key-management pain and breaks lookup without meaningfully addressing the third (a compromised app has the decryption key by definition).

**Consequences:** Host must use full-disk encryption (FileVault on macOS, LUKS on Linux). Backups encrypted with `age` before offsite copy. App role gets table-level grants only, no superuser. AuditLogEntry tracks every admin read/edit of guest data. Revisit if the platform expands to multi-tenant or B2B.

---

## D-007 — Stripe: standard account, not Connect

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Use a standard Stripe account. No Stripe Connect.

**Alternatives considered:** Stripe Connect for future multi-property support.

**Rationale:** Connect is for marketplaces with multiple merchants. A single owner operating multiple properties uses one Stripe account regardless. Connect adds onboarding friction and platform-fee complexity that doesn't apply.

**Consequences:** Customer objects, payment intents, refunds all under one account. If business model ever changes (e.g., listing other owners' properties), revisit.

---

## D-008 — Twilio: single phone number with inbound routing

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** One Twilio phone number serves both guest messaging and cleaner requests. Inbound SMS is routed by matching the sender's number against active cleaners and recent-booking guests.

**Alternatives considered:** Two separate Twilio numbers (one for guests, one for cleaners).

**Rationale:** Single number presents one business identity. Cheaper (one number's monthly fee). Routing is unambiguous in practice — cleaner roster and guest list rarely overlap, and ambiguous matches surface to the admin for manual disambiguation.

**Consequences:** `WebhooksModule` maintains the routing logic. Edge case where a cleaner is also a past guest is handled by precedence (active cleaner takes priority).

---

## D-009 — iCal poll interval: 30 minutes

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Poll each configured OTA iCal feed every 30 minutes via BullMQ repeatable job. Manual "Sync Now" available before approval.

**Alternatives considered:** 15-min poll (PRD default), 5-min poll, on-demand only.

**Rationale:** OTAs themselves only update their export feeds within 30 min (VRBO) to several hours (Airbnb), so polling more aggressively yields diminishing returns. 30 min stays well below any reasonable rate-limit threshold. Request-to-book approval flow + manual sync-now before approval is the real safeguard against double bookings; iCal sync just minimizes the window.

**Consequences:** Worst-case undetected OTA booking is 30 minutes plus the OTA's own export-feed lag. Acceptable given the manual-approval flow. Configurable per-feed in admin Settings if specific feeds need adjusting.

---

## D-010 — Admin notifications: email + SMS simultaneous, no browser notifications

- **Date:** 2026-04-25
- **Status:** Accepted (channels) / Trigger list superseded by D-018

**Decision:** Admin is notified via simultaneous MailerSend email and Twilio SMS to the owner's phone for the following events: new inquiry, inbound guest SMS, cleaner waterfall exhausted (no cleaner accepted), payment received, dispute opened, iCal sync failure persisting more than 24 hours. No browser/push notifications.

**Alternatives considered:** Browser push notifications, in-app-only notifications, SMS-only, email-only.

**Rationale:** Owner is mobile and doesn't keep the admin SPA open. Email + SMS hits both async (email for context) and sync (SMS for urgency) channels. Browser notifications require service worker + permission flow with marginal benefit when the SPA isn't open.

**Consequences:** Notification preferences will become per-user and per-event configurable in future iterations. For V1, hardcoded list above. Twilio + MailerSend usage scales roughly with booking volume — modest at single-property scale.

---

## D-011 — Reviews: manual curation only

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** OTA reviews are manually copied from Airbnb/VRBO into the admin "Reviews" view. No third-party aggregation/scraping service.

**Alternatives considered:** Third-party review aggregators (e.g., Revyoos, Hostfully review widget).

**Rationale:** Volume at single-property scale is manageable manually. Airbnb's and VRBO's terms of service prohibit automated scraping; aggregators tread on this gray area, with risk to listing standing.

**Consequences:** The admin Review form requires guest name, platform source, rating, body, date. Direct reviews collected via post-stay link are auto-populated; OTA reviews are manual entry.

---

## D-012 — Tax model: per-jurisdiction tracking (Oregon State + Redmond City)

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** The PRD's single `tax_rate_percentage` field on `Property` and single `tax_amount` on `Booking` are replaced with a `TaxJurisdiction` table (one row per applicable tax) and per-jurisdiction columns on `Booking` (`state_tlt_amount`, `city_tlt_amount`, `total_tax_amount`, `state_admin_fee_retained`, `tax_exempt`, `ota_remitted_state`, `ota_remitted_city`). Seed values: Oregon State 1.5%, City of Redmond 9.0%. Combined effective rate: 10.5%.

**Alternatives considered:** Single combined tax rate (PRD original), inline columns on `Property` without a separate table.

**Rationale:** The two taxes file separately (state quarterly, city monthly), have different exemption rules, and OTAs may remit one but not both. Per-jurisdiction tracking is the only way to produce accurate filing reports. The `TaxJurisdiction` table also supports rate history (when a rate changes, close the old row with `effective_to` and insert a new one).

**Consequences:** Admin sees two tax line items on the public Book page ("Oregon Lodging Tax 1.5%" and "Redmond Lodging Tax 9.0%"). Tax filing reports in admin are mapped directly to state quarterly and city monthly forms. Deschutes County **does not** apply because the property is within Redmond city limits — verified in `docs/loging-tax-plan.md`.

**Reference:** `docs/loging-tax-plan.md` is the authoritative tax plan.

---

## D-013 — Admin auth: single user with mandatory TOTP 2FA

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** The single admin account requires TOTP 2FA from day one. Login is email + password (Argon2id) + 6-digit TOTP code. Recovery codes generated at TOTP setup. Server-side session in Redis with 8-hour idle / 24-hour absolute timeout. CSRF token required on all state-changing admin endpoints.

**Alternatives considered:** Password-only (defer 2FA), passwordless (magic link to admin email), WebAuthn.

**Rationale:** The admin account can refund payments and edit guest data. The cost of compromise is high. TOTP is well-supported (Google Authenticator, 1Password, Authy), avoids SMS-2FA SIM-swap risk, and can be set up before the first real booking.

**Consequences:** First-time login requires TOTP enrollment flow. Recovery codes must be saved by the user; loss without recovery codes requires a manual database reset. Schema supports multiple admin users when that's needed; RBAC is not built in V1.

---

## D-014 — PriceLabs: read-only daily sync via Customer API

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Use the PriceLabs Customer API ($1/listing/month) to pull recommended rates. Sync runs once daily at 06:00 PT via BullMQ repeatable job. Rates cached in Postgres `PricingCacheEntry`. Quote endpoint always reads cache, never live.

**Alternatives considered:** PriceLabs Integration API (IAPI) — requires partnership/certification, not appropriate for single-property custom engine. Manual price management. Alternative provider (Wheelhouse, Beyond, DPGO).

**Rationale:** Customer API is purpose-built for hosts pulling their own rates to a custom site. PriceLabs already syncs to VRBO; one-way pull to our DB keeps rates aligned without touching the booking/availability flow. Daily cadence matches PriceLabs's own recompute interval.

**Consequences:** $1/listing/month operational cost. Cache TTL effectively 24 hours; admin sees stale-data banner if cache exceeds 48 hours. Manual override capability per `PricingOverride` table for edge cases.

**Reference:** `docs/pricelabs-integration.md` is the authoritative integration plan.

---

## D-015 — iCal export: only direct bookings + manual blocks (no re-export of OTA bookings)

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** The platform's iCal export feed (`/api/v1/calendar/export.ics`) contains only direct booking ranges (statuses: `approved`, `confirmed`, `completed`) and manual/maintenance blocks. It explicitly excludes blocked dates that originated from OTA imports.

**Alternatives considered:** Re-export everything (including OTA bookings).

**Rationale:** Re-exporting OTA bookings causes Airbnb to see its own bookings reflected back, creating dashboard confusion. The cleaner approach is for each OTA to know about its own bookings directly and only learn about the others via the platform's filtered export.

**Consequences:** `BlockedDate` rows include `source_platform` and the export query filters them out. `Booking.source = 'direct'` is the export inclusion criterion for booking rows.

**Reference:** `docs/calendar-sync-plan.md` §3.2 is the authoritative export logic.

---

## D-016 — Media storage: host filesystem on a Compose volume

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Gallery photos, blog featured images, and other uploaded media live on a Compose-managed `media` volume mounted at `/var/owlsnest/media` in the `api` container (read-write) and `/usr/share/nginx/html/media` in the `web` container (read-only). Public URLs: `https://owlsnest.com/media/<path>`. Files are content-hash named, included in nightly encrypted backups.

**Alternatives considered:** S3-compatible object store (Cloudflare R2, Backblaze B2).

**Rationale:** Matches the self-hosted philosophy of the rest of the platform. Avoids adding an external dependency, credentials to rotate, and a second backup target. Volume is small enough at single-property scale that local disk is fine. Cloudflare's edge caching covers distribution.

**Consequences:** Upload path validates MIME + magic bytes, caps size at 10 MB, accepts only `image/jpeg`, `image/png`, `image/webp`. `sharp` strips EXIF, resizes to ≤2400px, generates responsive variants. Volume monitored for disk usage; admin notified at 80% capacity. Migrate to S3-compatible if storage growth or distribution becomes an issue.

---

## D-017 — Admin SPA router: React Router v6

- **Date:** 2026-04-25
- **Status:** Accepted (supersedes initial draft of TanStack Router)

**Decision:** Use React Router v6 for the admin SPA.

**Alternatives considered:** TanStack Router (typed routes, search-params first-class).

**Rationale:** Mainstream choice. Largest ecosystem, easiest onboarding for any future contributor, well-documented integration with TanStack Query. TanStack Router's typing benefits don't outweigh its smaller community and shorter track record at this stage.

**Consequences:** Search params are loosely typed at the route boundary; we'll wrap them with Zod parsers where they matter (filters, pagination cursors).

---

## D-018 — Admin notification trigger list

- **Date:** 2026-04-25
- **Status:** Accepted (supersedes the trigger-list portion of D-010; channels in D-010 remain valid)

**Decision:** The full list of events that fire an admin notification (email + SMS simultaneous):

- **Guest activity:** new inquiry, new booking request, inbound guest SMS reply
- **Money events:** Stripe payment received (booking confirmed), Stripe dispute or chargeback opened
- **Cleaner accepted:** any cleaner accepts a turnover assignment
- **Cleaner waterfall exhausted:** all cleaners declined or timed out
- **System failures:** iCal sync failing 24h+, PriceLabs sync failing, webhook processing errors after retry exhaustion, media volume >80% capacity

**Alternatives considered:** Smaller list (only urgent events), larger list (every state change).

**Rationale:** The owner is mobile and not constantly watching the dashboard. The events above are the ones that require either acknowledgment (cleaner accepted, payment received) or action (everything else). Adding "cleaner accepted" was an explicit user request — it provides closure on a waterfall that may have escalated through several cleaners.

**Consequences:** Each event has a `MessageTemplate` row of type `admin_notification` allowing the owner to edit wording. All notifications produced via the Outbox so they fire only on durable commit. Notification preferences will become per-user/per-event configurable in a future iteration; for V1, this list is hardcoded.

---

## D-019 — Inferred schema additions ratified for V1

- **Date:** 2026-04-25
- **Status:** Accepted

**Decision:** Four schema entities not in the PRD's data model are confirmed for the V1 Prisma schema:

- **`Outbox`** — transactional outbox table. Side effects (jobs, notifications) are written in the same transaction as the originating DB write; a drain worker enqueues real jobs. Guarantees no orphan side-effects on rollback and no double-fire on retry.
- **`WebhookEvent`** — idempotency table keyed on the provider's event ID (Stripe `event.id`, Twilio `MessageSid`). Webhook handlers no-op on duplicate event IDs.
- **`AuditLogEntry`** — every admin action touching money or guest PII (approve, decline, cancel, refund, edit guest, login). Useful for support, dispute defense, and accountability. Detail per ARCHITECTURE.md §12.4.
- **`CleanerRequestToken`** — single-use HMAC-signed tokens bound to `(assignment_id, cleaner_id, action)` for SMS accept/decline links. Prevents CSRF and replay attacks against unauthenticated action links.

**Alternatives considered:** Skip Outbox (rely on at-least-once retry semantics), skip WebhookEvent (rely on handler idempotency at the domain layer), skip AuditLogEntry (rely on Postgres logs), skip CleanerRequestToken (use the cleaner's portal token for actions).

**Rationale:** Each addresses a specific failure mode that's expensive to fix retroactively:
- Without Outbox: a transaction that succeeds but the post-commit notification fails leaves the system inconsistent. With it: notifications either fire or are retried until they do.
- Without WebhookEvent: Stripe retries a refund webhook → we issue two refunds.
- Without AuditLogEntry: a refund dispute six months later has no record of who approved it.
- Without CleanerRequestToken: an attacker who sees a cleaner's accept URL can replay it on any other assignment.

**Consequences:** Four extra Prisma models. `Outbox` requires a drain worker (already in the BullMQ topology — `outbox-drain` queue). `WebhookEvent` table grows unbounded; needs a 90-day cleanup job. `AuditLogEntry` similarly needs retention policy (recommend keep-forever for V1; revisit if volume becomes an issue). `CleanerRequestToken` is short-lived; expired rows pruned by `magic-link-cleanup` (rename that job to `token-cleanup`).

---

## D-020 — `BookingCharge` entity: one booking → many charges

- **Date:** 2026-04-26
- **Status:** Accepted

**Decision:** Replace the single `stripePaymentIntentId` + `stripeFee` columns on `Booking` with a separate `BookingCharge` table. Each booking can have many charges, each tied to its own Stripe PaymentIntent (and optionally Checkout Session). Charge `kind` is one of `initial | extension | damage | incidental`. `stripeCustomerId` stays on `Booking` (one customer record reused across all charges for that guest).

**Alternatives considered:**
- Keep single payment per booking and only add an "additional charges" table later when needed.
- Use Stripe metadata to track charge kinds without a local table.

**Rationale:** Three real flows need multiple payments per booking:
1. **Stay extensions** — guest mid-stay wants more nights; admin extends the booking and sends a payment request for the additional amount.
2. **Damage / incidentals** — post-stay charges using the card on file.
3. **Refunds** — partial refunds (e.g., cancellation tier returns 50%) tracked per original charge.

If we shipped M7 with a single-payment design, every one of these would later require a schema migration plus a refactor of the financial reporting (M4.2). Cost now: one extra model + a join in queries. Cost later: migrate live booking data + refactor booking/payment/financials code paths together. Pay it now.

**Consequences:**
- `Booking` no longer carries `stripePaymentIntentId` or `stripeFee` — those moved to `BookingCharge`. `stripeCustomerId` stays.
- M7 (`Request-to-book + Stripe Checkout`) creates a `BookingCharge` of `kind='initial'` rather than writing fields onto `Booking`.
- M8 (`Booking management actions`) gains "send ad-hoc payment request" — admin creates a new `BookingCharge` of any kind, system generates a Checkout Session, sends the link via SMS/email.
- Stay extensions become a natural composition: admin updates `Booking.checkOut` (existing M8 "modify dates") + creates a `BookingCharge` of `kind='extension'` for the prorated additional amount. No new UI surface beyond what M8 already ships.
- Financial reporting (M4.2) sums across charges per booking. Tax remains computed at the `Booking` level (the planned stay is the taxable unit; ad-hoc charges like damage are typically non-taxable).
- Webhook idempotency continues to work via `WebhookEvent.id` keyed on Stripe `event.id` — no change.

**Reference:** `packages/prisma/schema.prisma` for the model. PRD §11.1 (Stripe) and §4 (Booking flow) updated to reflect.

---

*New decisions append to the bottom with the next sequential `D-NNN`. Mark superseded decisions as `Status: Superseded by D-NNN` rather than editing in place.*
