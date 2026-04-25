// Shared test render helper that wraps components in the providers
// they need at runtime: TanStack Query + React Router.

import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export function renderWithProviders(
  ui: ReactNode,
  opts?: { route?: string },
): RenderResult {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[opts?.route ?? '/']}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}
