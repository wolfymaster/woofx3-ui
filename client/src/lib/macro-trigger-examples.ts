import { formatDistanceToNow } from "date-fns";

export interface MacroTriggerExample {
  id: string;
  label: string;
  /** What to paste or type, verbatim. */
  text: string;
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
 * Ready-to-paste setups for the devices streamers drive a show from. The GET
 * variants appear only when the trigger accepts GET, so nothing here suggests
 * a request the route would refuse.
 */
export function macroTriggerExamples(
  url: string,
  variables: readonly string[],
  allowGet: boolean
): MacroTriggerExample[] {
  const hasVariables = variables.length > 0;
  const body = sampleBody(variables);
  const examples: MacroTriggerExample[] = [];

  examples.push({
    id: "curl",
    label: "curl",
    text: hasVariables
      ? `curl -X POST ${shellQuote(url)} -H 'Content-Type: application/json' -d ${shellQuote(body)}`
      : `curl -X POST ${shellQuote(url)}`,
  });

  examples.push({
    id: "stream-deck-plugin",
    label: "Stream Deck (API Ninja / Web Requests)",
    text: [
      "Method: POST",
      `URL: ${url}`,
      ...(hasVariables ? ["Content-Type: application/json", `Body: ${body}`] : []),
    ].join("\n"),
  });

  examples.push({
    id: "companion",
    label: "Bitfocus Companion",
    text: [
      "Connection: Generic HTTP Requests",
      "Action: POST",
      `URL: ${url}`,
      ...(hasVariables ? ["Header: Content-Type: application/json", `Body: ${body}`] : []),
    ].join("\n"),
  });

  if (allowGet) {
    examples.push({
      id: "stream-deck-website",
      label: "Stream Deck (built-in Website action)",
      text: [`URL: ${withQuery(url, variables)}`, 'Check "GET request in background"'].join("\n"),
    });
  }

  return examples;
}

/** "Enabled · last used 3 minutes ago", as the pad and the editor show it. */
export function macroTriggerStatusLabel(trigger: { lastUsedAt?: number; useCount: number }): string {
  if (trigger.lastUsedAt === undefined) {
    return "Enabled · never used";
  }
  const when = formatDistanceToNow(trigger.lastUsedAt, { addSuffix: true });
  const uses = trigger.useCount === 1 ? "1 use" : `${trigger.useCount} uses`;
  return `Enabled · last used ${when} · ${uses}`;
}
