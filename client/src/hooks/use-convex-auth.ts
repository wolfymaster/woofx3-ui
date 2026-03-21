import { useConvexAuth, useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { api } from '@convex/_generated/api';

export function useConvexUser() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.getMe);
  return { isAuthenticated, isLoading, user };
}

export { useAuthActions };
