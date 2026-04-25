import { Injectable } from '@nestjs/common';
import { generateSecret, verify, generateURI } from 'otplib';
import * as crypto from 'crypto';
import * as qrcode from 'qrcode';

const ALG = 'aes-256-gcm';
const ISSUER = "The Owl's Nest";

@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor() {
    const k = process.env.ADMIN_TOTP_KEY ?? '';
    // Dev fallback: derive a stable key from a placeholder. NOT secure;
    // production env validation requires ADMIN_TOTP_KEY to be set.
    this.key =
      k.length >= 32
        ? crypto.createHash('sha256').update(k).digest()
        : crypto.createHash('sha256').update('dev-only-totp-key-placeholder').digest();
  }

  generateSecret(): string {
    return generateSecret({ length: 20 });
  }

  encrypt(plaintextSecret: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALG, this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintextSecret, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(blob: string): string {
    const [ivB64, tagB64, encB64] = blob.split(':');
    if (!ivB64 || !tagB64 || !encB64) throw new Error('Malformed TOTP blob');
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const decipher = crypto.createDecipheriv(ALG, this.key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  }

  async verify(plaintextSecret: string, code: string): Promise<boolean> {
    if (!/^\d{6}$/.test(code)) return false;
    // 30s epoch tolerance = ±1 step window for clock drift.
    const result = await verify({
      secret: plaintextSecret,
      token: code,
      epochTolerance: 30,
    });
    return result?.valid === true;
  }

  /**
   * Build the otpauth:// URI used by authenticator apps.
   */
  otpauthUrl(account: string, secret: string): string {
    return generateURI({ secret, label: account, issuer: ISSUER });
  }

  /**
   * Render the otpauth URI as a base64 PNG QR code data-URI for inline display.
   */
  async qrDataUrl(otpauth: string): Promise<string> {
    return qrcode.toDataURL(otpauth, { errorCorrectionLevel: 'M', margin: 1 });
  }

  /**
   * Generate N recovery codes formatted as XXXX-XXXX-XXXX (Crockford-style base32).
   */
  generateRecoveryCodes(count = 10): string[] {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const groups: string[] = [];
      for (let g = 0; g < 3; g++) {
        let group = '';
        for (let c = 0; c < 4; c++) {
          group += alphabet[crypto.randomInt(0, alphabet.length)];
        }
        groups.push(group);
      }
      codes.push(groups.join('-'));
    }
    return codes;
  }
}
