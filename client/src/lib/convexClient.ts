import { ConvexReactClient } from "convex/react";

// Shared Convex client instance. App.tsx uses it via ConvexProvider for
// hooks (useQuery/useMutation/useAction); non-component modules that need
// to call Convex imperatively (e.g. client/src/lib/platforms/twitch-client.ts,
// which isn't a React component) import this directly instead.
export const convexClient = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
