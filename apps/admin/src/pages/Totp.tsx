import { useState, useId } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, ApiError } from '../lib/api';

export function TotpPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const codeId = useId();

  const state = location.state as { challengeToken?: string; email?: string } | null;
  const challengeToken = state?.challengeToken;

  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!challengeToken) {
    return (
      <main>
        <h1>Session expired</h1>
        <p>Please sign in again.</p>
        <Link to="/login">Back to login</Link>
      </main>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await authApi.totp(challengeToken!, code);
      // Refresh whoami so AuthBoundary lets us in
      await queryClient.invalidateQueries({ queryKey: ['whoami'] });
      navigate('/');
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

  return (
    <main>
      <h1>Two-factor code</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app.</p>
      <form onSubmit={onSubmit}>
        <label htmlFor={codeId}>
          <span>Code</span>
          <input
            id={codeId}
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            required
            autoComplete="one-time-code"
            autoFocus
          />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={submitting || code.length !== 6}>
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <nav>
        <Link
          to="/login/recovery"
          state={{ challengeToken }}
        >
          Use a recovery code
        </Link>
      </nav>
    </main>
  );
}
