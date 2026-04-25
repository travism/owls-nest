import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes and verifies a password', async () => {
    const plain = 'correct-horse-battery-staple';
    const hash = await svc.hash(plain);
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(hash, plain)).toBe(true);
    expect(await svc.verify(hash, 'wrong-password')).toBe(false);
  });

  it('rejects the placeholder password', async () => {
    expect(await svc.verify('PLACEHOLDER-MUST-RESET', 'anything')).toBe(false);
  });

  it('returns false on malformed hash', async () => {
    expect(await svc.verify('not-a-real-hash', 'whatever')).toBe(false);
  });

  it('returns false on empty hash', async () => {
    expect(await svc.verify('', 'whatever')).toBe(false);
  });
});
