import { formatDistanceToNow } from "date-fns";

export interface MacroTriggerExample {
  id: string;
  label: string;
  /** What to paste or type, verbatim. */
  text: string;
}

export interface MacroTriggerTarget {
  /** The bare endpoint, for requests that carry the token in a header. */
  endpoint: string;
  /** Endpoint plus token, for devices that cannot set a header. */
  url: string;
  token: string;
}

/** Placeholder value shown for a variable, so the example reads as "put yours here". */
function sampleValue(name: string): string {
  return `<${name}>`;
}

function sampleBody(variables: readonly string[]): string {
  const body: Record<string, string> = {};
  for (const name of variables) {
    body[name] = sampleValue(name);
  }
  return JSON.stringify(body);
}

function withQuery(url: string, variables: readonly string[]): string {
  if (variables.length === 0) {
    return url;
  }
  const query = variables.map((name) => `${encodeURIComponent(name)}=${sampleValue(name)}`).join("&");
  return `${url}?${query}`;
}

/** Single-quote for a POSIX shell, so a sample value with spaces or `$` survives. */
function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Ready-to-paste setups for the devices streamers drive a show from. Every
 * device that can set a header gets the header form, which keeps the token
 * out of the URL (and so out of request logs and history); only the Stream
 * Deck's built-in Website action, which can do nothing but open a URL, uses
 * the token-in-path form, and only when the trigger accepts GET.
 */
export function macroTriggerExamples(
  target: MacroTriggerTarget,
  variables: readonly string[],
  allowGet: boolean
): MacroTriggerExample[] {
  const hasVariables = variables.length > 0;
  const body = sampleBody(variables);
  const authorization = `Authorization: Bearer ${target.token}`;
  const examples: MacroTriggerExample[] = [];

  examples.push({
    id: "curl",
    label: "curl",
    text: [
      `curl -X POST ${shellQuote(target.endpoint)}`,
      `-H ${shellQuote(authorization)}`,
      ...(hasVariables ? ["-H 'Content-Type: application/json'", `-d ${shellQuote(body)}`] : []),
    ].join(" "),
  });

  examples.push({
    id: "stream-deck-plugin",
    label: "Stream Deck (API Ninja / Web Requests)",
    text: [
      "Method: POST",
      `URL: ${target.endpoint}`,
      `Header: ${authorization}`,
      ...(hasVariables ? ["Content-Type: application/json", `Body: ${body}`] : []),
    ].join("\n"),
  });

  examples.push({
    id: "companion",
    label: "Bitfocus Companion",
    text: [
      "Connection: Generic HTTP Requests",
      "Action: POST",
      `URL: ${target.endpoint}`,
      `Header: ${JSON.stringify({ Authorization: `Bearer ${target.token}` })}`,
      ...(hasVariables ? ["Content-Type: application/json", `Body: ${body}`] : []),
    ].join("\n"),
  });

  if (allowGet) {
    examples.push({
      id: "stream-deck-website",
      label: "Stream Deck (built-in Website action)",
      text: [`URL: ${withQuery(target.url, variables)}`, 'Tick "GET request in background"'].join("\n"),
    });
  }

  return examples;
}

export interface MacroTriggerStatus {
  lastUsedAt?: number;
  useCount: number;
  lastFailedAt?: number;
  needsConfirmation: boolean;
}

/** "Enabled · last used 3 minutes ago · 4 uses", as the pad and the editor show it. */
export function macroTriggerStatusLabel(trigger: MacroTriggerStatus): string {
  if (trigger.needsConfirmation) {
    return "Paused · an owner or admin must re-confirm it";
  }
  const parts = ["Enabled"];
  if (trigger.lastUsedAt === undefined) {
    parts.push("never used");
  } else {
    parts.push(`last used ${formatDistanceToNow(trigger.lastUsedAt, { addSuffix: true })}`);
    parts.push(trigger.useCount === 1 ? "1 use" : `${trigger.useCount} uses`);
  }
  if (trigger.lastFailedAt !== undefined && trigger.lastFailedAt > (trigger.lastUsedAt ?? 0)) {
    parts.push(`last press failed ${formatDistanceToNow(trigger.lastFailedAt, { addSuffix: true })}`);
  }
  return parts.join(" · ");
}
