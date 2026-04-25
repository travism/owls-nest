import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { BlockedDatesPage } from './BlockedDates';

const BLOCKS = [
  {
    id: '00000000-0000-0000-0000-000000000010',
    startDate: '2026-08-01',
    endDate: '2026-08-04',
    reason: 'manual_block',
    sourcePlatform: null,
    sourceSummary: 'Owner stay',
  },
  {
    id: '00000000-0000-0000-0000-000000000011',
    startDate: '2026-09-01',
    endDate: '2026-09-03',
    reason: 'ota_booking',
    sourcePlatform: 'airbnb',
    sourceSummary: null,
  },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/blocked-dates')) {
        return new Response(JSON.stringify(BLOCKS), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('BlockedDatesPage', () => {
  it('renders the add-block form', async () => {
    renderWithProviders(<BlockedDatesPage />);
    expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Reason$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/note/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add block/i })).toBeInTheDocument();
  });

  it('lists existing blocks from the API', async () => {
    renderWithProviders(<BlockedDatesPage />);
    await waitFor(() => {
      expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    });
    expect(screen.getByText('Owner stay')).toBeInTheDocument();
    expect(screen.getByText(/OTA \(airbnb\)/)).toBeInTheDocument();
  });

  it('shows Delete button only for non-OTA blocks', async () => {
    renderWithProviders(<BlockedDatesPage />);
    await waitFor(() => {
      expect(screen.getByText('2026-08-01')).toBeInTheDocument();
    });
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    // Only one — the manual block
    expect(deleteButtons).toHaveLength(1);
  });
});
