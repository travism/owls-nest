// InquiryForm — public inquiry submission island.
//
// Lives on /book/inquire. The /book calendar's "Continue" button hands
// off the selected dates via URL query params (?checkIn=…&checkOut=…),
// which this component reads on mount and pre-fills + locks. If no
// query params are provided (someone hits /book/inquire directly),
// the date inputs render as normal editable fields.
//
// When dates are locked, we also re-fetch the pricing quote and the
// property record so the guest sees the same total they saw on /book
// and can pick a guest count within maxGuests.
//
// Uses the same Zod schema (InquiryCreateSchema) the API uses so
// validation errors surface client-side before a round-trip.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { InquiryCreateSchema } from '@owlsnest/shared';
import type { PricingQuoteResponse, Property } from '@owlsnest/shared';
import { guestApi, ApiError } from '../lib/api';

type FieldErrors = Partial<Record<
  'name' | 'email' | 'phone' | 'checkIn' | 'checkOut' | 'numGuests' | 'petCount' | 'message',
  string
>>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readDatesFromUrl(): { checkIn: string; checkOut: string } | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const ci = params.get('checkIn');
  const co = params.get('checkOut');
  if (!ci || !co) return null;
  if (!ISO_DATE_RE.test(ci) || !ISO_DATE_RE.test(co)) return null;
  if (co <= ci) return null;
  return { checkIn: ci, checkOut: co };
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function nightsBetween(ci: string, co: string): number {
  const a = new Date(ci).getTime();
  const b = new Date(co).getTime();
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

export function InquiryForm() {
  const ids = {
    name: useId(),
    email: useId(),
    phone: useId(),
    checkIn: useId(),
    checkOut: useId(),
    numGuests: useId(),
    hasPet: useId(),
    petCount: useId(),
    message: useId(),
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [numGuests, setNumGuests] = useState(1);
  const [hasPet, setHasPet] = useState(false);
  const [petCount, setPetCount] = useState(1);
  const [message, setMessage] = useState('');
  // Once the URL provides dates, those inputs lock — the user must go
  // back to /book to change them so the calendar's availability/pricing
  // stays the source of truth.
  const [datesLocked, setDatesLocked] = useState(false);

  const [property, setProperty] = useState<Property | null>(null);
  const [quote, setQuote] = useState<PricingQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    const fromUrl = readDatesFromUrl();
    if (fromUrl) {
      setCheckIn(fromUrl.checkIn);
      setCheckOut(fromUrl.checkOut);
      setDatesLocked(true);
    }

    let cancelled = false;
    guestApi
      .property()
      .then((p) => {
        if (!cancelled) setProperty(p);
      })
      .catch(() => {
        // Non-fatal — we just won't be able to enforce maxGuests client-side.
      });

    if (fromUrl) {
      guestApi
        .quote(fromUrl.checkIn, fromUrl.checkOut)
        .then((q) => {
          if (!cancelled) setQuote(q);
        })
        .catch((err) => {
          if (cancelled) return;
          setQuoteError(
            err instanceof ApiError ? err.message : 'Could not load pricing.',
          );
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setName('');
    setEmail('');
    setPhone('');
    if (!datesLocked) {
      setCheckIn('');
      setCheckOut('');
    }
    setNumGuests(1);
    setHasPet(false);
    setPetCount(1);
    setMessage('');
    setErrors({});
    setSubmitError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setErrors({});

    if (property && numGuests > property.maxGuests) {
      setErrors({
        numGuests: `Too many guests — this property sleeps up to ${property.maxGuests}.`,
      });
      return;
    }

    const candidate = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      checkIn,
      checkOut,
      numGuests,
      petCount: hasPet ? petCount : 0,
      message: message.trim() || undefined,
    };

    const parsed = InquiryCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      const fieldErrors: FieldErrors = {};
      for (const [key, msgs] of Object.entries(parsed.error.flatten().fieldErrors)) {
        if (msgs && msgs.length > 0) fieldErrors[key as keyof FieldErrors] = msgs[0];
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      await guestApi.submitInquiry(parsed.data);
      setSubmitted(true);
      reset();
    } catch (err) {
      if (err instanceof ApiError) setSubmitError(err.message);
      else setSubmitError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="inquiry-form inquiry-form--success" role="status">
        <h2>Thanks — we got it.</h2>
        <p>
          We'll review your booking request and reply by email within a few
          hours during normal waking hours.
        </p>
        <button type="button" className="secondary" onClick={() => setSubmitted(false)}>
          Send another request
        </button>
      </div>
    );
  }

  const showQuote = datesLocked && (quote || quoteError);
  const nights = checkIn && checkOut ? nightsBetween(checkIn, checkOut) : 0;
  const maxGuests = property?.maxGuests ?? 20;

  return (
    <form className="inquiry-form" onSubmit={onSubmit} noValidate>
      {showQuote && (
        <aside className="inquiry-form__quote" aria-label="Your selected stay">
          <h2>Your stay</h2>
          {quote ? (
            <>
              <p className="inquiry-form__quote-meta">
                {nights} {nights === 1 ? 'night' : 'nights'} · {checkIn} → {checkOut}
              </p>
              <table className="inquiry-form__quote-table">
                <tbody>
                  <tr>
                    <td>{nights} × {formatMoney(quote.nightlyRate)}/night</td>
                    <td>{formatMoney(quote.subtotal)}</td>
                  </tr>
                  <tr>
                    <td>
                      {quote.taxes.stateTlt.label} (
                      {(quote.taxes.stateTlt.rate * 100).toFixed(1)}%)
                    </td>
                    <td>{formatMoney(quote.taxes.stateTlt.amount)}</td>
                  </tr>
                  <tr>
                    <td>
                      {quote.taxes.cityTlt.label} (
                      {(quote.taxes.cityTlt.rate * 100).toFixed(1)}%)
                    </td>
                    <td>{formatMoney(quote.taxes.cityTlt.amount)}</td>
                  </tr>
                  <tr className="inquiry-form__quote-total">
                    <td>Total</td>
                    <td>{formatMoney(quote.total)}</td>
                  </tr>
                </tbody>
              </table>
            </>
          ) : (
            <p className="inquiry-form__field-error" role="alert">
              {quoteError}
            </p>
          )}
        </aside>
      )}

      <h2>Your details</h2>
      <p className="inquiry-form__lede">
        We'll reply by email — usually within a few hours during normal waking
        hours. Booking is by request, no payment is taken at this step.
      </p>

      <div className="inquiry-form__row">
        <label htmlFor={ids.name}>
          <span>Your name</span>
          <input
            id={ids.name}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            autoComplete="name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? `${ids.name}-err` : undefined}
          />
          {errors.name && (
            <small id={`${ids.name}-err`} className="inquiry-form__field-error">
              {errors.name}
            </small>
          )}
        </label>

        <label htmlFor={ids.email}>
          <span>Email</span>
          <input
            id={ids.email}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? `${ids.email}-err` : undefined}
          />
          {errors.email && (
            <small id={`${ids.email}-err`} className="inquiry-form__field-error">
              {errors.email}
            </small>
          )}
        </label>
      </div>

      <label htmlFor={ids.phone}>
        <span>Phone</span>
        <input
          id={ids.phone}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          autoComplete="tel"
          aria-invalid={!!errors.phone}
          aria-describedby={errors.phone ? `${ids.phone}-err` : undefined}
        />
        {errors.phone && (
          <small id={`${ids.phone}-err`} className="inquiry-form__field-error">
            {errors.phone}
          </small>
        )}
      </label>

      <div className="inquiry-form__row">
        <label htmlFor={ids.checkIn}>
          <span>Check-in</span>
          <input
            id={ids.checkIn}
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            required
            readOnly={datesLocked}
            aria-readonly={datesLocked || undefined}
            aria-invalid={!!errors.checkIn}
            aria-describedby={errors.checkIn ? `${ids.checkIn}-err` : undefined}
          />
          {errors.checkIn && (
            <small id={`${ids.checkIn}-err`} className="inquiry-form__field-error">
              {errors.checkIn}
            </small>
          )}
        </label>

        <label htmlFor={ids.checkOut}>
          <span>Check-out</span>
          <input
            id={ids.checkOut}
            type="date"
            value={checkOut}
            onChange={(e) => setCheckOut(e.target.value)}
            required
            readOnly={datesLocked}
            aria-readonly={datesLocked || undefined}
            aria-invalid={!!errors.checkOut}
            aria-describedby={errors.checkOut ? `${ids.checkOut}-err` : undefined}
          />
          {errors.checkOut && (
            <small id={`${ids.checkOut}-err`} className="inquiry-form__field-error">
              {errors.checkOut}
            </small>
          )}
        </label>
        {datesLocked && (
          <p className="inquiry-form__locked-hint">
            Dates pulled from the calendar. <a href="/book">Change dates</a>.
          </p>
        )}
      </div>

      <label htmlFor={ids.numGuests}>
        <span>Number of guests</span>
        <select
          id={ids.numGuests}
          value={numGuests}
          onChange={(e) => setNumGuests(Number(e.target.value))}
          required
          aria-invalid={!!errors.numGuests}
          aria-describedby={errors.numGuests ? `${ids.numGuests}-err` : undefined}
        >
          {Array.from({ length: maxGuests }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        {property && (
          <small className="inquiry-form__hint">
            Maximum {property.maxGuests} guests for this property.
          </small>
        )}
        {errors.numGuests && (
          <small id={`${ids.numGuests}-err`} className="inquiry-form__field-error">
            {errors.numGuests}
          </small>
        )}
      </label>

      <fieldset className="inquiry-form__fieldset">
        <legend>Pets</legend>
        <label htmlFor={ids.hasPet} className="inquiry-form__checkbox">
          <input
            id={ids.hasPet}
            type="checkbox"
            checked={hasPet}
            onChange={(e) => setHasPet(e.target.checked)}
          />
          <span>Planning to bring a dog?</span>
        </label>
        {hasPet && (
          <>
            <label htmlFor={ids.petCount}>
              <span>How many dogs?</span>
              <select
                id={ids.petCount}
                value={petCount}
                onChange={(e) => setPetCount(Number(e.target.value))}
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </label>
            <p className="inquiry-form__hint">
              Up to 2 dogs allowed (other pets are not).{' '}
              <a href="/house-rules#pets" target="_blank" rel="noopener">
                View pet rules ↗
              </a>
            </p>
          </>
        )}
      </fieldset>

      <label htmlFor={ids.message}>
        <span>What brings you to Central Oregon? No wrong answers!</span>
        <textarea
          id={ids.message}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
          placeholder="Travel plans, questions about the property, anything we should know"
        />
      </label>

      {submitError && (
        <div className="inquiry-form__error" role="alert">
          {submitError}
        </div>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Sending…' : 'Send booking request'}
      </button>
    </form>
  );
}
