import { TotpService } from './totp.service';
import { generate } from 'otplib';

describe('TotpService', () => {
  const svc = new TotpService();

  it('generates a secret', () => {
    const s = svc.generateSecret();
    expect(s).toMatch(/^[A-Z2-7]+$/); // base32
    expect(s.length).toBeGreaterThanOrEqual(16);
  });

  it('round-trips encrypt/decrypt', () => {
    const secret = svc.generateSecret();
    const blob = svc.encrypt(secret);
    expect(blob).not.toContain(secret);
    expect(svc.decrypt(blob)).toBe(secret);
  });

  it('produces different blobs for the same plaintext (random IV)', () => {
    const secret = svc.generateSecret();
    expect(svc.encrypt(secret)).not.toBe(svc.encrypt(secret));
  });

  it('verifies a freshly-generated TOTP code', async () => {
    const secret = svc.generateSecret();
    const code = await generate({ secret });
    expect(await svc.verify(secret, code)).toBe(true);
  });

  it('rejects an invalid TOTP code', async () => {
    const secret = svc.generateSecret();
    expect(await svc.verify(secret, '000000')).toBe(false);
  });

  it('rejects malformed codes (non-6-digit)', async () => {
    const secret = svc.generateSecret();
    expect(await svc.verify(secret, '12345')).toBe(false);
    expect(await svc.verify(secret, '1234567')).toBe(false);
    expect(await svc.verify(secret, 'abcdef')).toBe(false);
  });

  it('builds a valid otpauth URL', () => {
    const secret = svc.generateSecret();
    const url = svc.otpauthUrl('admin@owlsnest.local', secret);
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain('issuer=The%20Owl');
  });

  it('produces a QR data URL', async () => {
    const url = svc.otpauthUrl('a@b.c', svc.generateSecret());
    const dataUrl = await svc.qrDataUrl(url);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('generates 10 unique recovery codes by default', () => {
    const codes = svc.generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});
