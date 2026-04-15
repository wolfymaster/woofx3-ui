import { atom, map } from 'nanostores';
import type { ThemePreset } from '@/types';

const STORAGE_KEYS = {
  theme: 'streamdeck-theme',
  themePreset: 'streamdeck-theme-preset',
  sidebarCollapsed: 'streamdeck-sidebar-collapsed',
  engineUrl: 'streamdeck-engine-url',
  currentInstanceId: 'woofx3-current-instance-id',
};

function getStoredValue<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return JSON.parse(stored) as T;
  } catch {
    return defaultValue;
  }
}

function persistValue<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}

// Currently selected woofx3 instance ID (persisted to localStorage)
const initialInstanceId = getStoredValue<string | null>(STORAGE_KEYS.currentInstanceId, null);
export const $currentInstanceId = atom<string | null>(initialInstanceId);
$currentInstanceId.subscribe((value) => persistValue(STORAGE_KEYS.currentInstanceId, value));

const initialSidebarCollapsed = getStoredValue(STORAGE_KEYS.sidebarCollapsed, false);
export const $sidebarCollapsed = atom<boolean>(initialSidebarCollapsed);
export const $sidebarWidth = atom<number>(280);

const initialTheme = getStoredValue<'light' | 'dark'>(STORAGE_KEYS.theme, 'dark');
const initialThemePreset = getStoredValue<string>(STORAGE_KEYS.themePreset, 'broadcast-blue');
export const $theme = atom<'light' | 'dark'>(initialTheme);
export const $themePreset = atom<string>(initialThemePreset);

$theme.subscribe((value) => persistValue(STORAGE_KEYS.theme, value));
$themePreset.subscribe((value) => persistValue(STORAGE_KEYS.themePreset, value));
$sidebarCollapsed.subscribe((value) => persistValue(STORAGE_KEYS.sidebarCollapsed, value));

// Engine configuration
const getDefaultEngineUrl = (): string => {
  if (typeof window === 'undefined') return 'localhost:8080';
  return `${window.location.hostname}:8080`;
};

const initialEngineUrl = getStoredValue<string>(STORAGE_KEYS.engineUrl, getDefaultEngineUrl());
export const $engineUrl = atom<string>(initialEngineUrl);

$engineUrl.subscribe((value) => persistValue(STORAGE_KEYS.engineUrl, value));

export const themePresets: ThemePreset[] = [
  {
    id: 'broadcast-blue',
    name: 'Broadcast Blue',
    colors: {
      primary: '217 91% 60%',
      primaryForeground: '0 0% 100%',
      background: '222 47% 11%',
      foreground: '210 40% 98%',
      card: '222 47% 13%',
      cardForeground: '210 40% 98%',
      muted: '217 33% 17%',
      mutedForeground: '215 20% 65%',
      accent: '217 33% 20%',
      accentForeground: '210 40% 98%',
      sidebar: '222 47% 9%',
      sidebarForeground: '210 40% 98%',
    },
  },
  {
    id: 'production-purple',
    name: 'Production Purple',
    colors: {
      primary: '262 83% 58%',
      primaryForeground: '0 0% 98%',
      background: '240 10% 8%',
      foreground: '0 0% 98%',
      card: '240 10% 10%',
      cardForeground: '0 0% 98%',
      muted: '240 5% 15%',
      mutedForeground: '240 5% 65%',
      accent: '262 30% 18%',
      accentForeground: '0 0% 98%',
      sidebar: '240 10% 6%',
      sidebarForeground: '0 0% 98%',
    },
  },
  {
    id: 'studio-green',
    name: 'Studio Green',
    colors: {
      primary: '142 71% 45%',
      primaryForeground: '0 0% 100%',
      background: '160 30% 8%',
      foreground: '0 0% 98%',
      card: '160 30% 10%',
      cardForeground: '0 0% 98%',
      muted: '160 15% 15%',
      mutedForeground: '160 10% 65%',
      accent: '142 30% 18%',
      accentForeground: '0 0% 98%',
      sidebar: '160 30% 6%',
      sidebarForeground: '0 0% 98%',
    },
  },
  {
    id: 'minimal-light',
    name: 'Minimal Light',
    colors: {
      primary: '220 90% 56%',
      primaryForeground: '0 0% 100%',
      background: '0 0% 100%',
      foreground: '222 47% 11%',
      card: '0 0% 98%',
      cardForeground: '222 47% 11%',
      muted: '220 14% 96%',
      mutedForeground: '220 9% 46%',
      accent: '220 14% 92%',
      accentForeground: '222 47% 11%',
      sidebar: '220 14% 96%',
      sidebarForeground: '222 47% 11%',
    },
  },
];

export const $notifications = atom<Array<{
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  timestamp: Date;
  read: boolean;
}>>([]);

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
