// Lightweight runtime API client for the public guest site.
// Used by React islands (booking calendar, future inquiry form, etc.).
//
// Keep this minimal — public endpoints don't need CSRF and don't carry
// session credentials. The admin SPA's client (apps/admin/src/lib/api.ts)
// handles all that complexity.

import type {
  AvailabilityResponse,
  PricingQuoteResponse,
  Property,
} from '@owlsnest/shared';

const API_BASE =
  (import.meta as any).env?.PUBLIC_API_BASE ??
  // Build-time URL for SSG; defaults to the local API in dev.
  'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      code = body?.error?.code ?? code;
      message = body?.error?.message ?? message;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json();
}

export const guestApi = {
  property: () => get<Property>('/api/v1/property'),
  availability: (from: string, to: string) =>
    get<AvailabilityResponse>(
      `/api/v1/availability?from=${from}&to=${to}`,
    ),
  quote: (checkIn: string, checkOut: string) =>
    get<PricingQuoteResponse>(
      `/api/v1/pricing/quote?checkIn=${checkIn}&checkOut=${checkOut}`,
    ),
};
