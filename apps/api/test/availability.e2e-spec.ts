import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './test-app';
import { seedTestData } from './test-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(30_000);

describe('Availability (e2e)', () => {
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

  function url(from: string, to: string): string {
    return `/api/v1/availability?from=${from}&to=${to}`;
  }

  it('returns 200 and an empty unavailable list with no data', async () => {
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      from: '2026-07-01',
      to: '2026-08-01',
      unavailable: [],
    });
  });

  it('is publicly accessible (no auth, no CSRF)', async () => {
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.status).toBe(200);
  });

  it('rejects to <= from', async () => {
    const res = await request(server).get(url('2026-07-15', '2026-07-15'));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects malformed dates', async () => {
    const res = await request(server).get(url('not-a-date', '2026-08-01'));
    expect(res.status).toBe(400);
  });

  it('returns confirmed direct booking dates', async () => {
    await prisma.booking.create({
      data: {
        propertyId,
        checkIn: new Date('2026-07-15T00:00:00Z'),
        checkOut: new Date('2026-07-18T00:00:00Z'),
        numGuests: 2,
        status: 'confirmed',
        source: 'direct',
        nightlyRate: 200,
        numNights: 3,
        subtotal: 600,
      },
    });
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([
      { startDate: '2026-07-15', endDate: '2026-07-18' },
    ]);
  });

  it('returns OTA-imported BlockedDate ranges (calendar wants ALL unavailability)', async () => {
    await prisma.blockedDate.create({
      data: {
        propertyId,
        startDate: new Date('2026-07-20T00:00:00Z'),
        endDate: new Date('2026-07-23T00:00:00Z'),
        reason: 'ota_booking',
        sourcePlatform: 'airbnb',
      },
    });
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.status).toBe(200);
    expect(res.body.unavailable).toEqual([
      { startDate: '2026-07-20', endDate: '2026-07-23' },
    ]);
  });

  it('combines bookings + blocks, sorted ascending by start date', async () => {
    await prisma.booking.create({
      data: {
        propertyId,
        checkIn: new Date('2026-07-22T00:00:00Z'),
        checkOut: new Date('2026-07-25T00:00:00Z'),
        numGuests: 2,
        status: 'confirmed',
        source: 'direct',
        nightlyRate: 200,
        numNights: 3,
        subtotal: 600,
      },
    });
    await prisma.blockedDate.create({
      data: {
        propertyId,
        startDate: new Date('2026-07-10T00:00:00Z'),
        endDate: new Date('2026-07-12T00:00:00Z'),
        reason: 'manual_block',
      },
    });
    await prisma.blockedDate.create({
      data: {
        propertyId,
        startDate: new Date('2026-07-15T00:00:00Z'),
        endDate: new Date('2026-07-18T00:00:00Z'),
        reason: 'maintenance',
      },
    });
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.body.unavailable).toEqual([
      { startDate: '2026-07-10', endDate: '2026-07-12' },
      { startDate: '2026-07-15', endDate: '2026-07-18' },
      { startDate: '2026-07-22', endDate: '2026-07-25' },
    ]);
  });

  it('excludes cancelled bookings', async () => {
    await prisma.booking.create({
      data: {
        propertyId,
        checkIn: new Date('2026-07-15T00:00:00Z'),
        checkOut: new Date('2026-07-18T00:00:00Z'),
        numGuests: 2,
        status: 'cancelled',
        source: 'direct',
        nightlyRate: 200,
        numNights: 3,
        subtotal: 600,
      },
    });
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.body.unavailable).toEqual([]);
  });

  it('only returns ranges overlapping the queried window', async () => {
    await prisma.booking.create({
      data: {
        propertyId,
        checkIn: new Date('2026-09-15T00:00:00Z'),
        checkOut: new Date('2026-09-18T00:00:00Z'),
        numGuests: 2,
        status: 'confirmed',
        source: 'direct',
        nightlyRate: 200,
        numNights: 3,
        subtotal: 600,
      },
    });
    // Query July only — September booking should NOT appear
    const res = await request(server).get(url('2026-07-01', '2026-08-01'));
    expect(res.body.unavailable).toEqual([]);
  });
});
