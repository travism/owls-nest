// BookingCalendar — React island on the /book page.
//
// Responsibilities:
//   1. Fetch /api/v1/property to know minStay / maxGuests / cancellationPolicy
//   2. Fetch /api/v1/availability for the next 12 months and disable
//      every date inside an unavailable range
//   3. Let the guest pick a check-in + check-out range
//   4. On a complete range that satisfies min-stay, fetch /api/v1/pricing/quote
//      and render the breakdown
//   5. Show a "Continue" CTA that hands off to /book/inquire (M6) or
//      /book/request (M7) — disabled in M5 since those pages don't exist yet
//
// Min-stay enforcement happens client-side AND server-side (the API also
// rejects below-min ranges). The client-side check just gives faster feedback.

import { useEffect, useMemo, useState } from 'react';
import { DayPicker, type DateRange } from 'react-day-picker';
import 'react-day-picker/dist/style.css';
import {
  guestApi,
  ApiError,
} from '../lib/api';
import type {
  Property,
  PricingQuoteResponse,
  UnavailableRange,
} from '@owlsnest/shared';

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nightsBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function disabledDatesFromRanges(ranges: UnavailableRange[]): Array<{ from: Date; to: Date }> {
  // react-day-picker accepts inclusive { from, to } ranges. Our API returns
  // half-open [start, end), so the last disabled day is endDate - 1.
  return ranges.map((r) => {
    const from = new Date(r.startDate);
    const toDate = new Date(r.endDate);
    toDate.setDate(toDate.getDate() - 1);
    return { from, to: toDate };
  });
}

function formatMoney(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function BookingCalendar() {
  const [property, setProperty] = useState<Property | null>(null);
  const [unavailable, setUnavailable] = useState<UnavailableRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [range, setRange] = useState<DateRange | undefined>();
  const [quote, setQuote] = useState<PricingQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Initial load: property settings + 12 months of availability
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = new Date();
        const oneYearOut = new Date();
        oneYearOut.setFullYear(today.getFullYear() + 1);
        const [prop, avail] = await Promise.all([
          guestApi.property(),
          guestApi.availability(toIso(today), toIso(oneYearOut)),
        ]);
        if (cancelled) return;
        setProperty(prop);
        setUnavailable(avail.unavailable);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.message : 'Could not load availability.',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // When the user has selected a complete range, fetch a quote.
  useEffect(() => {
    if (!range?.from || !range?.to || !property) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const nights = nightsBetween(range.from, range.to);
    if (nights < property.minStay) {
      setQuote(null);
      setQuoteError(
        `Minimum stay is ${property.minStay} nights — please pick a longer range.`,
      );
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError(null);
    guestApi
      .quote(toIso(range.from), toIso(range.to))
      .then((q) => {
        if (!cancelled) setQuote(q);
      })
      .catch((err) => {
        if (cancelled) return;
        setQuote(null);
        setQuoteError(
          err instanceof ApiError ? err.message : 'Could not fetch a quote.',
        );
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, property]);

  const disabledDates = useMemo(
    () => [{ before: new Date() }, ...disabledDatesFromRanges(unavailable)],
    [unavailable],
  );

  if (loading) {
    return <p className="bc-status">Loading availability…</p>;
  }
  if (loadError) {
    return (
      <p className="bc-status bc-status--error" role="alert">
        {loadError}
      </p>
    );
  }
  if (!property) return null;

  const haveRange = !!(range?.from && range?.to);
  const nights = haveRange ? nightsBetween(range!.from!, range!.to!) : 0;
  const continueDisabled = !quote || quoteLoading;

  return (
    <div className="booking-calendar">
      <div className="booking-calendar__picker">
        <DayPicker
          mode="range"
          selected={range}
          onSelect={setRange}
          disabled={disabledDates}
          numberOfMonths={2}
          showOutsideDays={false}
        />
        <p className="bc-hint">
          Minimum stay: <strong>{property.minStay} nights</strong>. Maximum guests:{' '}
          <strong>{property.maxGuests}</strong>.
        </p>
      </div>

      <aside className="booking-calendar__quote" aria-live="polite">
        <h2>Your stay</h2>
        {!haveRange && (
          <p className="bc-muted">Pick check-in and check-out dates to see pricing.</p>
        )}
        {haveRange && quoteLoading && <p className="bc-muted">Calculating…</p>}
        {haveRange && quoteError && (
          <p className="bc-status bc-status--error" role="alert">
            {quoteError}
          </p>
        )}
        {haveRange && quote && (
          <>
            <p className="bc-muted">
              {nights} {nights === 1 ? 'night' : 'nights'} · {toIso(range!.from!)} → {toIso(range!.to!)}
            </p>
            <table className="bc-quote">
              <tbody>
                <tr>
                  <td>
                    {nights} × {formatMoney(quote.nightlyRate)}/night
                  </td>
                  <td>{formatMoney(quote.subtotal)}</td>
                </tr>
                <tr>
                  <td>{quote.taxes.stateTlt.label} ({(quote.taxes.stateTlt.rate * 100).toFixed(1)}%)</td>
                  <td>{formatMoney(quote.taxes.stateTlt.amount)}</td>
                </tr>
                <tr>
                  <td>{quote.taxes.cityTlt.label} ({(quote.taxes.cityTlt.rate * 100).toFixed(1)}%)</td>
                  <td>{formatMoney(quote.taxes.cityTlt.amount)}</td>
                </tr>
                <tr className="bc-quote__total">
                  <td>Total</td>
                  <td>{formatMoney(quote.total)}</td>
                </tr>
              </tbody>
            </table>
            <button type="button" disabled={continueDisabled} className="bc-cta">
              Continue (coming soon)
            </button>
            <p className="bc-muted bc-small">
              Inquiry submission lands in the next milestone — no booking is made yet.
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
