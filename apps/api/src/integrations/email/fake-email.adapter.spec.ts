// Fake adapter unit tests — confirms the in-memory recorder behaves.

import { FakeEmailAdapter } from './fake-email.adapter';

describe('FakeEmailAdapter', () => {
  it('records every send and returns a fake id', async () => {
    const fake = new FakeEmailAdapter();
    const r1 = await fake.sendEmail({
      to: 'a@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    const r2 = await fake.sendEmail({
      to: 'b@example.com',
      subject: 'hi2',
      html: '<p>hi2</p>',
      text: 'hi2',
    });
    expect(fake.sent).toHaveLength(2);
    expect(r1.provider).toBe('fake');
    expect(r1.id).toMatch(/^fake_/);
    expect(r2.id).not.toBe(r1.id);
  });

  it('reset clears the buffer', async () => {
    const fake = new FakeEmailAdapter();
    await fake.sendEmail({
      to: 'a@example.com',
      subject: 'x',
      html: 'x',
      text: 'x',
    });
    fake.reset();
    expect(fake.sent).toHaveLength(0);
  });

  it('failNextWith forces the next call to throw', async () => {
    const fake = new FakeEmailAdapter();
    fake.failNextWith = new Error('nope');
    await expect(
      fake.sendEmail({ to: 'a@x', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('nope');
    // Subsequent call succeeds (single-shot)
    await expect(
      fake.sendEmail({ to: 'a@x', subject: 's', html: 'h', text: 't' }),
    ).resolves.toBeDefined();
  });
});
