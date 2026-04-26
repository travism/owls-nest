import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { BookingsPage } from './Bookings';

const BOOKINGS = [
  {
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
    charges: [],
    createdAt: '2026-04-26T12:00:00Z',
    updatedAt: '2026-04-26T12:00:00Z',
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/admin/bookings')) {
        return new Response(JSON.stringify(BOOKINGS), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('BookingsPage', () => {
  it('renders the booking list', async () => {
    renderWithProviders(<BookingsPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText(/2026-07-15/)).toBeInTheDocument();
    expect(screen.getByText('$663.00')).toBeInTheDocument();
  });

  it('shows status filter chips', async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pending approval/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmed/i })).toBeInTheDocument();
  });

  it('links each row to its detail page', async () => {
    renderWithProviders(<BookingsPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /open/i });
    expect(link).toHaveAttribute('href', '/bookings/00000000-0000-0000-0000-000000000010');
  });
});
