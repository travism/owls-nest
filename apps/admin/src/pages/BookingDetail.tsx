// Admin booking detail page with M7 approve + M8 lifecycle actions:
//  - Decline (pending_approval)
//  - Cancel + Modify dates + Send payment request (approved/confirmed)
//  - Refund (per-charge, when charge has remaining balance)
//
// Each action renders an inline panel (no modal libs) with labeled inputs.
// CLAUDE.md directive #9: every input has htmlFor → id association.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bookingsApi,
  ApiError,
  type AdminBooking,
  type AdminBookingCharge,
  type ApprovalResponse,
  type ModifyDatesResponse,
  type AdHocChargeKind,
  type AdHocChargeResponse,
} from '../lib/api';

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

type Panel =
  | null
  | 'decline'
  | 'cancel'
  | 'modify'
  | 'charge'
  | { kind: 'refund'; chargeId: string };

export function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalResponse | null>(null);
  const [adHoc, setAdHoc] = useState<AdHocChargeResponse | null>(null);
  const [modify, setModify] = useState<ModifyDatesResponse | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  // Form state
  const [declineReason, setDeclineReason] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [modifyCheckIn, setModifyCheckIn] = useState('');
  const [modifyCheckOut, setModifyCheckOut] = useState('');
  const [chargeKind, setChargeKind] = useState<AdHocChargeKind>('extension');
  const [chargeAmount, setChargeAmount] = useState('');
  const [chargeDescription, setChargeDescription] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');

  const q = useQuery({
    queryKey: ['booking', id],
    queryFn: () => bookingsApi.get(id!),
    enabled: !!id,
  });

  function handleErr(err: unknown) {
    setError(err instanceof ApiError ? err.message : 'Action failed.');
  }
  function refresh(b: AdminBooking) {
    queryClient.setQueryData(['booking', id], b);
    queryClient.invalidateQueries({ queryKey: ['bookings'] });
  }

  const approve = useMutation({
    mutationFn: () => bookingsApi.approve(id!),
    onSuccess: (data) => {
      setError(null);
      setApproval(data);
      refresh(data.booking);
    },
    onError: handleErr,
  });
  const decline = useMutation({
    mutationFn: () => bookingsApi.decline(id!, declineReason || undefined),
    onSuccess: (data) => {
      setError(null);
      setPanel(null);
      refresh(data);
    },
    onError: handleErr,
  });
  const cancel = useMutation({
    mutationFn: () => bookingsApi.cancel(id!, cancelReason || undefined),
    onSuccess: (data) => {
      setError(null);
      setPanel(null);
      refresh(data);
    },
    onError: handleErr,
  });
  const doModify = useMutation({
    mutationFn: () => bookingsApi.modifyDates(id!, modifyCheckIn, modifyCheckOut),
    onSuccess: (data) => {
      setError(null);
      setModify(data);
      refresh(data.booking);
      // If increased, suggest the ad-hoc charge panel pre-filled
      if (data.delta.direction === 'increase' && data.delta.suggestedAdHocChargeKind) {
        setChargeKind(data.delta.suggestedAdHocChargeKind);
        setChargeAmount(String(data.delta.amount));
        setChargeDescription(`Extension for new dates ${modifyCheckIn} → ${modifyCheckOut}`);
        setPanel('charge');
      } else {
        setPanel(null);
      }
    },
    onError: handleErr,
  });
  const createCharge = useMutation({
    mutationFn: () =>
      bookingsApi.createCharge(id!, {
        kind: chargeKind,
        amount: Number(chargeAmount),
        description: chargeDescription,
      }),
    onSuccess: (data) => {
      setError(null);
      setAdHoc(data);
      setPanel(null);
      refresh(data.booking);
    },
    onError: handleErr,
  });
  const doRefund = useMutation({
    mutationFn: (chargeId: string) =>
      bookingsApi.refundCharge(chargeId, Number(refundAmount), refundReason || undefined),
    onSuccess: (data) => {
      setError(null);
      setPanel(null);
      setRefundAmount('');
      setRefundReason('');
      refresh(data.booking);
    },
    onError: handleErr,
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
  const isPending = b.status === 'pending_approval';
  const isLive = b.status === 'approved' || b.status === 'confirmed';

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Booking {b.id.slice(0, 8)}…</h1>
      <p className="muted">
        Status: <strong>{b.status}</strong> ·{' '}
        {b.checkIn} → {b.checkOut} ({b.numNights} nights)
        {b.cancellationTierApplied && (
          <> · cancellation tier: <strong>{b.cancellationTierApplied}</strong></>
        )}
      </p>

      {error && <div className="error" role="alert">{error}</div>}

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
            <ChargeRow
              key={c.id}
              c={c}
              onRefundClick={() => {
                setPanel({ kind: 'refund', chargeId: c.id });
                setRefundAmount(String(c.amount - c.refundedAmount));
              }}
            />
          ))}
        </ul>
      )}

      {/* --- Approve / Decline (pending_approval) --- */}
      {isPending && (
        <>
          <h2>Actions</h2>
          {approval && (
            <div role="status" style={successStyle}>
              Approved. Payment link:{' '}
              <a href={approval.checkoutUrl} target="_blank" rel="noopener noreferrer">
                {approval.checkoutUrl}
              </a>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? 'Approving…' : 'Approve and send payment link'}
            </button>
            <button onClick={() => setPanel(panel === 'decline' ? null : 'decline')}>
              Decline
            </button>
          </div>
          {panel === 'decline' && (
            <Panel title="Decline booking">
              <label htmlFor="decline-reason">Reason (optional, sent to guest)</label>
              <textarea
                id="decline-reason"
                rows={3}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
              />
              <div>
                <button onClick={() => decline.mutate()} disabled={decline.isPending}>
                  {decline.isPending ? 'Declining…' : 'Confirm decline'}
                </button>
                <button type="button" onClick={() => setPanel(null)}>Cancel</button>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* --- Cancel / Modify / Send payment request (approved/confirmed) --- */}
      {isLive && (
        <>
          <h2>Actions</h2>
          {adHoc && (
            <div role="status" style={successStyle}>
              Charge sent. Payment link:{' '}
              <a href={adHoc.checkoutUrl} target="_blank" rel="noopener noreferrer">
                {adHoc.checkoutUrl}
              </a>
            </div>
          )}
          {modify && modify.delta.direction !== 'unchanged' && (
            <div role="status" style={infoStyle}>
              Dates updated · delta {formatMoney(modify.delta.amount)}{' '}
              ({modify.delta.direction})
              {modify.delta.refundIssued && (
                <> · refunded {formatMoney(modify.delta.refundIssued.amount)}</>
              )}
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>
              Cancel booking
            </button>
            <button onClick={() => setPanel(panel === 'modify' ? null : 'modify')}>
              Modify dates
            </button>
            <button onClick={() => setPanel(panel === 'charge' ? null : 'charge')}>
              Send payment request
            </button>
          </div>

          {panel === 'cancel' && (
            <Panel title="Cancel booking">
              <p className="muted" style={{ fontSize: '0.85rem' }}>
                Refund amount is auto-calculated from the cancellation policy +
                check-in date.
              </p>
              <label htmlFor="cancel-reason">Reason (optional)</label>
              <textarea
                id="cancel-reason"
                rows={3}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
              <div>
                <button onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                  {cancel.isPending ? 'Cancelling…' : 'Confirm cancel'}
                </button>
                <button type="button" onClick={() => setPanel(null)}>Back</button>
              </div>
            </Panel>
          )}

          {panel === 'modify' && (
            <Panel title="Modify dates">
              <label htmlFor="modify-check-in">New check-in</label>
              <input
                id="modify-check-in"
                type="date"
                value={modifyCheckIn}
                onChange={(e) => setModifyCheckIn(e.target.value)}
              />
              <label htmlFor="modify-check-out">New check-out</label>
              <input
                id="modify-check-out"
                type="date"
                value={modifyCheckOut}
                onChange={(e) => setModifyCheckOut(e.target.value)}
              />
              <div>
                <button onClick={() => doModify.mutate()} disabled={doModify.isPending}>
                  {doModify.isPending ? 'Updating…' : 'Re-quote and update'}
                </button>
                <button type="button" onClick={() => setPanel(null)}>Back</button>
              </div>
            </Panel>
          )}

          {panel === 'charge' && (
            <Panel title="Send payment request">
              <label htmlFor="charge-kind">Kind</label>
              <select
                id="charge-kind"
                value={chargeKind}
                onChange={(e) => setChargeKind(e.target.value as AdHocChargeKind)}
              >
                <option value="extension">Extension</option>
                <option value="damage">Damage</option>
                <option value="incidental">Incidental</option>
              </select>
              <label htmlFor="charge-amount">Amount (USD)</label>
              <input
                id="charge-amount"
                type="number"
                step="0.01"
                min="0"
                value={chargeAmount}
                onChange={(e) => setChargeAmount(e.target.value)}
              />
              <label htmlFor="charge-description">Description (sent to guest)</label>
              <input
                id="charge-description"
                type="text"
                value={chargeDescription}
                onChange={(e) => setChargeDescription(e.target.value)}
              />
              <div>
                <button
                  onClick={() => createCharge.mutate()}
                  disabled={createCharge.isPending}
                >
                  {createCharge.isPending ? 'Sending…' : 'Create + send link'}
                </button>
                <button type="button" onClick={() => setPanel(null)}>Back</button>
              </div>
            </Panel>
          )}
        </>
      )}

      {/* --- Refund panel (charge-scoped) --- */}
      {panel && typeof panel === 'object' && panel.kind === 'refund' && (
        <Panel title="Refund charge">
          <label htmlFor="refund-amount">Amount (USD)</label>
          <input
            id="refund-amount"
            type="number"
            step="0.01"
            min="0"
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
          />
          <label htmlFor="refund-reason">Reason (optional)</label>
          <input
            id="refund-reason"
            type="text"
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
          />
          <div>
            <button
              onClick={() => doRefund.mutate(panel.chargeId)}
              disabled={doRefund.isPending}
            >
              {doRefund.isPending ? 'Refunding…' : 'Confirm refund'}
            </button>
            <button type="button" onClick={() => setPanel(null)}>Back</button>
          </div>
        </Panel>
      )}

      <nav>
        <Link to="/bookings">← Back to bookings</Link>
      </nav>
    </main>
  );
}

function ChargeRow({
  c,
  onRefundClick,
}: {
  c: AdminBookingCharge;
  onRefundClick: () => void;
}) {
  const remaining = c.amount - c.refundedAmount;
  const canRefund = c.status === 'succeeded' && remaining > 0.001;
  return (
    <li
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
        {c.refundedAmount > 0 && (
          <span className="muted"> · refunded {formatMoney(c.refundedAmount)}</span>
        )}
      </div>
      {c.description && (
        <div className="muted" style={{ fontSize: '0.8rem' }}>{c.description}</div>
      )}
      {c.stripeCheckoutSessionId && (
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          Stripe session: <code>{c.stripeCheckoutSessionId}</code>
        </div>
      )}
      {canRefund && (
        <div style={{ marginTop: '0.5rem' }}>
          <button onClick={onRefundClick}>Refund (max {formatMoney(remaining)})</button>
        </div>
      )}
    </li>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        margin: '0.75rem 0',
        padding: '1rem',
        border: '1px solid #d8d2bd',
        borderRadius: 4,
        background: '#fdfcf6',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <h3 style={{ margin: 0 }}>{title}</h3>
      {children}
    </section>
  );
}

const successStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#ecfdec',
  border: '1px solid #b4e5b4',
  borderRadius: 4,
  color: '#1a8b1a',
  fontSize: '0.9rem',
  margin: '1rem 0',
};

const infoStyle: React.CSSProperties = {
  padding: '0.75rem 1rem',
  background: '#f3f6ff',
  border: '1px solid #b8c6e8',
  borderRadius: 4,
  color: '#1a3a8b',
  fontSize: '0.9rem',
  margin: '1rem 0',
};
