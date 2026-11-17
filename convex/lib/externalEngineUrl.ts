import { ConvexError } from "convex/values";

export type InvalidEngineUrl = {
  code: "invalid_url";
  message: string;
};

const PRIVATE_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"] as const;

function invalid(message: string): ConvexError<InvalidEngineUrl> {
  return new ConvexError<InvalidEngineUrl>({ code: "invalid_url", message });
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIpv6(host: string): boolean {
  const bare = host.slice(1, -1);
  // The URL parser rewrites an IPv4-mapped address to hex groups (::ffff:7f00:1).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  return bare === "::" || bare === "::1" || /^f[cd]/.test(bare) || /^fe[89ab]/.test(bare);
}

/**
 * The engine address to store, or a `ConvexError<InvalidEngineUrl>`.
 *
 * Every Convex call to an engine authenticates with the instance's stored
 * credentials at this address, so it must be an https site on the public
 * internet: no embedded credentials, no loopback, private or link-local
 * hosts. A public name that resolves to a private address is not caught here;
 * that needs a check at connect time.
 */
export function validateExternalEngineUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw invalid("Enter the full engine address, starting with https://");
  }
  if (parsed.protocol !== "https:") {
    throw invalid("The engine address must start with https://");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw invalid("The engine address can't contain a username or password");
  }
  const host = parsed.hostname;
  const isIpv6 = host.startsWith("[");
  const isIpv4 = /^\d+\.\d+\.\d+\.\d+$/.test(host);
  const isPrivate =
    host === "localhost" ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    (!host.includes(".") && !isIpv6) ||
    (isIpv4 && isPrivateIpv4(host)) ||
    (isIpv6 && isPrivateIpv6(host));
  if (isPrivate) {
    throw invalid("The engine address must be a public host, not a local or private network address");
  }
  return trimmed;
}
