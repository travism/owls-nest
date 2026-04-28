// Transactional email templates rendered as plain TS functions.
//
// D-021: templates live in code (not provider-managed) so the same payload
// renders to MailHog in dev and MailerSend in prod with byte-identical output.
// HTML is intentionally minimal — these are transactional notifications, not
// marketing. Polish lands later if/when the brand needs it.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// ---------- helpers ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(amount: number, currency = 'usd'): string {
  return `${currency === 'usd' ? '$' : ''}${amount.toFixed(2)}`;
}

function dateRange(start: string, end: string): string {
  return `${start} → ${end}`;
}

function wrap(title: string, paragraphs: string[]): RenderedEmail {
  const subject = title;
  const html = [
    '<div style="font-family: system-ui, -apple-system, sans-serif; max-width: 540px; color: #222;">',
    `<h2 style="margin: 0 0 12px;">${escapeHtml(title)}</h2>`,
    ...paragraphs.map(
      (p) => `<p style="margin: 0 0 12px; line-height: 1.45;">${p}</p>`,
    ),
    '<p style="margin: 24px 0 0; color: #888; font-size: 12px;">— The Owl\'s Nest</p>',
    '</div>',
  ].join('');
  // Strip tags for text variant — same content, different markup.
  const text = [title, '', ...paragraphs.map(stripTags), '', '— The Owl\'s Nest'].join('\n');
  return { subject, html, text };
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}

// ---------- inquiries (M6 / D-018) ----------

export interface InquiryPayload {
  inquiryId: string;
  guestName: string;
  guestEmail?: string;
  checkIn: string;
  checkOut: string;
  message?: string | null;
}

export function inquiryReceived(p: InquiryPayload): RenderedEmail {
  // Sent to admin — see D-018 trigger list.
  return wrap('New inquiry received', [
    `${escapeHtml(p.guestName)} just submitted an inquiry for ${escapeHtml(dateRange(p.checkIn, p.checkOut))}.`,
    p.message
      ? `Message: <em>${escapeHtml(p.message)}</em>`
      : 'No message attached.',
    `Inquiry ID: <code>${escapeHtml(p.inquiryId)}</code>`,
  ]);
}

export function inquiryAcknowledged(p: InquiryPayload): RenderedEmail {
  // Sent to guest.
  return wrap("We received your inquiry", [
    `Hi ${escapeHtml(p.guestName)},`,
    `Thanks for your interest in The Owl's Nest. We received your inquiry for ${escapeHtml(dateRange(p.checkIn, p.checkOut))} and will be in touch shortly.`,
  ]);
}

// ---------- bookings (M7 / M8) ----------

export interface BookingPaymentLinkPayload {
  bookingId: string;
  chargeId: string;
  guestName?: string;
  checkIn: string;
  checkOut: string;
  numNights?: number;
  amount: number;
  totalPaid?: number;
  currency?: string;
  checkoutUrl: string;
  propertyName?: string;
  propertyAddress?: string;
  checkInTime?: string;
  houseRulesUrl?: string;
}

// M11: payment-link email expanded to include property + dates + house-rules
// link so the guest knows exactly what they're paying for. Stripe Checkout
// Sessions expire after 24 hours by default — surface that to set expectations.
export function bookingPaymentLink(p: BookingPaymentLinkPayload): RenderedEmail {
  const property = p.propertyName ?? "The Owl's Nest";
  const nightsLine =
    p.numNights != null
      ? `${escapeHtml(dateRange(p.checkIn, p.checkOut))} (${p.numNights} night${p.numNights === 1 ? '' : 's'})`
      : escapeHtml(dateRange(p.checkIn, p.checkOut));
  const lines = [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    `Your stay at ${escapeHtml(property)} for ${nightsLine} has been approved. To confirm the booking, please complete payment of ${fmtMoney(p.amount, p.currency)}.`,
    `<a href="${escapeHtml(p.checkoutUrl)}">Pay securely with Stripe</a>`,
    'This payment link expires in 24 hours (Stripe Checkout default).',
  ];
  if (p.propertyAddress) lines.push(`Property: ${escapeHtml(p.propertyAddress)}`);
  if (p.checkInTime) lines.push(`Check-in time: ${escapeHtml(p.checkInTime)}`);
  if (p.houseRulesUrl) {
    lines.push(
      `House rules: <a href="${escapeHtml(p.houseRulesUrl)}">${escapeHtml(p.houseRulesUrl)}</a>`,
    );
  }
  return {
    ...wrap('Complete your reservation — payment link inside', lines),
    subject: 'Complete your reservation — payment link inside',
  };
}

