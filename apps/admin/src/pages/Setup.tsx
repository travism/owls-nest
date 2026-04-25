import { useState, useId } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, ApiError } from '../lib/api';

type Step = 'password' | 'totp' | 'recovery';

export function SetupPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const emailId = useId();
  const passwordId = useId();
  const codeId = useId();

  const initial = (location.state as { email?: string; password?: string } | null) ?? {};
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState(initial.email ?? 'admin@owlsnest.local');
  const [password, setPassword] = useState(initial.password ?? '');
  const [confirmPassword, setConfirmPassword] = useState(initial.password ?? '');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Set after successful password step
  const [otpauthUrl, setOtpauthUrl] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  // Set after successful TOTP step
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await authApi.setup(email, password);
      setOtpauthUrl(result.otpauthUrl);
      setQrDataUrl(result.qrDataUrl);
      setSetupToken(result.setupToken);
      setStep('totp');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message ?? 'Setup failed.');
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!setupToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.setupVerify(setupToken, totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setStep('recovery');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message ?? 'Invalid code.');
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    await queryClient.invalidateQueries({ queryKey: ['whoami'] });
    navigate('/login');
  }

  if (step === 'password') {
    return (
      <main>
        <h1>First-time setup</h1>
        <p className="muted">Set a password and enroll a TOTP authenticator.</p>
        <form onSubmit={submitPassword}>
          <label htmlFor={emailId}>
            <span>Email</span>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
            />
          </label>
          <label htmlFor={passwordId}>
            <span>Password (min 12 characters)</span>
            <input
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          <label htmlFor={`${passwordId}-confirm`}>
            <span>Confirm password</span>
            <input
              id={`${passwordId}-confirm`}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={12}
              autoComplete="new-password"
            />
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </button>
        </form>
      </main>
    );
  }

  if (step === 'totp') {
    return (
      <main>
        <h1>Enroll authenticator</h1>
        <p className="muted">
          Scan this QR code with Google Authenticator, 1Password, Authy, or any TOTP app,
          then enter the 6-digit code shown.
        </p>
        {qrDataUrl && <img src={qrDataUrl} alt="TOTP QR code" className="qr" />}
        {otpauthUrl && (
          <p className="muted" style={{ wordBreak: 'break-all', fontSize: '0.75rem' }}>
            Or enter manually: <code>{otpauthUrl}</code>
          </p>
        )}
        <form onSubmit={submitTotp}>
          <label htmlFor={codeId}>
            <span>Verification code</span>
            <input
              id={codeId}
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoFocus
              autoComplete="one-time-code"
            />
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button type="submit" disabled={submitting || totpCode.length !== 6}>
            {submitting ? 'Verifying…' : 'Verify and continue'}
          </button>
        </form>
      </main>
    );
  }

  // step === 'recovery'
  return (
    <main>
      <h1>Save your recovery codes</h1>
      <p>
        These ten codes can be used to sign in if you lose access to your authenticator.
        Each code works only once. <strong>Save them now</strong> — they will not be shown again.
      </p>
      <pre className="recovery-codes">{recoveryCodes.join('\n')}</pre>
      <button onClick={finish}>I've saved them — continue to sign in</button>
    </main>
  );
}
