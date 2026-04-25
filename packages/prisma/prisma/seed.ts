// Seed script — populates the V1 baseline:
// - Property row for The Owl's Nest
// - Two TaxJurisdiction rows (Oregon State 1.5%, City of Redmond 9.0%)
// - Default MessageTemplates
// - AdminUser placeholder (password reset on first login)

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // --- Property ---
  const property = await prisma.property.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: "The Owl's Nest",
      addressLine1: '147 SW 4th St',
      city: 'Redmond',
      state: 'OR',
      postalCode: '97756',
      checkInTime: '15:00:00',
      checkOutTime: '11:00:00',
      maxGuests: 4,
      baseNightlyRate: 175,
      cleaningFee: 75,
      minStay: 2,
      cancellationPolicy: {
        tiers: [
          { daysBeforeCheckin: 30, refundPercent: 100 },
          { daysBeforeCheckin: 14, refundPercent: 50 },
          { daysBeforeCheckin: 0,  refundPercent: 0  },
        ],
      },
    },
  });

  // --- Tax Jurisdictions ---
  await prisma.taxJurisdiction.upsert({
    where: { id: '00000000-0000-0000-0000-000000000010' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000010',
      propertyId: property.id,
      jurisdictionName: 'Oregon State TLT',
      jurisdictionLevel: 'state',
      taxRate: 0.015,
      adminFeeRate: 0.05,
      filingFrequency: 'quarterly',
      filingAuthority: 'Oregon Department of Revenue',
      filingPortalUrl: 'https://revenueonline.dor.oregon.gov',
      exemptThresholdNights: 30,
    },
  });

  await prisma.taxJurisdiction.upsert({
    where: { id: '00000000-0000-0000-0000-000000000011' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000011',
      propertyId: property.id,
      jurisdictionName: 'City of Redmond TLT',
      jurisdictionLevel: 'city',
      taxRate: 0.09,
      adminFeeRate: null,
      filingFrequency: 'monthly',
      filingAuthority: 'City of Redmond Accounts Receivables',
      filingPortalUrl:
        'https://www.redmondoregon.gov/government/departments/finance/forms-applications/transient-lodging-tax',
      exemptThresholdNights: 30,
    },
  });

  // --- Default Message Templates ---
  const templates: Array<{
    name: string;
    type: string;
    body: string;
    isDefault?: boolean;
  }> = [
    {
      name: 'Booking Confirmed',
      type: 'confirmation',
      body: "Hi {{guest_name}} — your stay at The Owl's Nest is confirmed for {{checkin_date}} to {{checkout_date}}. We'll send check-in details two days before arrival. Reply here with any questions.",
      isDefault: true,
    },
    {
      name: 'Pre-Arrival',
      type: 'pre_arrival',
      body: "Hi {{guest_name}} — looking forward to hosting you at The Owl's Nest tomorrow. Check-in is at {{checkin_time}}. Door code: {{access_code}}. Wifi: {{wifi}}. Reply with any questions.",
      isDefault: true,
    },
    {
      name: 'Post-Stay',
      type: 'post_stay',
      body: "Hi {{guest_name}} — thanks for staying at The Owl's Nest. We'd love your feedback: {{review_link}}. Hope you'll come back.",
      isDefault: true,
    },
    {
      name: 'Admin: New Inquiry',
      type: 'admin_notification',
      body: 'New inquiry from {{guest_name}} for {{checkin_date}} to {{checkout_date}}. Open admin to respond.',
      isDefault: true,
    },
    {
      name: 'Admin: Payment Received',
      type: 'admin_notification',
      body: 'Payment received from {{guest_name}} for {{checkin_date}}–{{checkout_date}}. Booking confirmed.',
      isDefault: true,
    },
    {
      name: 'Admin: Cleaner Accepted',
      type: 'admin_notification',
      body: '{{cleaner_name}} accepted turnover on {{date}}.',
      isDefault: true,
    },
    {
      name: 'Admin: Waterfall Exhausted',
      type: 'admin_notification',
      body: 'No cleaner accepted turnover on {{date}}. Manual handling required.',
      isDefault: true,
    },
  ];

  for (const t of templates) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { name: t.name },
    });
    if (!existing) {
      await prisma.messageTemplate.create({ data: t });
    }
  }

  // --- Admin user placeholder ---
  // Password and TOTP are set on first-login flow via the Admin SPA.
  // Argon2id hash of the empty string here is a placeholder; the API
  // will refuse login until a real password is set via setup endpoint.
  await prisma.adminUser.upsert({
    where: { email: 'admin@owlsnest.local' },
    update: {},
    create: {
      email: 'admin@owlsnest.local',
      passwordHash: 'PLACEHOLDER-MUST-RESET',
      totpSecretEncrypted: null,
      totpEnrolledAt: null,
      recoveryCodesHashed: [],
    },
  });

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
