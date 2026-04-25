import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('Calendar export (e2e)', () => {
  let app: INestApplication;
  let server: any;
  let prisma: PrismaService;
  let propertyId: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await seedTestData(prisma);
    const property = await prisma.property.findFirst({ select: { id: true } });
    propertyId = property!.id;
  });

  // ---- helpers ----

  async function createDirectBooking(
    overrides: { status?: string; checkIn?: Date; checkOut?: Date; id?: string } = {},
  ) {
    return prisma.booking.create({
      data: {
        propertyId,
        checkIn: overrides.checkIn ?? new Date('2026-07-15T00:00:00Z'),
        checkOut: overrides.checkOut ?? new Date('2026-07-18T00:00:00Z'),
        numGuests: 2,
        status: overrides.status ?? 'confirmed',
        source: 'direct',
        nightlyRate: 200,
        numNights: 3,
        subtotal: 600,
      },
    });
  }

  async function createOtaBooking() {
    return prisma.booking.create({
      data: {
        propertyId,
        checkIn: new Date('2026-08-10T00:00:00Z'),
        checkOut: new Date('2026-08-12T00:00:00Z'),
        numGuests: 2,
        status: 'confirmed',
        source: 'airbnb',
        nightlyRate: 200,
        numNights: 2,
        subtotal: 400,
      },
    });
  }

  async function createBlock(reason: 'manual_block' | 'maintenance' | 'ota_booking') {
    return prisma.blockedDate.create({
      data: {
        propertyId,
        startDate: new Date('2026-09-01T00:00:00Z'),
        endDate: new Date('2026-09-04T00:00:00Z'),
        reason,
        ...(reason === 'ota_booking' ? { sourcePlatform: 'airbnb' } : {}),
      },
    });
  }

  // ---- response shape ----

  it('returns 200 with the right Content-Type and Cache-Control', async () => {
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/calendar/);
    expect(res.headers['cache-control']).toMatch(/no-cache/);
    expect(res.headers['content-disposition']).toMatch(/owlsnest-calendar\.ics/);
  });

  it('is publicly accessible (no auth, no CSRF)', async () => {
    // Bare supertest call with no cookies, no CSRF header
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.status).toBe(200);
  });

  it('produces a valid VCALENDAR document with empty data', async () => {
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(res.text).toMatch(/\r\nEND:VCALENDAR$/);
    expect(res.text).toContain('VERSION:2.0');
    expect(res.text).toContain('PRODID:');
    expect(res.text).not.toContain('BEGIN:VEVENT');
  });

  // ---- inclusion paths ----

  it('includes a confirmed direct booking', async () => {
    const b = await createDirectBooking();
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).toContain(`UID:booking-${b.id}@owlsnest.com`);
    expect(res.text).toContain('SUMMARY:Reserved');
    expect(res.text).toContain('DTSTART;VALUE=DATE:20260715');
    expect(res.text).toContain('DTEND;VALUE=DATE:20260718');
  });

  it('includes an approved (awaiting payment) direct booking', async () => {
    const b = await createDirectBooking({ status: 'approved' });
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).toContain(`UID:booking-${b.id}@owlsnest.com`);
  });

  it('includes a manual block', async () => {
    const block = await createBlock('manual_block');
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).toContain(`UID:block-${block.id}@owlsnest.com`);
    expect(res.text).toContain('SUMMARY:Not available');
  });

  it('includes a maintenance block', async () => {
    const block = await createBlock('maintenance');
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).toContain(`UID:block-${block.id}@owlsnest.com`);
    expect(res.text).toContain('DESCRIPTION:Maintenance block');
  });

  // ---- exclusion paths ----

  it('excludes a Booking with source=airbnb', async () => {
    const b = await createOtaBooking();
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).not.toContain(`booking-${b.id}`);
    expect(res.text).not.toContain('BEGIN:VEVENT');
  });

  it('excludes a BlockedDate with reason=ota_booking', async () => {
    const block = await createBlock('ota_booking');
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).not.toContain(`block-${block.id}`);
    expect(res.text).not.toContain('BEGIN:VEVENT');
  });

  it('excludes cancelled direct bookings', async () => {
    const b = await createDirectBooking({ status: 'cancelled' });
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).not.toContain(`booking-${b.id}`);
  });

  it('excludes pending_approval direct bookings', async () => {
    const b = await createDirectBooking({ status: 'pending_approval' });
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).not.toContain(`booking-${b.id}`);
  });

  it('excludes inquiry-status direct bookings', async () => {
    const b = await createDirectBooking({ status: 'inquiry' });
    const res = await request(server).get('/api/v1/calendar/export.ics');
    expect(res.text).not.toContain(`booking-${b.id}`);
  });

  // ---- mixed scenario ----

  it('mixed scenario — exports only the right rows', async () => {
    const directConfirmed = await createDirectBooking();
    const directCancelled = await createDirectBooking({
      status: 'cancelled',
      checkIn: new Date('2026-07-20'),
      checkOut: new Date('2026-07-22'),
    });
    const ota = await createOtaBooking();
    const manualBlock = await createBlock('manual_block');
    const otaBlock = await prisma.blockedDate.create({
      data: {
        propertyId,
        startDate: new Date('2026-10-01T00:00:00Z'),
        endDate: new Date('2026-10-03T00:00:00Z'),
        reason: 'ota_booking',
        sourcePlatform: 'vrbo',
      },
    });

    const res = await request(server).get('/api/v1/calendar/export.ics');
    // Included
    expect(res.text).toContain(`UID:booking-${directConfirmed.id}@owlsnest.com`);
    expect(res.text).toContain(`UID:block-${manualBlock.id}@owlsnest.com`);
    // Excluded
    expect(res.text).not.toContain(`booking-${directCancelled.id}`);
    expect(res.text).not.toContain(`booking-${ota.id}`);
    expect(res.text).not.toContain(`block-${otaBlock.id}`);

    // Exactly two VEVENTs in the output
    const events = res.text.split('BEGIN:VEVENT').length - 1;
    expect(events).toBe(2);
  });

  it('UIDs are stable across consecutive requests', async () => {
    await createDirectBooking();
    await createBlock('manual_block');
    const r1 = await request(server).get('/api/v1/calendar/export.ics');
    const r2 = await request(server).get('/api/v1/calendar/export.ics');

    const uids = (text: string) =>
      [...text.matchAll(/UID:([^\r\n]+)/g)].map((m) => m[1]).sort();
    expect(uids(r1.text)).toEqual(uids(r2.text));
  });

  // ---- RFC 5545 sanity ----

  it('uses CRLF line endings', async () => {
    await createDirectBooking();
    const res = await request(server).get('/api/v1/calendar/export.ics');
    // Sample: BEGIN:VCALENDAR followed by CRLF
    expect(res.text).toMatch(/BEGIN:VCALENDAR\r\n/);
    expect(res.text).toMatch(/BEGIN:VEVENT\r\n/);
    expect(res.text).toMatch(/END:VEVENT\r\n/);
  });

  it('every VEVENT has TRANSP:OPAQUE', async () => {
    await createDirectBooking();
    await createBlock('manual_block');
    const res = await request(server).get('/api/v1/calendar/export.ics');
    const eventBlocks = res.text.split('BEGIN:VEVENT').slice(1);
    expect(eventBlocks.length).toBeGreaterThan(0);
    for (const block of eventBlocks) {
      expect(block).toContain('TRANSP:OPAQUE');
    }
  });
});