export interface BookingConfirmedPayload {
  bookingId: string;
  chargeId: string;
  guestName?: string;
  checkIn?: string;
  checkOut?: string;
  numNights?: number;
  totalPaid?: number;
  amount?: number;
  propertyName?: string;
  propertyAddress?: string;
  checkInTime?: string;
  houseRulesUrl?: string;
}

// M11: confirmation email expanded to be a guest-usable trip card —
// dates, address, check-in time, and a link to house rules.
export function bookingConfirmed(p: BookingConfirmedPayload): RenderedEmail {
  const property = p.propertyName ?? "The Owl's Nest";
  const subject = p.checkIn
    ? `Your reservation at The Owl's Nest is confirmed — ${p.checkIn}`
    : "Your reservation at The Owl's Nest is confirmed";
  const lines = [`Hi ${escapeHtml(p.guestName ?? 'there')},`];
  if (p.checkIn && p.checkOut) {
    const nights =
      p.numNights != null
        ? ` (${p.numNights} night${p.numNights === 1 ? '' : 's'})`
        : '';
    lines.push(
      `Your reservation at ${escapeHtml(property)} for ${escapeHtml(dateRange(p.checkIn, p.checkOut))}${nights} is confirmed.`,
    );
  } else {
    lines.push(
      `Your payment was received and your reservation at ${escapeHtml(property)} is confirmed.`,
    );
  }
  const total = p.totalPaid ?? p.amount;
  if (total != null) lines.push(`Total paid: ${fmtMoney(total)}`);
  if (p.propertyAddress) lines.push(`Property: ${escapeHtml(p.propertyAddress)}`);
  if (p.checkInTime) lines.push(`Check-in time: ${escapeHtml(p.checkInTime)}`);
  if (p.houseRulesUrl) {
    lines.push(
      `Please review the house rules before arrival: <a href="${escapeHtml(p.houseRulesUrl)}">${escapeHtml(p.houseRulesUrl)}</a>`,
    );
  }
  lines.push(`Booking ID: <code>${escapeHtml(p.bookingId)}</code>`);
  return { ...wrap(subject, lines), subject };
}

export interface BookingDeclinedPayload {
  bookingId: string;
  guestName?: string;
  reason?: string | null;
}

export function bookingDeclined(p: BookingDeclinedPayload): RenderedEmail {
  return wrap('Booking request declined', [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    'Unfortunately we are unable to accept your booking request at this time.',
    p.reason ? `Reason: ${escapeHtml(p.reason)}` : 'Please reach out if you have questions.',
  ]);
}

export interface BookingCancelledPayload {
  bookingId: string;
  guestName?: string;
  refundAmount?: number;
  reason?: string | null;
  tier?: string;
}

export function bookingCancelled(p: BookingCancelledPayload): RenderedEmail {
  const refundLine =
    p.refundAmount && p.refundAmount > 0
      ? `A refund of ${fmtMoney(p.refundAmount)} will be issued to your original payment method.`
      : 'No refund applies under the cancellation policy.';
  return wrap('Booking cancelled', [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    'Your booking has been cancelled.',
    refundLine,
    p.reason ? `Reason: ${escapeHtml(p.reason)}` : '',
  ].filter(Boolean));
}

export interface BookingDatesModifiedPayload {
  bookingId: string;
  guestName?: string;
  oldRange?: { checkIn: string; checkOut: string };
  newRange: { checkIn: string; checkOut: string };
  delta?: number;
  direction?: 'increase' | 'decrease' | 'unchanged';
}

export function bookingDatesModified(
  p: BookingDatesModifiedPayload,
): RenderedEmail {
  const movePart = p.oldRange
    ? `from ${escapeHtml(dateRange(p.oldRange.checkIn, p.oldRange.checkOut))} to ${escapeHtml(dateRange(p.newRange.checkIn, p.newRange.checkOut))}`
    : `to ${escapeHtml(dateRange(p.newRange.checkIn, p.newRange.checkOut))}`;
  const deltaLine =
    p.direction === 'increase' && p.delta
      ? `An additional ${fmtMoney(p.delta)} will be charged separately.`
      : p.direction === 'decrease' && p.delta
        ? `${fmtMoney(p.delta)} has been refunded to your original payment method.`
        : 'No change in price.';
  return wrap('Booking dates updated', [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    `Your booking dates have been updated ${movePart}.`,
    deltaLine,
  ]);
}

