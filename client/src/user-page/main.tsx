import { ConvexProvider, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { UserPageApp } from "./app";
import { slugFromPath } from "./slug";
import { preloadMarkdown } from "./widgets/text-widget";
import "./styles.css";

// No auth provider: a visitor is anonymous, and everything the page reads is public.
const convexUrl: unknown = import.meta.env.VITE_CONVEX_URL;
if (typeof convexUrl !== "string" || convexUrl === "") {
  throw new Error("VITE_CONVEX_URL must be set to build the user page");
}
const root = document.getElementById("root");
if (root === null) {
  throw new Error("The user page's HTML has no #root element");
}

preloadMarkdown();
const slug = slugFromPath(window.location.pathname, import.meta.env.BASE_URL);
createRoot(root).render(
  <StrictMode>
    <ConvexProvider client={new ConvexReactClient(convexUrl)}>
      <UserPageApp slug={slug} />
    </ConvexProvider>
  </StrictMode>
);
