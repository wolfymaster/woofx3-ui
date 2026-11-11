// Which engine each purchase checkout was opened on, kept in the browser.
//
// Billing's payment page returns to the listing with only the checkout id, so
// a browser that switched engines while paying would come back on the wrong
// one, whose organization does not know the checkout. The id of the engine
// that opened it is remembered here and selected again on the return. It is a
// convenience: storage may be missing, full or blocked, so every access is
// guarded and the page works without it, on the engine currently selected.

const STORAGE_KEY = "woofx3.purchaseEngines";

/** Kept for the newest checkouts only; a buyer returns from one within the hour. */
export const PURCHASE_ENGINES_KEPT = 20;

type Remembered = Record<string, { instanceId: string; at: number }>;

/** The parts of `Storage` this needs, so tests pass a plain object. */
export type PurchaseEngineStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's local storage, or null where reading it throws (blocked, private mode, no window). */
export function browserPurchaseEngineStorage(): PurchaseEngineStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Reading `localStorage` itself throws where site data is blocked: the return then stays on the current engine.
    return null;
  }
}

function read(storage: PurchaseEngineStorage): Remembered {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Remembered) : {};
  } catch {
    // Unreadable or not JSON: treated as nothing remembered, and overwritten by the next write.
    return {};
  }
}

function write(storage: PurchaseEngineStorage, remembered: Remembered): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(remembered));
  } catch {
    // Full or blocked storage: the return then stays on whichever engine is selected, which still works.
  }
}

export function rememberPurchaseEngine(
  storage: PurchaseEngineStorage | null,
  checkoutId: string,
  instanceId: string,
  now: number
): void {
  if (storage === null) {
    return;
  }
  const entries = Object.entries({ ...read(storage), [checkoutId]: { instanceId, at: now } })
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, PURCHASE_ENGINES_KEPT);
  write(storage, Object.fromEntries(entries));
}

/** The engine `checkoutId` was opened on, or null when it is not remembered. */
export function purchaseEngineOf(storage: PurchaseEngineStorage | null, checkoutId: string): string | null {
  if (storage === null) {
    return null;
  }
  const entry = read(storage)[checkoutId];
  return entry !== undefined && typeof entry.instanceId === "string" ? entry.instanceId : null;
}

export function forgetPurchaseEngine(storage: PurchaseEngineStorage | null, checkoutId: string): void {
  if (storage === null) {
    return;
  }
  const remembered = read(storage);
  if (Object.hasOwn(remembered, checkoutId)) {
    delete remembered[checkoutId];
    write(storage, remembered);
  }
}

/**
 * The engine to select for a return from `checkoutId`, or null to stay: the
 * remembered engine when the caller is still on it and it is not already
 * selected.
 */
export function engineToSelectForReturn(
  remembered: string | null,
  selected: string | null,
  memberOf: readonly string[]
): string | null {
  if (remembered === null || remembered === selected || !memberOf.includes(remembered)) {
    return null;
  }
  return remembered;
}
