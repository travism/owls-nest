import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  inquiriesApi,
  ApiError,
  type AdminInquiry,
  type InquiryStatus,
} from '../lib/api';

const STATUS_LABEL: Record<InquiryStatus, string> = {
  new: 'New',
  responded: 'Responded',
  converted: 'Converted',
  closed: 'Closed',
};

export function InquiriesPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<InquiryStatus | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['inquiries', filter],
    queryFn: () => inquiriesApi.list(filter === 'all' ? undefined : filter),
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['inquiries'] });
  }

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'responded' | 'closed' }) =>
      inquiriesApi.transition(id, status),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not update inquiry.'),
  });

  const convert = useMutation({
    mutationFn: (id: string) => inquiriesApi.convert(id),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not convert inquiry.'),
  });

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Inquiries</h1>
      <p className="muted">
        No-account guest inquiries. Reply by email, then mark responded — or
        convert directly to a booking request.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', margin: '1rem 0' }}>
        {(['all', 'new', 'responded', 'converted', 'closed'] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={s === filter ? '' : 'secondary'}
            onClick={() => setFilter(s)}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
          >
            {s === 'all' ? 'All' : STATUS_LABEL[s as InquiryStatus]}
          </button>
        ))}
      </div>

      {q.isPending && <p>Loading…</p>}
      {q.isError && (
        <div className="error" role="alert">
          Could not load inquiries.
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {q.data && q.data.length === 0 && (
        <p className="muted">No inquiries match this filter yet.</p>
      )}

      {q.data && q.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5dd' }}>
              <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>Status</th>
              <th style={{ padding: '0.5rem' }}>Guest</th>
              <th style={{ padding: '0.5rem' }}>Dates</th>
              <th style={{ padding: '0.5rem' }}>Submitted</th>
              <th style={{ padding: '0.5rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((i) => (
              <InquiryRow
                key={i.id}
                inquiry={i}
                onTransition={(status) => transition.mutate({ id: i.id, status })}
                onConvert={() => {
                  if (confirm('Convert this inquiry to a booking request? This is final.')) {
                    convert.mutate(i.id);
                  }
                }}
                pending={transition.isPending || convert.isPending}
              />
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

function InquiryRow({
  inquiry,
  onTransition,
  onConvert,
  pending,
}: {
  inquiry: AdminInquiry;
  onTransition: (s: 'responded' | 'closed') => void;
  onConvert: () => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isTerminal = inquiry.status === 'converted' || inquiry.status === 'closed';

  return (
    <>
      <tr style={{ borderBottom: '1px solid #f0f0e8', cursor: 'pointer' }} onClick={() => setOpen((v) => !v)}>
        <td style={{ padding: '0.6rem 0.5rem 0.6rem 0' }}>
          <StatusPill status={inquiry.status} />
        </td>
        <td style={{ padding: '0.6rem 0.5rem' }}>
          <div style={{ fontWeight: 500 }}>{inquiry.name}</div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>{inquiry.email}</div>
        </td>
        <td style={{ padding: '0.6rem 0.5rem' }}>
          {inquiry.checkIn} → {inquiry.checkOut}
        </td>
        <td style={{ padding: '0.6rem 0.5rem' }} className="muted">
          {new Date(inquiry.createdAt).toLocaleDateString()}
        </td>
        <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right' }}>
          {!isTerminal && (
            <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
              {inquiry.status === 'new' && (
                <button
                  type="button"
                  className="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTransition('responded');
                  }}
                  disabled={pending}
                  style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                >
                  Mark responded
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onConvert();
                }}
                disabled={pending}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
              >
                Convert
              </button>
              <button
                type="button"
                className="secondary"
                onClick={(e) => {
                  e.stopPropagation();
                  onTransition('closed');
                }}
                disabled={pending}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
              >
                Close
              </button>
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} style={{ padding: '0 0.5rem 1rem 0.5rem', background: '#fafaf7' }}>
            <div style={{ padding: '0.75rem 1rem', borderLeft: '3px solid #c8674a' }}>
              <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>
                Phone: {inquiry.phone ?? 'not provided'} · Submitted{' '}
                {new Date(inquiry.createdAt).toLocaleString()}
              </p>
              {inquiry.message ? (
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{inquiry.message}</p>
              ) : (
                <p className="muted" style={{ margin: 0 }}>No message provided.</p>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function StatusPill({ status }: { status: InquiryStatus }) {
  const colors: Record<InquiryStatus, string> = {
    new: '#c8674a',        // canyon terracotta — urgent
    responded: '#88a888',  // sage — handled, awaiting reply
    converted: '#2f4f3a',  // juniper — terminal, productive
    closed: '#999',        // gray — terminal, dropped
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.6rem',
        borderRadius: '999px',
        background: colors[status],
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