export interface BookingAdHocChargePayload {
  bookingId: string;
  chargeId: string;
  guestName?: string;
  kind: string;
  amount: number;
  description?: string;
  checkoutUrl: string;
}

export function bookingAdHocChargeSent(
  p: BookingAdHocChargePayload,
): RenderedEmail {
  return wrap(`Payment request — ${p.kind}`, [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    `A ${escapeHtml(p.kind)} charge of ${fmtMoney(p.amount)} has been added to your booking.`,
    p.description ? `Detail: ${escapeHtml(p.description)}` : '',
    `<a href="${escapeHtml(p.checkoutUrl)}">Pay securely with Stripe</a>`,
  ].filter(Boolean));
}

export interface BookingChargeRefundedPayload {
  bookingId: string;
  chargeId: string;
  guestName?: string;
  amount: number;
  reason?: string | null;
}

export function bookingChargeRefunded(
  p: BookingChargeRefundedPayload,
): RenderedEmail {
  return wrap('Refund issued', [
    `Hi ${escapeHtml(p.guestName ?? 'there')},`,
    `A refund of ${fmtMoney(p.amount)} has been issued to your original payment method.`,
    p.reason ? `Reason: ${escapeHtml(p.reason)}` : '',
  ].filter(Boolean));
}

// ---------- admin notifications (M9 webhooks) ----------

export interface AdminPaymentFailedPayload {
  bookingId?: string;
  chargeId?: string;
  paymentIntentId?: string;
  reason?: string | null;
}

export function adminPaymentFailed(
  p: AdminPaymentFailedPayload,
): RenderedEmail {
  return wrap('Stripe payment failed', [
    `Stripe reported a payment failure${p.bookingId ? ` for booking ${escapeHtml(p.bookingId)}` : ''}.`,
    p.reason ? `Reason: ${escapeHtml(p.reason)}` : 'No reason provided.',
    p.paymentIntentId ? `PaymentIntent: <code>${escapeHtml(p.paymentIntentId)}</code>` : '',
  ].filter(Boolean));
}

export interface AdminDisputeOpenedPayload {
  bookingId?: string;
  chargeId?: string;
  paymentIntentId?: string;
  disputeReason?: string;
  amount?: number;
}

export function adminDisputeOpened(
  p: AdminDisputeOpenedPayload,
): RenderedEmail {
  return wrap('Stripe dispute opened', [
    `A dispute was opened${p.amount ? ` for ${fmtMoney(p.amount)}` : ''}${p.bookingId ? ` against booking ${escapeHtml(p.bookingId)}` : ''}.`,
    p.disputeReason ? `Reason: ${escapeHtml(p.disputeReason)}` : '',
    'Action required — review the dispute in the Stripe dashboard and respond before the deadline.',
  ].filter(Boolean));
}

export interface AdminDisputeClosedPayload {
  bookingId?: string;
  chargeId?: string;
  status?: string;
}

export function adminDisputeClosed(
  p: AdminDisputeClosedPayload,
): RenderedEmail {
  return wrap('Stripe dispute closed', [
    `A dispute${p.bookingId ? ` against booking ${escapeHtml(p.bookingId)}` : ''} has been closed${p.status ? ` with status ${escapeHtml(p.status)}` : ''}.`,
  ]);
}

export interface AdminChargeRefundedExternallyPayload {
  bookingId?: string;
  chargeId?: string;
  amount?: number;
}

export function adminChargeRefundedExternally(
  p: AdminChargeRefundedExternallyPayload,
): RenderedEmail {
  return wrap('Refund issued via Stripe dashboard', [
    `A refund${p.amount ? ` of ${fmtMoney(p.amount)}` : ''} was issued outside the app${p.bookingId ? ` for booking ${escapeHtml(p.bookingId)}` : ''}.`,
    'The booking record has been updated automatically.',
  ]);
}
