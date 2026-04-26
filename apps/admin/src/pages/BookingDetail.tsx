import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bookingsApi,
  ApiError,
  type AdminBooking,
  type ApprovalResponse,
} from '../lib/api';

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalResponse | null>(null);

  const q = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingsApi.get(id!),
    enabled: !!id,
  });

  const approve = useMutation({
    mutationFn: () => bookingsApi.approve(id!),
    onSuccess: (data) => {
      setError(null);
      setApproval(data);
      queryClient.setQueryData(['booking', id], data.booking);
      queryClient.invalidateQueries({ queryKey: ['bookings'] });
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Could not approve booking.');
    },
  });

  if (q.isPending) {
    return (
      <main>
        <h1>Booking</h1>
        <p>Loading…</p>
      </main>
    );
  }
  if (q.isError || !q.data) {
    return (
      <main>
        <h1>Booking</h1>
        <div className="error" role="alert">Could not load booking.</div>
        <Link to="/bookings">← Back to bookings</Link>
      </main>
    );
  }

  const b: AdminBooking = q.data;

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Booking {b.id.slice(0, 8)}…</h1>
      <p className="muted">
        Status: <strong>{b.status}</strong> ·{' '}
        {b.checkIn} → {b.checkOut} ({b.numNights} nights)
      </p>

      <h2>Guest</h2>
      {b.guest ? (
        <p>
          <strong>{b.guest.name}</strong> · {b.guest.email}
          {b.guest.phone ? ` · ${b.guest.phone}` : ''}
        </p>
      ) : (
        <p className="muted">No guest record (OTA-imported booking?)</p>
      )}

      <h2>Pricing</h2>
      <table style={{ width: '100%', fontSize: '0.92rem' }}>
        <tbody>
          <tr><td>{b.numNights} × {formatMoney(b.nightlyRate)}/night</td><td style={{ textAlign: 'right' }}>{formatMoney(b.subtotal)}</td></tr>
          <tr><td>Taxes (Oregon + Redmond)</td><td style={{ textAlign: 'right' }}>{formatMoney(b.totalTaxAmount)}</td></tr>
          <tr style={{ borderTop: '1px solid #c7bfa9', fontWeight: 600 }}>
            <td style={{ paddingTop: '0.5rem' }}>Total</td>
            <td style={{ paddingTop: '0.5rem', textAlign: 'right' }}>{formatMoney(b.totalWithTax)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Charges</h2>
      {b.charges.length === 0 && (
        <p className="muted">No charges yet — approve to send a payment link.</p>
      )}
      {b.charges.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {b.charges.map((c) => (
            <li
              key={c.id}
              style={{
                padding: '0.75rem 1rem',
                background: '#fafaf7',
                border: '1px solid #e5e5dd',
                borderRadius: 4,
                marginBottom: '0.5rem',
              }}
            >
              <div>
                <strong>{c.kind}</strong> · {formatMoney(c.amount)} ·{' '}
                <span className="muted">{c.status}</span>
                {c.paidAt && (
                  <span className="muted"> · paid {new Date(c.paidAt).toLocaleString()}</span>
                )}
              </div>
              {c.stripeCheckoutSessionId && (
                <div className="muted" style={{ fontSize: '0.8rem' }}>
                  Stripe session: <code>{c.stripeCheckoutSessionId}</code>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {b.status === 'pending_approval' && (
        <>
          <h2>Approve</h2>
          <p className="muted">
            Creates an initial Stripe charge for {formatMoney(b.totalWithTax)} and
            sends the payment link to {b.guest?.email}.
          </p>
          {error && <div className="error" role="alert">{error}</div>}
          {approval && (
            <div
              role="status"
              style={{
                padding: '0.75rem 1rem',
                background: '#ecfdec',
                border: '1px solid #b4e5b4',
                borderRadius: 4,
                color: '#1a8b1a',
                fontSize: '0.9rem',
                margin: '1rem 0',
              }}
            >
              Approved. Payment link:{' '}
              <a href={approval.checkoutUrl} target="_blank" rel="noopener noreferrer">
                {approval.checkoutUrl}
              </a>
            </div>
          )}
          <button onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? 'Approving…' : 'Approve and send payment link'}
          </button>
        </>
      )}

      <nav>
        <Link to="/bookings">← Back to bookings</Link>
      </nav>
    </main>
  );
}
