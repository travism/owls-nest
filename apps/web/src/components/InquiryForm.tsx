// InquiryForm — public inquiry submission island.
//
// Lives on /book/inquire. The /book calendar's "Continue" button hands
// off the selected dates via URL query params (?checkIn=…&checkOut=…),
// which this component reads on mount and pre-fills + locks. If no
// query params are provided (someone hits /book/inquire directly),
// the date inputs render as normal editable fields.
//
// Uses the same Zod schema (InquiryCreateSchema) the API uses so
// validation errors surface client-side before a round-trip.

import { useEffect, useId, useState, type FormEvent } from 'react';
import { InquiryCreateSchema } from '@owlsnest/shared';
import { guestApi, ApiError } from '../lib/api';

type FieldErrors = Partial<Record<
  'name' | 'email' | 'phone' | 'checkIn' | 'checkOut' | 'message',
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

export function InquiryForm() {
  const ids = {
    name: useId(),
    email: useId(),
    phone: useId(),
    checkIn: useId(),
    checkOut: useId(),
    message: useId(),
  };

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [message, setMessage] = useState('');
  // Once the URL provides dates, those inputs lock — the user must go
  // back to /book to change them so the calendar's availability/pricing
  // stays the source of truth.
  const [datesLocked, setDatesLocked] = useState(false);

  useEffect(() => {
    const fromUrl = readDatesFromUrl();
    if (fromUrl) {
      setCheckIn(fromUrl.checkIn);
      setCheckOut(fromUrl.checkOut);
      setDatesLocked(true);
    }
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
    setMessage('');
    setErrors({});
    setSubmitError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setErrors({});

    const candidate = {
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      checkIn,
      checkOut,
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

  return (
    <form className="inquiry-form" onSubmit={onSubmit} noValidate>
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
        <span>Phone (optional)</span>
        <input
          id={ids.phone}
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
        />
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

      <label htmlFor={ids.message}>
        <span>Anything else?</span>
        <textarea
          id={ids.message}
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={2000}
          placeholder="Travel plans, questions about the property, the dog you're hoping to bring (we don't allow pets but you can ask)"
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
