import { useState, useId } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { authApi, ApiError } from '../lib/api';

export function RecoveryPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const codeId = useId();

  const state = location.state as { challengeToken?: string } | null;
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
      await authApi.recovery(challengeToken!, code.trim().toUpperCase());
      await queryClient.invalidateQueries({ queryKey: ['whoami'] });
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message ?? 'Invalid recovery code.');
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Recovery code</h1>
      <p className="muted">
        Enter one of the recovery codes generated when you set up your account.
        Each code can be used only once.
      </p>
      <form onSubmit={onSubmit}>
        <label htmlFor={codeId}>
          <span>Recovery code</span>
          <input
            id={codeId}
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX"
            required
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Verifying…' : 'Verify'}
        </button>
      </form>
      <nav>
        <Link to="/login">Back to sign in</Link>
      </nav>
    </main>
  );
}
