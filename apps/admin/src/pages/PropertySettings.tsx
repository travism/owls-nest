import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { propertyApi, ApiError } from '../lib/api';
import type { Property } from '@owlsnest/shared';

type FormState = {
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  checkInTime: string;
  checkOutTime: string;
  maxGuests: string;
  baseNightlyRate: string;
  cleaningFee: string;
  minStay: string;
};

function toForm(p: Property): FormState {
  return {
    name: p.name,
    addressLine1: p.addressLine1,
    city: p.city,
    state: p.state,
    postalCode: p.postalCode,
    checkInTime: p.checkInTime,
    checkOutTime: p.checkOutTime,
    maxGuests: String(p.maxGuests),
    baseNightlyRate: String(p.baseNightlyRate),
    cleaningFee: String(p.cleaningFee),
    minStay: String(p.minStay),
  };
}

export function PropertySettingsPage() {
  const queryClient = useQueryClient();
  const ids = {
    name: useId(),
    addressLine1: useId(),
    city: useId(),
    state: useId(),
    postalCode: useId(),
    checkInTime: useId(),
    checkOutTime: useId(),
    maxGuests: useId(),
    baseNightlyRate: useId(),
    cleaningFee: useId(),
    minStay: useId(),
  };

  const q = useQuery({ queryKey: ['property'], queryFn: () => propertyApi.get() });

  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (q.data) setForm(toForm(q.data));
  }, [q.data]);

  const update = useMutation({
    mutationFn: (body: Partial<FormState>) =>
      propertyApi.update({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.addressLine1 !== undefined && { addressLine1: body.addressLine1 }),
        ...(body.city !== undefined && { city: body.city }),
        ...(body.state !== undefined && { state: body.state }),
        ...(body.postalCode !== undefined && { postalCode: body.postalCode }),
        ...(body.checkInTime !== undefined && { checkInTime: body.checkInTime }),
        ...(body.checkOutTime !== undefined && { checkOutTime: body.checkOutTime }),
        ...(body.maxGuests !== undefined && { maxGuests: Number(body.maxGuests) }),
        ...(body.baseNightlyRate !== undefined && {
          baseNightlyRate: Number(body.baseNightlyRate),
        }),
        ...(body.cleaningFee !== undefined && { cleaningFee: Number(body.cleaningFee) }),
        ...(body.minStay !== undefined && { minStay: Number(body.minStay) }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['property'], data);
      setForm(toForm(data));
      setSuccess(true);
      setError(null);
      setTimeout(() => setSuccess(false), 3000);
    },
    onError: (err) => {
      setSuccess(false);
      if (err instanceof ApiError) setError(err.message);
      else setError('Could not save changes.');
    },
  });

  if (q.isPending || !form) {
    return (
      <main>
        <h1>Property settings</h1>
        <p>Loading…</p>
      </main>
    );
  }

  if (q.isError) {
    return (
      <main>
        <h1>Property settings</h1>
        <div className="error" role="alert">Could not load property.</div>
      </main>
    );
  }

  function update_(field: keyof FormState, value: string) {
    setForm((f) => (f ? { ...f, [field]: value } : f));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    update.mutate(form!);
  }

  return (
    <main style={{ maxWidth: 640 }}>
      <h1>Property settings</h1>
      <p className="muted">
        Updates here are reflected on the public booking site immediately.
      </p>

      <form onSubmit={onSubmit}>
        <h2>Identity</h2>
        <label htmlFor={ids.name}>
          <span>Name</span>
          <input
            id={ids.name}
            type="text"
            value={form.name}
            onChange={(e) => update_('name', e.target.value)}
            required
          />
        </label>

        <h2>Address</h2>
        <label htmlFor={ids.addressLine1}>
          <span>Street</span>
          <input
            id={ids.addressLine1}
            type="text"
            value={form.addressLine1}
            onChange={(e) => update_('addressLine1', e.target.value)}
            required
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '0.75rem' }}>
          <label htmlFor={ids.city}>
            <span>City</span>
            <input
              id={ids.city}
              type="text"
              value={form.city}
              onChange={(e) => update_('city', e.target.value)}
              required
            />
          </label>
          <label htmlFor={ids.state}>
            <span>State</span>
            <input
              id={ids.state}
              type="text"
              value={form.state}
              onChange={(e) => update_('state', e.target.value.toUpperCase())}
              required
              maxLength={2}
              minLength={2}
            />
          </label>
          <label htmlFor={ids.postalCode}>
            <span>ZIP</span>
            <input
              id={ids.postalCode}
              type="text"
              value={form.postalCode}
              onChange={(e) => update_('postalCode', e.target.value)}
              required
            />
          </label>
        </div>

        <h2>Stay defaults</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label htmlFor={ids.checkInTime}>
            <span>Check-in time</span>
            <input
              id={ids.checkInTime}
              type="text"
              value={form.checkInTime}
              onChange={(e) => update_('checkInTime', e.target.value)}
              placeholder="15:00:00"
              pattern="^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$"
              required
            />
          </label>
          <label htmlFor={ids.checkOutTime}>
            <span>Check-out time</span>
            <input
              id={ids.checkOutTime}
              type="text"
              value={form.checkOutTime}
              onChange={(e) => update_('checkOutTime', e.target.value)}
              placeholder="11:00:00"
              pattern="^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$"
              required
            />
          </label>
          <label htmlFor={ids.maxGuests}>
            <span>Max guests</span>
            <input
              id={ids.maxGuests}
              type="number"
              min={1}
              max={20}
              value={form.maxGuests}
              onChange={(e) => update_('maxGuests', e.target.value)}
              required
            />
          </label>
          <label htmlFor={ids.minStay}>
            <span>Minimum stay (nights)</span>
            <input
              id={ids.minStay}
              type="number"
              min={1}
              max={30}
              value={form.minStay}
              onChange={(e) => update_('minStay', e.target.value)}
              required
            />
          </label>
        </div>

        <h2>Pricing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label htmlFor={ids.baseNightlyRate}>
            <span>Base nightly rate ($)</span>
            <input
              id={ids.baseNightlyRate}
              type="number"
              min={0}
              step="0.01"
              value={form.baseNightlyRate}
              onChange={(e) => update_('baseNightlyRate', e.target.value)}
              required
            />
          </label>
          <label htmlFor={ids.cleaningFee}>
            <span>Cleaning fee ($)</span>
            <input
              id={ids.cleaningFee}
              type="number"
              min={0}
              step="0.01"
              value={form.cleaningFee}
              onChange={(e) => update_('cleaningFee', e.target.value)}
              required
            />
          </label>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem' }}>
          Cleaning fee is baked into the nightly rate guests see. Tracked internally for
          per-booking cost reporting.
        </p>

        {error && <div className="error" role="alert">{error}</div>}
        {success && (
          <div
            role="status"
            style={{
              padding: '0.75rem 1rem',
              background: '#ecfdec',
              border: '1px solid #b4e5b4',
              borderRadius: 4,
              color: '#1a8b1a',
              fontSize: '0.875rem',
              margin: '1rem 0',
            }}
          >
            Saved.
          </div>
        )}

        <button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </form>

      <nav>
        <Link to="/">← Back to dashboard</Link>
        <Link to="/blocked-dates">Manage blocked dates →</Link>
      </nav>
    </main>
  );
}
