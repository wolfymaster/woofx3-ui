import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

// Register Convex Auth HTTP endpoints (OAuth callbacks, etc.)
// Twitch OAuth callback URL: https://<deployment>.convex.site/api/auth/callback/twitch
auth.addHttpRoutes(http);

export default http;
