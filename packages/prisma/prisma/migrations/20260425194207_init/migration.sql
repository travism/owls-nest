-- CreateTable
CREATE TABLE "property" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" VARCHAR(2) NOT NULL,
    "postal_code" TEXT NOT NULL,
    "check_in_time" VARCHAR(8) NOT NULL,
    "check_out_time" VARCHAR(8) NOT NULL,
    "max_guests" INTEGER NOT NULL DEFAULT 4,
    "base_nightly_rate" DECIMAL(10,2) NOT NULL,
    "cleaning_fee" DECIMAL(10,2) NOT NULL,
    "min_stay" INTEGER NOT NULL DEFAULT 2,
    "cancellation_policy" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_jurisdiction" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "jurisdiction_name" TEXT NOT NULL,
    "jurisdiction_level" TEXT NOT NULL,
    "tax_rate" DECIMAL(5,4) NOT NULL,
    "admin_fee_rate" DECIMAL(5,4),
    "filing_frequency" TEXT NOT NULL,
    "filing_authority" TEXT,
    "filing_portal_url" TEXT,
    "exempt_threshold_nights" INTEGER NOT NULL DEFAULT 30,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" DATE,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_jurisdiction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "totp_secret_encrypted" TEXT,
    "totp_enrolled_at" TIMESTAMP(3),
    "recovery_codes_hashed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_link_token" (
    "id" UUID NOT NULL,
    "guest_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "ip_requested" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_link_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inquiry" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "converted_booking_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "guest_id" UUID,
    "check_in" DATE NOT NULL,
    "check_out" DATE NOT NULL,
    "num_guests" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'direct',
    "nightly_rate" DECIMAL(10,2) NOT NULL,
    "num_nights" INTEGER NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "cleaning_fee_internal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "state_tlt_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "city_tlt_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "state_admin_fee_retained" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_exempt" BOOLEAN NOT NULL DEFAULT false,
    "tax_exempt_reason" TEXT,
    "ota_remitted_state" BOOLEAN NOT NULL DEFAULT false,
    "ota_remitted_city" BOOLEAN NOT NULL DEFAULT false,
    "stripe_payment_intent_id" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "net_revenue" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cancellation_tier_applied" TEXT,
    "refund_amount" DECIMAL(10,2),
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaner" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "priority_rank" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cleaner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaner_token" (
    "id" UUID NOT NULL,
    "cleaner_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaner_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleaner_request_token" (
    "id" UUID NOT NULL,
    "cleaner_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleaner_request_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnover_assignment" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "cleaner_id" UUID,
    "date" DATE NOT NULL,
    "check_out_time" VARCHAR(8) NOT NULL,
    "check_in_time" VARCHAR(8) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unassigned',
    "special_instructions" TEXT,
    "request_history" JSONB NOT NULL DEFAULT '[]',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnover_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" UUID NOT NULL,
    "guest_id" UUID,
    "booking_id" UUID,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_id" UUID,
    "twilio_sid" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blog_post" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "excerpt" TEXT,
    "featured_image_path" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blog_post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review" (
    "id" UUID NOT NULL,
    "guest_name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "booking_id" UUID,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "review_date" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_sync" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "ical_import_url" TEXT NOT NULL,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" TEXT NOT NULL DEFAULT 'pending',
    "last_sync_error" TEXT,
    "last_sync_event_count" INTEGER NOT NULL DEFAULT 0,
    "sync_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_sync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_date" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "source_platform" TEXT,
    "source_event_uid" TEXT,
    "source_summary" TEXT,
    "calendar_sync_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "blocked_date_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_override" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "nightly_rate" DECIMAL(10,2) NOT NULL,
    "min_stay_override" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_cache_entry" (
    "id" UUID NOT NULL,
    "property_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "nightly_rate" DECIMAL(10,2) NOT NULL,
    "min_stay" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL DEFAULT 'pricelabs',
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pricing_cache_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_code" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_to" DATE,
    "max_uses" INTEGER,
    "current_uses" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log_entry" (
    "id" UUID NOT NULL,
    "admin_user_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT,
    "payload" JSONB,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "job_name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotency_key" TEXT,
    "enqueued_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_jurisdiction_property_id_effective_to_idx" ON "tax_jurisdiction"("property_id", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "admin_user_email_key" ON "admin_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "guest_email_key" ON "guest"("email");

-- CreateIndex
CREATE UNIQUE INDEX "magic_link_token_token_hash_key" ON "magic_link_token"("token_hash");

-- CreateIndex
CREATE INDEX "magic_link_token_guest_id_idx" ON "magic_link_token"("guest_id");

-- CreateIndex
CREATE INDEX "magic_link_token_expires_at_idx" ON "magic_link_token"("expires_at");

-- CreateIndex
CREATE INDEX "inquiry_status_created_at_idx" ON "inquiry"("status", "created_at");

-- CreateIndex
CREATE INDEX "booking_status_check_in_idx" ON "booking"("status", "check_in");

-- CreateIndex
CREATE INDEX "booking_source_idx" ON "booking"("source");

-- CreateIndex
CREATE INDEX "booking_guest_id_idx" ON "booking"("guest_id");

-- CreateIndex
CREATE INDEX "cleaner_active_priority_rank_idx" ON "cleaner"("active", "priority_rank");

-- CreateIndex
CREATE UNIQUE INDEX "cleaner_priority_rank_key" ON "cleaner"("priority_rank");

-- CreateIndex
CREATE UNIQUE INDEX "cleaner_token_token_hash_key" ON "cleaner_token"("token_hash");

-- CreateIndex
CREATE INDEX "cleaner_token_cleaner_id_idx" ON "cleaner_token"("cleaner_id");

-- CreateIndex
CREATE INDEX "cleaner_request_token_cleaner_id_idx" ON "cleaner_request_token"("cleaner_id");

-- CreateIndex
CREATE INDEX "cleaner_request_token_assignment_id_idx" ON "cleaner_request_token"("assignment_id");

-- CreateIndex
CREATE INDEX "cleaner_request_token_expires_at_idx" ON "cleaner_request_token"("expires_at");

-- CreateIndex
CREATE INDEX "turnover_assignment_date_idx" ON "turnover_assignment"("date");

-- CreateIndex
CREATE INDEX "turnover_assignment_status_idx" ON "turnover_assignment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "message_twilio_sid_key" ON "message"("twilio_sid");

-- CreateIndex
CREATE INDEX "message_guest_id_created_at_idx" ON "message"("guest_id", "created_at");

-- CreateIndex
CREATE INDEX "message_booking_id_idx" ON "message"("booking_id");

-- CreateIndex
CREATE UNIQUE INDEX "blog_post_slug_key" ON "blog_post"("slug");

-- CreateIndex
CREATE INDEX "blog_post_status_published_at_idx" ON "blog_post"("status", "published_at");

-- CreateIndex
CREATE INDEX "review_visible_review_date_idx" ON "review"("visible", "review_date");

-- CreateIndex
CREATE INDEX "calendar_sync_active_idx" ON "calendar_sync"("active");

-- CreateIndex
CREATE INDEX "blocked_date_start_date_end_date_idx" ON "blocked_date"("start_date", "end_date");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_date_source_event_uid_calendar_sync_id_key" ON "blocked_date"("source_event_uid", "calendar_sync_id");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_override_property_id_date_key" ON "pricing_override"("property_id", "date");

-- CreateIndex
CREATE INDEX "pricing_cache_entry_fetched_at_idx" ON "pricing_cache_entry"("fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "pricing_cache_entry_property_id_date_key" ON "pricing_cache_entry"("property_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "promo_code_code_key" ON "promo_code"("code");

-- CreateIndex
CREATE INDEX "audit_log_entry_admin_user_id_created_at_idx" ON "audit_log_entry"("admin_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entry_action_created_at_idx" ON "audit_log_entry"("action", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_entry_target_type_target_id_idx" ON "audit_log_entry"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "webhook_event_provider_created_at_idx" ON "webhook_event"("provider", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_idempotency_key_key" ON "outbox"("idempotency_key");

-- CreateIndex
CREATE INDEX "outbox_enqueued_at_idx" ON "outbox"("enqueued_at");

-- AddForeignKey
ALTER TABLE "tax_jurisdiction" ADD CONSTRAINT "tax_jurisdiction_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_link_token" ADD CONSTRAINT "magic_link_token_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking" ADD CONSTRAINT "booking_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaner_token" ADD CONSTRAINT "cleaner_token_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaner_request_token" ADD CONSTRAINT "cleaner_request_token_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cleaner_request_token" ADD CONSTRAINT "cleaner_request_token_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "turnover_assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_assignment" ADD CONSTRAINT "turnover_assignment_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnover_assignment" ADD CONSTRAINT "turnover_assignment_cleaner_id_fkey" FOREIGN KEY ("cleaner_id") REFERENCES "cleaner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_guest_id_fkey" FOREIGN KEY ("guest_id") REFERENCES "guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_sync" ADD CONSTRAINT "calendar_sync_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_date" ADD CONSTRAINT "blocked_date_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_date" ADD CONSTRAINT "blocked_date_calendar_sync_id_fkey" FOREIGN KEY ("calendar_sync_id") REFERENCES "calendar_sync"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_override" ADD CONSTRAINT "pricing_override_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_cache_entry" ADD CONSTRAINT "pricing_cache_entry_property_id_fkey" FOREIGN KEY ("property_id") REFERENCES "property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log_entry" ADD CONSTRAINT "audit_log_entry_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
