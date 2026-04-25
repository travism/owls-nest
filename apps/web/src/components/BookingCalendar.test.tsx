import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BookingCalendar } from './BookingCalendar';

const PROPERTY = {
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
  cancellationPolicy: { tiers: [{ daysBeforeCheckin: 30, refundPercent: 100 }] },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/api/v1/property')) {
        return new Response(JSON.stringify(PROPERTY), { status: 200 });
      }
      if (input.includes('/api/v1/availability')) {
        return new Response(
          JSON.stringify({
            from: '2026-04-25',
            to: '2027-04-25',
            unavailable: [{ startDate: '2026-07-15', endDate: '2026-07-18' }],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('BookingCalendar', () => {
  it('shows a loading state initially', () => {
    render(<BookingCalendar />);
    expect(screen.getByText(/loading availability/i)).toBeInTheDocument();
  });

  it('shows a date picker and quote sidebar after loading', async () => {
    render(<BookingCalendar />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /your stay/i })).toBeInTheDocument();
    });
    // Hint text shows minStay + maxGuests pulled from /api/v1/property
    expect(
      screen.getByText((_, el) => el?.textContent === 'Minimum stay: 2 nights. Maximum guests: 4.'),
    ).toBeInTheDocument();
    // Until a range is picked, the sidebar prompts
    expect(screen.getByText(/pick check-in and check-out dates/i)).toBeInTheDocument();
  });

  it('shows an error if the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        return new Response(
          JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'Server is down' } }),
          { status: 500 },
        );
      }),
    );
    render(<BookingCalendar />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
