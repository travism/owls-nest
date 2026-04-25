import { useState, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, ApiError } from '../lib/api';

export function LoginPage() {
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('admin@owlsnest.local');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await authApi.login(email, password);
      navigate('/login/totp', {
        state: { challengeToken: result.challengeToken, email },
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'CONFLICT') {
          // First-time setup needed
          navigate('/setup', { state: { email, password } });
          return;
        }
        if (err.code === 'FORBIDDEN') {
          setError(err.message ?? 'Account locked.');
          return;
        }
        setError('Invalid email or password.');
      } else {
        setError('Could not reach the server.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>Admin sign in</h1>
      <form onSubmit={onSubmit}>
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
          <span>Password</span>
          <input
            id={passwordId}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
