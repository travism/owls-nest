// Sanity tests for the admin BookingDetail action panels.
// Verifies that buttons render in the correct booking states and that form
// labels are properly associated with their inputs (CLAUDE.md directive #9).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Routes, Route, MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { BookingDetailPage } from './BookingDetail';

function makeBooking(over: Partial<any> = {}) {
  return {
    id: '00000000-0000-0000-0000-000000000010',
    status: 'pending_approval',
    source: 'direct',
    guestId: 'g1',
    guest: { id: 'g1', name: 'Jane Smith', email: 'jane@example.com', phone: null },
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    numNights: 3,
    numGuests: 2,
    nightlyRate: 200,
    subtotal: 600,
    totalTaxAmount: 63,
    totalWithTax: 663,
    stripeCustomerId: null,
    cancellationTierApplied: null,
    refundAmount: null,
    cancelledAt: null,
    charges: [],
    createdAt: '2026-04-26T12:00:00Z',
    updatedAt: '2026-04-26T12:00:00Z',
    ...over,
  };
}

function mountWith(booking: any) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/admin/bookings/')) {
        return new Response(JSON.stringify(booking), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/bookings/${booking.id}`]}>
        <Routes>
          <Route path="/bookings/:id" element={<BookingDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('BookingDetailPage actions', () => {
  it('shows Approve and Decline for pending_approval', async () => {
    mountWith(makeBooking({ status: 'pending_approval' }));
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /approve and send/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Decline$/i })).toBeInTheDocument();
  });

  it('opens decline panel with a properly-labeled reason textarea', async () => {
    mountWith(makeBooking({ status: 'pending_approval' }));
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Decline$/i }));
    const textarea = screen.getByLabelText(/reason \(optional, sent to guest\)/i);
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName.toLowerCase()).toBe('textarea');
  });

  it('shows Cancel + Modify dates + Send payment request for confirmed', async () => {
    mountWith(makeBooking({ status: 'confirmed' }));
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /cancel booking/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /modify dates/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send payment request/i })).toBeInTheDocument();
  });

  it('modify-dates panel inputs are labeled', async () => {
    mountWith(makeBooking({ status: 'confirmed' }));
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /modify dates/i }));
    expect(screen.getByLabelText(/new check-in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/new check-out/i)).toBeInTheDocument();
  });

  it('shows Refund button on a succeeded charge with remaining balance', async () => {
    mountWith(
      makeBooking({
        status: 'confirmed',
        charges: [
          {
            id: 'c1',
            kind: 'initial',
            amount: 663,
            status: 'succeeded',
            description: null,
            stripeCheckoutSessionId: 'cs_x',
            stripePaymentIntentId: 'pi_x',
            refundedAmount: 0,
            refundedAt: null,
            paidAt: '2026-04-26T12:30:00Z',
            createdAt: '2026-04-26T12:00:00Z',
          },
        ],
      }),
    );
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /refund \(max/i })).toBeInTheDocument();
  });

  it('shows the cancellation tier label when cancelled', async () => {
    mountWith(
      makeBooking({
        status: 'cancelled',
        cancellationTierApplied: '30-day:100%',
      }),
    );
    await waitFor(() => expect(screen.getByText('Jane Smith')).toBeInTheDocument());
    expect(screen.getByText(/30-day:100%/)).toBeInTheDocument();
  });
});
