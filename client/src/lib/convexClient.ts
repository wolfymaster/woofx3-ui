import { ConvexReactClient } from "convex/react";

// Shared Convex client instance. App.tsx uses it via ConvexProvider for
// hooks (useQuery/useMutation/useAction); a module that needs to call Convex
// imperatively, from outside a React component, imports this directly instead.
export const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
