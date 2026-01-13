import { useStore } from '@nanostores/react';
import { useEffect, useCallback } from 'react';
import { $theme, $themePreset, themePresets } from '@/lib/stores';
import type { ThemePreset } from '@/types';

export function useTheme() {
  const theme = useStore($theme);
  const presetId = useStore($themePreset);

  const currentPreset = themePresets.find((p) => p.id === presetId) || themePresets[0];

  useEffect(() => {
    const root = document.documentElement;

    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement;
    const preset = themePresets.find((p) => p.id === presetId);

    if (preset && theme === 'dark') {
      Object.entries(preset.colors).forEach(([key, value]) => {
        const cssVar = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        root.style.setProperty(cssVar, value);
      });
    }

    localStorage.setItem('themePreset', presetId);
  }, [presetId, theme]);

  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const savedPreset = localStorage.getItem('themePreset');

    if (savedTheme) {
      $theme.set(savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      $theme.set('dark');
    }

    if (savedPreset) {
      $themePreset.set(savedPreset);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    $theme.set(theme === 'dark' ? 'light' : 'dark');
  }, [theme]);

  const setTheme = useCallback((newTheme: 'light' | 'dark') => {
    $theme.set(newTheme);
  }, []);

  const setPreset = useCallback((presetId: string) => {
    $themePreset.set(presetId);
  }, []);

  return {
    theme,
    preset: currentPreset,
    presets: themePresets,
    toggleTheme,
    setTheme,
    setPreset,
  };
}
