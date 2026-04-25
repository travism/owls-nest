import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../lib/api';
import { useAuth } from '../auth/AuthBoundary';

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

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
      <p className="muted">Booking management, cleaner roster, messaging, etc. land in M3 onward.</p>
      <nav>
        <button className="secondary" onClick={() => logout.mutate()} disabled={logout.isPending}>
          {logout.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </nav>
    </main>
  );
}
