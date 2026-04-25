// Lightweight runtime API client for the public guest site.
// Used by React islands (booking calendar, inquiry form, etc.).
//
// Keep this minimal — public endpoints don't need CSRF and don't carry
// session credentials. The admin SPA's client (apps/admin/src/lib/api.ts)
// handles all that complexity.

import type {
  AvailabilityResponse,
  InquiryCreate,
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

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
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
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const guestApi = {
  property: () => call<Property>('/api/v1/property'),
  availability: (from: string, to: string) =>
    call<AvailabilityResponse>(
      `/api/v1/availability?from=${from}&to=${to}`,
    ),
  quote: (checkIn: string, checkOut: string) =>
    call<PricingQuoteResponse>(
      `/api/v1/pricing/quote?checkIn=${checkIn}&checkOut=${checkOut}`,
    ),
  submitInquiry: (body: InquiryCreate) =>
    call<{ id: string; status: string }>('/api/v1/inquiries', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
