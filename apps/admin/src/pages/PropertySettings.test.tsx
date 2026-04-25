import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { PropertySettingsPage } from './PropertySettings';

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
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/property')) {
        return new Response(JSON.stringify(PROPERTY), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('PropertySettingsPage', () => {
  it('shows a loading state initially', () => {
    renderWithProviders(<PropertySettingsPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the form populated from the API once loaded', async () => {
    renderWithProviders(<PropertySettingsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText(/^Name$/i)).toHaveValue("The Owl's Nest");
    });
    expect(screen.getByLabelText(/^Street$/i)).toHaveValue('147 SW 4th St');
    expect(screen.getByLabelText(/^City$/i)).toHaveValue('Redmond');
    expect(screen.getByLabelText(/^State$/i)).toHaveValue('OR');
    expect(screen.getByLabelText(/^ZIP$/i)).toHaveValue('97756');
    expect(screen.getByLabelText(/Max guests/i)).toHaveValue(4);
    expect(screen.getByLabelText(/Base nightly rate/i)).toHaveValue(175);
    expect(screen.getByLabelText(/Cleaning fee/i)).toHaveValue(75);
  });

  it('exposes a save button', async () => {
    renderWithProviders(<PropertySettingsPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    });
  });
});
