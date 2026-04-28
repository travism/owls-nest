// M11: Operator visibility for outbox dead-letters.
//
// Reads /api/v1/admin/outbox-health. Lists dead-lettered rows so the operator
// notices when notifications stop going out — pairs with the dashboard card
// summary. Styling mirrors BlockedDates.tsx for consistency.

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { outboxApi } from '../lib/api';

export function OutboxHealthPage() {
  const q = useQuery({
    queryKey: ['outbox-health'],
    queryFn: () => outboxApi.health(),
  });

  return (
    <main style={{ maxWidth: 960 }}>
      <h1>Outbox health</h1>
      <p className="muted">
        Notifications that failed to send 5+ times. The drain stops retrying
        these — they need manual intervention (check the failure reason, fix
        the upstream issue, then clear or reset the row).
      </p>

      {q.isPending && <p>Loading…</p>}
      {q.isError && <div className="error">Could not load outbox health.</div>}
      {q.data && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', margin: '1rem 0' }}>
            <div>
              <strong>Dead-lettered:</strong> {q.data.deadLettered}
            </div>
            <div>
              <strong>Pending:</strong> {q.data.pending}
            </div>
            {q.data.oldestDeadLetterAt && (
              <div>
                <strong>Oldest:</strong>{' '}
                {new Date(q.data.oldestDeadLetterAt).toLocaleString()}
              </div>
            )}
          </div>

          {q.data.recent.length === 0 && (
            <p className="muted">No dead-lettered rows. All clear.</p>
          )}
          {q.data.recent.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5dd' }}>
                  <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>Job</th>
                  <th style={{ padding: '0.5rem' }}>Idempotency key</th>
                  <th style={{ padding: '0.5rem' }}>Attempts</th>
                  <th style={{ padding: '0.5rem' }}>Failure reason</th>
                  <th style={{ padding: '0.5rem' }}>Failed at</th>
                </tr>
              </thead>
              <tbody>
                {q.data.recent.map((r) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f0f0e8' }}>
                    <td style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{r.jobName}</td>
                    <td
                      style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}
                    >
                      {r.idempotencyKey ?? '—'}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{r.attempts}</td>
                    <td style={{ padding: '0.5rem' }}>{r.failureReason ?? '—'}</td>
                    <td style={{ padding: '0.5rem' }}>
                      {r.failedAt ? new Date(r.failedAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <nav>
        <Link to="/">← Back to dashboard</Link>
      </nav>
    </main>
  );
}
