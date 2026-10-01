import { atom, computed, map } from "nanostores";

const STORAGE_KEYS = {
  sidebarCollapsed: "streamdeck-sidebar-collapsed",
  engineUrl: "streamdeck-engine-url",
  currentInstanceId: "woofx3-current-instance-id",
  commandBarHidden: "woofx3-command-bar-hidden",
  dashboardLayoutHint: "woofx3-dashboard-layout-hint",
  hideUnusedAlerts: "woofx3-hide-unused-alerts",
  paletteRecents: "woofx3-palette-recents",
};

export function getStoredValue<T>(key: string, defaultValue: T): T {
  if (typeof window === "undefined") return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

export function persistValue<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

// Currently selected woofx3 instance ID (persisted to localStorage)
const initialInstanceId = getStoredValue<string | null>(STORAGE_KEYS.currentInstanceId, null);
export const $currentInstanceId = atom<string | null>(initialInstanceId);
$currentInstanceId.subscribe((value) => persistValue(STORAGE_KEYS.currentInstanceId, value));

// Dashboard command bar visibility. Its close button hides the whole bar (not
// just decorative) — per-browser rather than per-instance, since it's a
// chrome preference, and restored from the panel tab's context menu.
const initialCommandBarHidden = getStoredValue(STORAGE_KEYS.commandBarHidden, false);
export const $commandBarHidden = atom<boolean>(initialCommandBarHidden);
$commandBarHidden.subscribe((value) => persistValue(STORAGE_KEYS.commandBarHidden, value));

// Layout of the dashboard's first panel as last seen, so the dashboard can draw
// zone outlines on load before its panels arrive. A hint only: the loaded
// panels always win.
const initialDashboardLayoutHint = getStoredValue<string | null>(STORAGE_KEYS.dashboardLayoutHint, null);
export const $dashboardLayoutHint = atom<string | null>(initialDashboardLayoutHint);
$dashboardLayoutHint.subscribe((value) => persistValue(STORAGE_KEYS.dashboardLayoutHint, value));
// Whether the Alerts rail lists only entries with a configured alert. Off by default,
// so a new user sees everything they could alert on; per-browser, like the command bar.
const initialHideUnusedAlerts = getStoredValue(STORAGE_KEYS.hideUnusedAlerts, false);
export const $hideUnusedAlerts = atom<boolean>(initialHideUnusedAlerts);
$hideUnusedAlerts.subscribe((value) => persistValue(STORAGE_KEYS.hideUnusedAlerts, value));

const initialSidebarCollapsed = getStoredValue(STORAGE_KEYS.sidebarCollapsed, false);
export const $sidebarCollapsed = atom<boolean>(initialSidebarCollapsed);
export const $sidebarWidth = atom<number>(280);

$sidebarCollapsed.subscribe((value) => persistValue(STORAGE_KEYS.sidebarCollapsed, value));

// Engine configuration
const getDefaultEngineUrl = (): string => {
  if (typeof window === "undefined") return "localhost:8080";
  return `${window.location.hostname}:8080`;
};

const initialEngineUrl = getStoredValue<string>(STORAGE_KEYS.engineUrl, getDefaultEngineUrl());
export const $engineUrl = atom<string>(initialEngineUrl);

$engineUrl.subscribe((value) => persistValue(STORAGE_KEYS.engineUrl, value));

export const $notifications = atom<
  Array<{
    id: string;
    type: "info" | "success" | "warning" | "error";
    title: string;
    message?: string;
    timestamp: Date;
    read: boolean;
  }>
>([]);

/**
 * Whether this tab is on screen. Anything that polls should pause on false:
 * browsers throttle timers in background tabs but still run them.
 */
export const $documentVisible = atom<boolean>(typeof document === "undefined" ? true : !document.hidden);
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    $documentVisible.set(!document.hidden);
  });
}

/** How long without input before the person at this tab counts as away. */
const USER_IDLE_MS = 10 * 60 * 1000;
/** Input resets the idle timer at most this often; pointer moves arrive many times a second. */
const IDLE_RESET_THROTTLE_MS = 1000;

/**
 * Whether someone has used this tab recently. A visible tab is not proof of a
 * viewer: a dashboard left on a second monitor or docked in OBS stays visible
 * all day, and every poll it runs is a billed backend call.
 */
export const $userActive = atom<boolean>(true);
if (typeof window !== "undefined") {
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let lastResetAt = 0;
  const markActive = () => {
    const now = Date.now();
    if ($userActive.get() && now - lastResetAt < IDLE_RESET_THROTTLE_MS) {
      return;
    }
    lastResetAt = now;
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => $userActive.set(false), USER_IDLE_MS);
    $userActive.set(true);
  };
  for (const event of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"]) {
    window.addEventListener(event, markActive, { passive: true, capture: true });
  }
  $documentVisible.listen((visible) => {
    if (visible) {
      markActive();
    }
  });
  markActive();
}

/**
 * On screen and in use. Anything that polls the backend should run only while
 * this is true; it flips back the moment someone returns, so a refresh tied to
 * it is current by the time they look.
 */
export const $attended = computed([$documentVisible, $userActive], (visible, active) => visible && active);

export const $commandPaletteOpen = atom<boolean>(false);

// Ids of the quick actions last chosen, most recent first. Per browser: ids of items that
// belong to another instance simply fail to resolve and are skipped.
const initialPaletteRecents = getStoredValue<string[]>(STORAGE_KEYS.paletteRecents, []);
export const $paletteRecents = atom<string[]>(Array.isArray(initialPaletteRecents) ? initialPaletteRecents : []);
$paletteRecents.subscribe((value) => persistValue(STORAGE_KEYS.paletteRecents, value));

export const $activeWorkflowId = atom<string | null>(null);
export const $activeSceneId = atom<string | null>(null);

export const $unsavedChanges = map<Record<string, boolean>>({});

export function setUnsavedChanges(key: string, hasChanges: boolean) {
  $unsavedChanges.setKey(key, hasChanges);
}

export function clearUnsavedChanges(key: string) {
  const current = $unsavedChanges.get();
  const { [key]: _, ...rest } = current;
  $unsavedChanges.set(rest);
}

export function hasAnyUnsavedChanges(): boolean {
  return Object.values($unsavedChanges.get()).some(Boolean);
}
