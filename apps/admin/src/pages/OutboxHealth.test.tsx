import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../test/render';
import { OutboxHealthPage } from './OutboxHealth';

const HEALTH = {
  deadLettered: 1,
  pending: 2,
  oldestDeadLetterAt: '2026-04-25T12:00:00.000Z',
  recent: [
    {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      jobName: 'guest-notification',
      idempotencyKey: 'booking.declined:abc',
      attempts: 5,
      failureReason: 'smtp 550 mailbox full',
      createdAt: '2026-04-24T00:00:00.000Z',
      failedAt: '2026-04-25T12:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      if (input.includes('/csrf-token')) {
        return new Response(JSON.stringify({ token: 'test-csrf' }), { status: 200 });
      }
      if (input.includes('/api/v1/admin/outbox-health')) {
        return new Response(JSON.stringify(HEALTH), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
});

describe('OutboxHealthPage', () => {
  it('renders the page heading', () => {
    renderWithProviders(<OutboxHealthPage />);
    expect(screen.getByRole('heading', { name: /outbox health/i })).toBeInTheDocument();
  });

  it('shows counts and the dead-lettered row from the API', async () => {
    renderWithProviders(<OutboxHealthPage />);
    await waitFor(() => {
      expect(screen.getByText(/booking.declined:abc/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Dead-lettered:/)).toBeInTheDocument();
    expect(screen.getByText('smtp 550 mailbox full')).toBeInTheDocument();
  });
});
