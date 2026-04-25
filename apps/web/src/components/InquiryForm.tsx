// InquiryForm — public inquiry submission island, rendered below the
// booking calendar on /book. M6 deliverable: capture name/email/phone/
// dates/message and POST to /api/v1/inquiries.
//
// We use the same Zod schema (InquiryCreateSchema) the API uses, so
// validation errors surface client-side before a round-trip.

import { useId, useState, type FormEvent } from 'react';
import { InquiryCreateSchema } from '@owlsnest/shared';
import { guestApi, ApiError } from '../lib/api';

type FieldErrors = Partial<Record<
  'name' | 'email' | 'phone' | 'checkIn' | 'checkOut' | 'message',
  string
>>;

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

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setName('');
    setEmail('');
    setPhone('');
    setCheckIn('');
    setCheckOut('');
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
          We'll review your dates and reply by email within a few hours during
          normal waking hours.
        </p>
        <button type="button" className="secondary" onClick={() => setSubmitted(false)}>
          Submit another inquiry
        </button>
      </div>
    );
  }

  return (
    <form className="inquiry-form" onSubmit={onSubmit} noValidate>
      <h2>Send an inquiry</h2>
      <p className="inquiry-form__lede">
        Quick way to ask about dates without creating an account. We'll reply by
        email — usually within a few hours.
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
            aria-invalid={!!errors.checkOut}
            aria-describedby={errors.checkOut ? `${ids.checkOut}-err` : undefined}
          />
          {errors.checkOut && (
            <small id={`${ids.checkOut}-err`} className="inquiry-form__field-error">
              {errors.checkOut}
            </small>
          )}
        </label>
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
        {submitting ? 'Sending…' : 'Send inquiry'}
      </button>
    </form>
  );
}
