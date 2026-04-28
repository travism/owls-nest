// Template render unit tests. The drain depends on these emitting a
// well-formed { subject, html, text } shape; smoke-test each one.

import {
  inquiryReceived,
  inquiryAcknowledged,
  bookingPaymentLink,
  bookingConfirmed,
  bookingDeclined,
  bookingCancelled,
  bookingDatesModified,
  bookingAdHocChargeSent,
  bookingChargeRefunded,
  adminPaymentFailed,
  adminDisputeOpened,
  adminDisputeClosed,
  adminChargeRefundedExternally,
} from './index';

describe('email templates', () => {
  it('inquiryReceived renders all fields', () => {
    const r = inquiryReceived({
      inquiryId: 'inq-1',
      guestName: 'Jane Smith',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      message: 'Pet friendly?',
    });
    expect(r.subject).toMatch(/inquiry/i);
    expect(r.html).toContain('Jane Smith');
    expect(r.html).toContain('2026-07-15');
    expect(r.html).toContain('Pet friendly');
    expect(r.text).toContain('Jane Smith');
  });

  it('inquiryAcknowledged greets the guest', () => {
    const r = inquiryAcknowledged({
      inquiryId: 'inq-1',
      guestName: 'Jane',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
    });
    expect(r.html).toContain('Jane');
    expect(r.subject).toMatch(/received/i);
  });

  it('bookingPaymentLink includes the checkout URL', () => {
    const r = bookingPaymentLink({
      bookingId: 'b1',
      chargeId: 'c1',
      guestName: 'Jane',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      amount: 663,
      checkoutUrl: 'https://checkout.stripe.com/abc',
    });
    expect(r.html).toContain('https://checkout.stripe.com/abc');
    expect(r.html).toContain('$663.00');
  });

  it('bookingConfirmed includes booking id', () => {
    const r = bookingConfirmed({ bookingId: 'b1', chargeId: 'c1', guestName: 'Jane' });
    expect(r.subject).toMatch(/confirmed/i);
    expect(r.html).toContain('b1');
  });

  it('bookingDeclined renders reason when present', () => {
    const r = bookingDeclined({ bookingId: 'b1', guestName: 'Jane', reason: 'sold out' });
    expect(r.html).toContain('sold out');
  });

  it('bookingCancelled describes refund', () => {
    const r = bookingCancelled({
      bookingId: 'b1',
      guestName: 'Jane',
      refundAmount: 100,
      tier: '14-day:50%',
    });
    expect(r.html).toContain('$100.00');
  });

  it('bookingCancelled handles zero refund', () => {
    const r = bookingCancelled({
      bookingId: 'b1',
      guestName: 'Jane',
      refundAmount: 0,
    });
    expect(r.html.toLowerCase()).toContain('no refund');
  });

  it('bookingDatesModified handles increase / decrease', () => {
    const inc = bookingDatesModified({
      bookingId: 'b1',
      newRange: { checkIn: '2026-07-15', checkOut: '2026-07-20' },
      delta: 350,
      direction: 'increase',
    });
    expect(inc.html).toContain('$350.00');
    const dec = bookingDatesModified({
      bookingId: 'b1',
      newRange: { checkIn: '2026-07-15', checkOut: '2026-07-17' },
      delta: 175,
      direction: 'decrease',
    });
    expect(dec.html).toMatch(/refunded/i);
  });

  it('bookingAdHocChargeSent renders kind + url', () => {
    const r = bookingAdHocChargeSent({
      bookingId: 'b1',
      chargeId: 'c2',
      kind: 'damage',
      amount: 200,
      description: 'broken lamp',
      checkoutUrl: 'https://stripe.test/x',
    });
    expect(r.subject).toContain('damage');
    expect(r.html).toContain('broken lamp');
    expect(r.html).toContain('stripe.test/x');
  });

  it('bookingChargeRefunded shows amount', () => {
    const r = bookingChargeRefunded({
      bookingId: 'b1',
      chargeId: 'c1',
      amount: 50,
      reason: 'goodwill',
    });
    expect(r.html).toContain('$50.00');
    expect(r.html).toContain('goodwill');
  });

  it('adminPaymentFailed includes reason', () => {
    const r = adminPaymentFailed({
      bookingId: 'b1',
      paymentIntentId: 'pi_x',
      reason: 'card_declined',
    });
    expect(r.html).toContain('card_declined');
    expect(r.html).toContain('pi_x');
  });

  it('adminDisputeOpened includes reason', () => {
    const r = adminDisputeOpened({
      bookingId: 'b1',
      paymentIntentId: 'pi_x',
      disputeReason: 'fraudulent',
      amount: 663,
    });
    expect(r.html).toContain('fraudulent');
    expect(r.html).toContain('$663.00');
  });

  it('adminDisputeClosed includes status', () => {
    const r = adminDisputeClosed({ bookingId: 'b1', status: 'won' });
    expect(r.html).toContain('won');
  });

  it('adminChargeRefundedExternally includes amount', () => {
    const r = adminChargeRefundedExternally({
      bookingId: 'b1',
      amount: 100,
    });
    expect(r.html).toContain('$100.00');
  });

  it('escapes HTML in untrusted input', () => {
    const r = inquiryReceived({
      inquiryId: 'inq-1',
      guestName: '<script>alert(1)</script>',
      checkIn: '2026-07-15',
      checkOut: '2026-07-18',
      message: '<img src=x onerror=alert(1)>',
    });
    expect(r.html).not.toContain('<script>');
    // The escaped form `&lt;img src=x onerror=alert(1)&gt;` is rendered as
    // text — angle brackets escaped so no element is created. We only assert
    // the structural escape, not the textual contents of attributes.
    expect(r.html).not.toContain('<img');
    expect(r.html).toContain('&lt;script');
    expect(r.html).toContain('&lt;img');
  });
});
