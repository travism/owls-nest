// Tiny API client. Handles credentials and CSRF token automatically.
// CSRF flow:
//   1. On boot (or 403), fetch GET /api/v1/auth/csrf-token to set the cookie + receive the token.
//   2. Cache the token in memory; send via x-csrf-token header on all non-GET requests.

const API_BASE =
  (import.meta as any).env?.VITE_API_BASE ?? 'http://localhost:3000';

let csrfToken: string | null = null;

async function fetchCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/v1/auth/csrf-token`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('Failed to fetch CSRF token');
  const data = await res.json();
  csrfToken = data.token;
  return data.token;
}

export interface ApiErrorBody {
  error: { code: string; message?: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { method?: string } = {},
): Promise<T> {
  const method = init.method ?? 'GET';
  const isMutating = method !== 'GET' && method !== 'HEAD';

  if (isMutating && !csrfToken) {
    await fetchCsrfToken();
  }

  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');
  if (isMutating && csrfToken) headers.set('x-csrf-token', csrfToken);

  let res = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
  });

  // Auto-retry once on CSRF rejection (token may have rotated after session change).
  // The API filter normalizes csrf-csrf's bare ForbiddenException into our envelope
  // with code === 'CSRF_INVALID', so a clean code check is sufficient.
  if (isMutating && res.status === 403) {
    try {
      const body = (await res.clone().json()) as Partial<ApiErrorBody>;
      if (body?.error?.code === 'CSRF_INVALID') {
        await fetchCsrfToken();
        headers.set('x-csrf-token', csrfToken!);
        res = await fetch(`${API_BASE}${path}`, {
          ...init,
          method,
          headers,
          credentials: 'include',
        });
      }
    } catch {
      // not JSON; fall through to error handling
    }
  }

  if (!res.ok) {
    let errBody: Partial<ApiErrorBody> = {};
    try {
      errBody = await res.json();
    } catch {
      // ignore
    }
    const code = errBody?.error?.code ?? 'INTERNAL_ERROR';
    const message = errBody?.error?.message ?? `Request failed (${res.status})`;
    throw new ApiError(res.status, code, message, errBody?.error?.details);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  get: <T>(path: string) => call<T>(path),
  post: <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    call<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => call<T>(path, { method: 'DELETE' }),
  primeCsrf: fetchCsrfToken,
};

// ----- Typed auth endpoints -----

export interface SessionUser {
  id: string;
  email: string;
}

export const authApi = {
  whoami: () => api.get<{ user: SessionUser }>('/api/v1/auth/admin/whoami'),
  login: (email: string, password: string) =>
    api.post<{ challenge: 'totp'; challengeToken: string }>(
      '/api/v1/auth/admin/login',
      { email, password },
    ),
  totp: (challengeToken: string, code: string) =>
    api.post<{ user: SessionUser }>('/api/v1/auth/admin/totp', {
      challengeToken,
      code,
    }),
  recovery: (challengeToken: string, code: string) =>
    api.post<{ user: SessionUser }>('/api/v1/auth/admin/recovery', {
      challengeToken,
      code,
    }),
  logout: () => api.post<{ ok: true }>('/api/v1/auth/admin/logout'),
  setup: (email: string, password: string) =>
    api.post<{ otpauthUrl: string; qrDataUrl: string; setupToken: string }>(
      '/api/v1/auth/admin/setup',
      { email, password },
    ),
  setupVerify: (setupToken: string, totpCode: string) =>
    api.post<{ recoveryCodes: string[] }>('/api/v1/auth/admin/setup/verify', {
      setupToken,
      totpCode,
    }),
};

// ----- Property -----

import type { Property, PropertyUpdate, BlockedDate, BlockedDateCreate } from '@owlsnest/shared';

export const propertyApi = {
  get: () => api.get<Property>('/api/v1/property'),
  update: (body: PropertyUpdate) => api.patch<Property>('/api/v1/property', body),
};

// ----- Blocked dates -----

export const blockedDatesApi = {
  list: () => api.get<BlockedDate[]>('/api/v1/blocked-dates'),
  create: (body: BlockedDateCreate) =>
    api.post<BlockedDate>('/api/v1/blocked-dates', body),
  remove: (id: string) => api.delete<{ ok: true }>(`/api/v1/blocked-dates/${id}`),
};

// ----- Inquiries -----

export type InquiryStatus = 'new' | 'responded' | 'converted' | 'closed';
export interface AdminInquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  checkIn: string;
  checkOut: string;
  message: string | null;
  status: InquiryStatus;
  convertedBookingId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ----- Bookings -----

export type BookingStatus =
  | 'inquiry'
  | 'pending_approval'
  | 'approved'
  | 'confirmed'
  | 'cancelled'
  | 'completed';

export interface AdminBookingCharge {
  id: string;
  kind: string;
  amount: number;
  status: string;
  description: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  refundedAmount: number;
  refundedAt: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface AdminBooking {
  id: string;
  status: BookingStatus;
  source: string;
  guestId: string | null;
  guest: { id: string; name: string; email: string; phone: string | null } | null;
  checkIn: string;
  checkOut: string;
  numNights: number;
  numGuests: number;
  nightlyRate: number;
  subtotal: number;
  totalTaxAmount: number;
  totalWithTax: number;
  stripeCustomerId: string | null;
  cancellationTierApplied: string | null;
  refundAmount: number | null;
  cancelledAt: string | null;
  charges: AdminBookingCharge[];
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalResponse {
  booking: AdminBooking;
  checkoutUrl: string;
  chargeId: string;
}

export type AdHocChargeKind = 'extension' | 'damage' | 'incidental';

export interface ModifyDatesResponse {
  booking: AdminBooking;
  delta: {
    direction: 'increase' | 'decrease' | 'unchanged';
    amount: number;
    suggestedAdHocChargeKind: AdHocChargeKind | null;
    refundIssued: { chargeId: string; amount: number } | null;
  };
}

export interface AdHocChargeResponse {
  booking: AdminBooking;
  chargeId: string;
  checkoutUrl: string;
}

export interface RefundResponse {
  booking: AdminBooking;
  chargeId: string;
  amountRefunded: number;
}

export const bookingsApi = {
  list: (status?: BookingStatus) =>
    api.get<AdminBooking[]>(
      status
        ? `/api/v1/admin/bookings?status=${status}`
        : '/api/v1/admin/bookings',
    ),
  get: (id: string) => api.get<AdminBooking>(`/api/v1/admin/bookings/${id}`),
  approve: (id: string) =>
    api.post<ApprovalResponse>(`/api/v1/admin/bookings/${id}/approve`),
  decline: (id: string, reason?: string) =>
    api.post<AdminBooking>(`/api/v1/admin/bookings/${id}/decline`, { reason }),
  cancel: (id: string, reason?: string) =>
    api.post<AdminBooking>(`/api/v1/admin/bookings/${id}/cancel`, { reason }),
  modifyDates: (id: string, checkIn: string, checkOut: string) =>
    api.post<ModifyDatesResponse>(`/api/v1/admin/bookings/${id}/modify-dates`, {
      checkIn,
      checkOut,
    }),
  createCharge: (
    id: string,
    body: { kind: AdHocChargeKind; amount: number; description: string },
  ) => api.post<AdHocChargeResponse>(`/api/v1/admin/bookings/${id}/charges`, body),
  refundCharge: (chargeId: string, amount: number, reason?: string) =>
    api.post<RefundResponse>(`/api/v1/admin/bookings/charges/${chargeId}/refund`, {
      amount,
      reason,
    }),
};

// ----- Outbox health (M11) -----

export interface OutboxHealthRow {
  id: string;
  jobName: string;
  idempotencyKey: string | null;
  attempts: number;
  failureReason: string | null;
  createdAt: string;
  failedAt: string | null;
}

export interface OutboxHealth {
  deadLettered: number;
  pending: number;
  oldestDeadLetterAt: string | null;
  recent: OutboxHealthRow[];
}

export const outboxApi = {
  health: () => api.get<OutboxHealth>('/api/v1/admin/outbox-health'),
};

export const inquiriesApi = {
  list: (status?: InquiryStatus) =>
    api.get<AdminInquiry[]>(
      status
        ? `/api/v1/admin/inquiries?status=${status}`
        : '/api/v1/admin/inquiries',
    ),
  get: (id: string) => api.get<AdminInquiry>(`/api/v1/admin/inquiries/${id}`),
  transition: (id: string, status: 'responded' | 'closed') =>
    api.post<AdminInquiry>(`/api/v1/admin/inquiries/${id}/transition`, { status }),
  convert: (id: string) =>
    api.post<AdminInquiry>(`/api/v1/admin/inquiries/${id}/convert`),
};
