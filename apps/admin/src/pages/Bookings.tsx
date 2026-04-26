import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { bookingsApi, type BookingStatus } from '../lib/api';

const STATUS_LABEL: Record<BookingStatus, string> = {
  inquiry: 'Inquiry',
  pending_approval: 'Pending approval',
  approved: 'Awaiting payment',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

const STATUS_COLOR: Record<BookingStatus, string> = {
  inquiry: '#999',
  pending_approval: '#c8674a',
  approved: '#d9a441',
  confirmed: '#2f4f3a',
  cancelled: '#999',
  completed: '#88a888',
};

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function BookingsPage() {
  const [filter, setFilter] = useState<BookingStatus | 'all'>('all');
  const q = useQuery({
    queryKey: ['bookings', filter],
    queryFn: () => bookingsApi.list(filter === 'all' ? undefined : filter),
  });

  return (
    <main style={{ maxWidth: 1000 }}>
      <h1>Bookings</h1>
      <p className="muted">
        Direct bookings created by converting inquiries. Click any row for
        detail and admin actions.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0', flexWrap: 'wrap' }}>
        {(['all', 'pending_approval', 'approved', 'confirmed', 'cancelled', 'completed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={s === filter ? '' : 'secondary'}
            onClick={() => setFilter(s)}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s as BookingStatus]}
          </button>
        ))}
      </div>

      {q.isPending && <p>Loading…</p>}
      {q.isError && <div className="error" role="alert">Could not load bookings.</div>}
      {q.data && q.data.length === 0 && (
        <p className="muted">No bookings match this filter yet.</p>
      )}

      {q.data && q.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5dd' }}>
              <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Guest</th>
              <th style={{ padding: '0.5rem' }}>Dates</th>
              <th style={{ padding: '0.5rem' }}>Total</th>
              <th style={{ padding: '0.5rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f0f0e8' }}>
                <td style={{ padding: '0.6rem 0.5rem 0.6rem 0' }}>
                  <StatusPill status={b.status} />
                </td>
                <td style={{ padding: '0.6rem 0.5rem' }}>
                  <div style={{ fontWeight: 500 }}>{b.guest?.name ?? '—'}</div>
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {b.guest?.email ?? ''}
                  </div>
                </td>
                <td style={{ padding: '0.6rem 0.5rem' }}>
                  {b.checkIn} → {b.checkOut}
                  <div className="muted" style={{ fontSize: '0.8rem' }}>
                    {b.numNights} nights
                  </div>
                </td>
                <td style={{ padding: '0.6rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(b.totalWithTax)}
                </td>
                <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
                  <Link to={`/bookings/${b.id}`}>Open →</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav>
        <Link to="/">← Back to dashboard</Link>
      </nav>
    </main>
  );
}

function StatusPill({ status }: { status: BookingStatus }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        background: STATUS_COLOR[status],
        color: 'white',
        fontSize: '0.72rem',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}
