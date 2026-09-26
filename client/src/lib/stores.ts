import { atom, map } from "nanostores";

const STORAGE_KEYS = {
  sidebarCollapsed: "streamdeck-sidebar-collapsed",
  engineUrl: "streamdeck-engine-url",
  currentInstanceId: "woofx3-current-instance-id",
  commandBarHidden: "woofx3-command-bar-hidden",
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

export const $commandPaletteOpen = atom<boolean>(false);

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
