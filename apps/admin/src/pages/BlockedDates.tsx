import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { blockedDatesApi, ApiError } from '../lib/api';

export function BlockedDatesPage() {
  const queryClient = useQueryClient();
  const ids = {
    start: useId(),
    end: useId(),
    reason: useId(),
    note: useId(),
  };

  const q = useQuery({
    queryKey: ['blocked-dates'],
    queryFn: () => blockedDatesApi.list(),
  });

  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [reason, setReason] = useState<'manual_block' | 'maintenance'>('manual_block');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      blockedDatesApi.create({
        startDate,
        endDate,
        reason,
        note: note.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-dates'] });
      setNote('');
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message);
      else setError('Could not create block.');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => blockedDatesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blocked-dates'] });
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message);
      else setError('Could not delete block.');
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Blocked dates</h1>
      <p className="muted">
        Block date ranges for owner stays, maintenance, or anything else. OTA-imported
        blocks (Airbnb, VRBO) appear here too but can only be cancelled on the source
        platform.
      </p>

      <h2>Add a block</h2>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label htmlFor={ids.start}>
            <span>Start date</span>
            <input
              id={ids.start}
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </label>
          <label htmlFor={ids.end}>
            <span>End date (exclusive)</span>
            <input
              id={ids.end}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </label>
        </div>
        <label htmlFor={ids.reason}>
          <span>Reason</span>
          <select
            id={ids.reason}
            value={reason}
            onChange={(e) => setReason(e.target.value as 'manual_block' | 'maintenance')}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid #c7c7be',
              borderRadius: 4,
              font: 'inherit',
              background: 'white',
            }}
          >
            <option value="manual_block">Manual block</option>
            <option value="maintenance">Maintenance</option>
          </select>
        </label>
        <label htmlFor={ids.note}>
          <span>Note (optional)</span>
          <input
            id={ids.note}
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="HVAC service, owner stay, etc."
            maxLength={500}
          />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding…' : 'Add block'}
        </button>
      </form>

      <h2>Current blocks</h2>
      {q.isPending && <p>Loading…</p>}
      {q.isError && <div className="error">Could not load blocks.</div>}
      {q.data && q.data.length === 0 && <p className="muted">No blocks yet.</p>}
      {q.data && q.data.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e5dd' }}>
              <th style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>Start</th>
              <th style={{ padding: '0.5rem' }}>End</th>
              <th style={{ padding: '0.5rem' }}>Reason</th>
              <th style={{ padding: '0.5rem' }}>Note</th>
              <th style={{ padding: '0.5rem' }}></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((b) => (
              <tr key={b.id} style={{ borderBottom: '1px solid #f0f0e8' }}>
                <td style={{ padding: '0.5rem 0.5rem 0.5rem 0' }}>{b.startDate}</td>
                <td style={{ padding: '0.5rem' }}>{b.endDate}</td>
                <td style={{ padding: '0.5rem' }}>
                  {b.reason === 'ota_booking'
                    ? `OTA (${b.sourcePlatform ?? '?'})`
                    : b.reason.replace('_', ' ')}
                </td>
                <td style={{ padding: '0.5rem' }}>{b.sourceSummary ?? '—'}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                  {b.reason !== 'ota_booking' && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        if (confirm('Delete this block?')) remove.mutate(b.id);
                      }}
                      disabled={remove.isPending}
                      style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <nav>
        <Link to="/">← Back to dashboard</Link>
        <Link to="/property">Property settings →</Link>
      </nav>
    </main>
  );
}
