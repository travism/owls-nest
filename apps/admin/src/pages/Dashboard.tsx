import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, outboxApi } from '../lib/api';
import { useAuth } from '../auth/AuthBoundary';

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // M11: surface dead-lettered notifications so the operator sees them
  // without having to navigate. Errors are silent — Outbox health is a
  // nice-to-have, not a critical-path read.
  const outboxHealth = useQuery({
    queryKey: ['outbox-health'],
    queryFn: () => outboxApi.health(),
  });

  const logout = useMutation({
    mutationFn: () => authApi.logout(),
    onSuccess: () => {
      queryClient.setQueryData(['whoami'], null);
      queryClient.invalidateQueries();
      navigate('/login');
    },
  });

  return (
    <main>
      <h1>Owl's Nest Admin</h1>
      <p>Signed in as <strong>{user?.email}</strong>.</p>

      <h2>Manage</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        <li style={{ padding: '0.5rem 0' }}>
          <Link to="/inquiries">Inquiries</Link>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            — guest dates + questions submitted from the public site
          </span>
        </li>
        <li style={{ padding: '0.5rem 0' }}>
          <Link to="/bookings">Bookings</Link>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            — converted inquiries with payment status; approve to send a Stripe link
          </span>
        </li>
        <li style={{ padding: '0.5rem 0' }}>
          <Link to="/property">Property settings</Link>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            — name, address, pricing, cancellation policy
          </span>
        </li>
        <li style={{ padding: '0.5rem 0' }}>
          <Link to="/blocked-dates">Blocked dates</Link>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            — owner stays, maintenance windows, OTA-imported blocks
          </span>
        </li>
        <li style={{ padding: '0.5rem 0' }}>
          <Link to="/outbox">Outbox health</Link>
          <span className="muted" style={{ marginLeft: '0.5rem' }}>
            — {outboxHealth.data
              ? `${outboxHealth.data.deadLettered} dead-lettered`
              : 'notifications status'}
          </span>
        </li>
      </ul>

      <p className="muted" style={{ marginTop: '1.5rem' }}>
        Cleaners, messaging, and financials land in Phase 2+.
      </p>

      <nav>
        <button className="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </nav>
    </main>
  );
}
