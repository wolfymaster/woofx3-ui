import type { AppLogger, Logger } from "@/lib/logger";
import { openExternalUrl } from "./host";

/**
 * Where a link click should go in the desktop app: the address to hand to the
 * system browser, or null to leave the click to the app. Only http and https
 * pages on another origin leave: the webview opens no windows of its own, so
 * without this such a click does nothing. The app's own pages stay in the
 * app even when a link asks for a new tab, since the app's origin exists only
 * inside the webview and a browser could not open it.
 */
export function externalLinkTarget(href: string, appOrigin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, appOrigin);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url.origin === appOrigin ? null : url.href;
}

/**
 * Sends every link that leaves the app, and every `window.open`, to the
 * system browser through `open`. Installed once at startup, before anything
 * renders, so no component has to know it runs in the desktop app.
 */
export function installExternalLinks(open: (url: string) => Promise<void>, logger: Logger): void {
  const openLogged = (url: string) => {
    open(url).catch((error: unknown) => {
      logger.error("Couldn't open a link in the browser", { url, error });
    });
  };

  const onClick = (event: MouseEvent) => {
    // Left and middle clicks follow links; anything already handled stays handled.
    if (event.defaultPrevented || event.button > 1) {
      return;
    }
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(anchor instanceof HTMLAnchorElement)) {
      return;
    }
    const url = externalLinkTarget(anchor.getAttribute("href") ?? "", window.location.origin);
    if (url === null) {
      return;
    }
    event.preventDefault();
    openLogged(url);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);

  window.open = (url?: string | URL) => {
    const target = url === undefined ? null : externalLinkTarget(String(url), window.location.origin);
    if (target !== null) {
      openLogged(target);
    }
    return null;
  };
}

/** Sends the desktop app's external links to the system browser through the host. */
export function installDesktopExternalLinks(logger: AppLogger): void {
  installExternalLinks(openExternalUrl, logger.scoped("external-links"));
}
