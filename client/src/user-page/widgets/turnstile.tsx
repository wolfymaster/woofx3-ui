import { useEffect, useRef, useState } from "react";

/** The part of Cloudflare's widget script this page uses. */
export interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      "error-callback": () => void;
    }
  ): string;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Adds Cloudflare's script to the document on first use. Every form on the page
 * shares the one tag, so a later caller waits on the tag already there.
 */
export function loadTurnstileScript(): Promise<TurnstileApi> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (script === null) {
      script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
    script.addEventListener("load", () => {
      if (window.turnstile) {
        resolve(window.turnstile);
      } else {
        reject(new Error("The Turnstile script loaded without defining its API"));
      }
    });
    script.addEventListener("error", () => reject(new Error("The Turnstile script did not load")));
  });
}

/**
 * The visitor check an anonymous submit carries. A token works once, so the
 * form remounts this after every send that was not accepted, for a fresh one.
 */
export function TurnstileChallenge({
  siteKey,
  load,
  onToken,
}: {
  siteKey: string;
  load: () => Promise<TurnstileApi>;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    let rendered: { api: TurnstileApi; widgetId: string } | null = null;
    load()
      .then((api) => {
        if (!live || container.current === null) {
          return;
        }
        rendered = {
          api,
          widgetId: api.render(container.current, {
            sitekey: siteKey,
            callback: (token) => onToken(token),
            "expired-callback": () => onToken(null),
            "error-callback": () => {
              onToken(null);
              setFailed(true);
            },
          }),
        };
      })
      .catch((error: unknown) => {
        console.warn("The visitor check could not start", error);
        setFailed(true);
      });
    return () => {
      live = false;
      rendered?.api.remove(rendered.widgetId);
    };
  }, [siteKey, load, onToken]);

  return (
    <div>
      <div ref={container} data-testid="turnstile-challenge" />
      {failed && (
        <p className="mt-1 text-sm text-muted">
          The check that confirms you're a person didn't load. Reload the page to try again.
        </p>
      )}
    </div>
  );
}
