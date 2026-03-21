import { useConvexAuth } from 'convex/react';

export function useAppInit() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return {
    isLoading,
    error: null,
    isInitialized: isAuthenticated,
  };
}
