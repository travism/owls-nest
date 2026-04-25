import { doubleCsrf } from 'csrf-csrf';

export function buildCsrf(secret: string, isProd: boolean) {
  return doubleCsrf({
    getSecret: () => secret,
    getSessionIdentifier: (req) => (req as any).session?.id ?? '',
    cookieName: isProd ? '__Host-csrf-token' : 'x-csrf-token',
    cookieOptions: {
      sameSite: isProd ? 'strict' : 'lax',
      path: '/',
      secure: isProd,
      httpOnly: false, // intentionally readable by JS for double-submit
    },
    size: 64,
    getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token'] as string | undefined,
  });
}
