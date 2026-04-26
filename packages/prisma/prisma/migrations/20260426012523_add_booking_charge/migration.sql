/*
  Warnings:

  - You are about to drop the column `stripe_fee` on the `booking` table. All the data in the column will be lost.
  - You are about to drop the column `stripe_payment_intent_id` on the `booking` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "booking" DROP COLUMN "stripe_fee",
DROP COLUMN "stripe_payment_intent_id";

-- CreateTable
CREATE TABLE "booking_charge" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "stripe_payment_intent_id" TEXT,
    "stripe_checkout_session_id" TEXT,
    "stripe_fee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "refunded_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_charge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "booking_charge_stripe_payment_intent_id_key" ON "booking_charge"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_charge_stripe_checkout_session_id_key" ON "booking_charge"("stripe_checkout_session_id");

-- CreateIndex
CREATE INDEX "booking_charge_booking_id_kind_idx" ON "booking_charge"("booking_id", "kind");

-- CreateIndex
CREATE INDEX "booking_charge_status_created_at_idx" ON "booking_charge"("status", "created_at");

-- AddForeignKey
ALTER TABLE "booking_charge" ADD CONSTRAINT "booking_charge_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
