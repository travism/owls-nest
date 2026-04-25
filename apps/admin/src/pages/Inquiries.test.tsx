import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { InquiriesPage } from './Inquiries';

const INQUIRIES = [
  {
    id: 'inq-1',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: null,
    checkIn: '2026-07-15',
    checkOut: '2026-07-18',
    message: 'Heading to Smith Rock',
    status: 'new',
    convertedBookingId: null,
    createdAt: '2026-04-25T12:00:00Z',
    updatedAt: '2026-04-25T12:00:00Z',
  },
  {
    id: 'inq-2',
    name: 'Bob Closed',
    email: 'bob@example.com',
    phone: null,
    checkIn: '2026-08-01',
    checkOut: '2026-08-04',
    message: null,
    status: 'closed',
    convertedBookingId: null,
    createdAt: '2026-04-20T12:00:00Z',
    updatedAt: '2026-04-20T12:00:00Z',
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/admin/inquiries')) {
        return new Response(JSON.stringify(INQUIRIES), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('InquiriesPage', () => {
  it('renders the inquiry list with status pills', async () => {
    renderWithProviders(<InquiriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Closed')).toBeInTheDocument();
    // Both "New" and "Closed" appear as filter chip buttons AND status pills.
    // A successful render means at least 2 of each (1 chip + 1 pill).
    expect(screen.getAllByText('New').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Closed').length).toBeGreaterThanOrEqual(2);
  });

  it('shows action buttons for non-terminal inquiries only', async () => {
    renderWithProviders(<InquiriesPage />);
    await waitFor(() => {
      expect(screen.getByText('Jane Smith')).toBeInTheDocument();
    });
    // Jane is "new" — should have Mark responded, Convert, Close
    expect(screen.getByRole('button', { name: /mark responded/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Convert$/i })).toBeInTheDocument();
    // Bob is "closed" — should NOT have any of those buttons (only filter chips remain)
    const convertButtons = screen.getAllByRole('button', { name: /^Convert$/i });
    expect(convertButtons).toHaveLength(1); // only Jane's
  });

  it('renders status filter chips', async () => {
    renderWithProviders(<InquiriesPage />);
    expect(screen.getByRole('button', { name: /^All$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^New$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Responded$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Converted$/i })).toBeInTheDocument();
  });
});
