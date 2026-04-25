import { useQuery } from '@tanstack/react-query';
import { Navigate, useLocation } from 'react-router-dom';
import { authApi, ApiError, type SessionUser } from '../lib/api';
import type { ReactNode } from 'react';

export interface AuthState {
  user: SessionUser | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const q = useQuery({
    queryKey: ['whoami'],
    queryFn: () => authApi.whoami(),
    retry: (failureCount, error) => {
      if (error instanceof ApiError && error.status === 401) return false;
      return failureCount < 2;
    },
    staleTime: 60_000,
  });

  if (q.isPending) return { user: null, loading: true };
  if (q.error) return { user: null, loading: false };
  return { user: q.data?.user ?? null, loading: false };
}

export function AuthBoundary({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p>Loading…</p>
      </main>
    );
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}
