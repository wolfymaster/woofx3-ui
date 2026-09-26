/**
 * Built-in palettes. Each one is a published editor/terminal color scheme with
 * a light and a dark variant, so any palette works in either mode.
 *
 * A variant lists only seed colors; `resolveThemeTokens` derives the rest of the
 * stylesheet's variables (foregrounds, borders, rings) from them. Where a scheme
 * has no color for a role (most have no distinct "sidebar"), the nearest shade
 * of the scheme stands in.
 */

export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  /** Page canvas. */
  background: string;
  /** Body text on every surface. */
  foreground: string;
  /** Cards and panels that sit on the canvas. */
  card: string;
  sidebar: string;
  /** Quiet fills: secondary buttons, tracks, skeletons. */
  muted: string;
  /** Secondary text. Must stay readable on `background` and `card`. */
  mutedForeground: string;
  border: string;
  /** Brand color: primary buttons, focus rings, selection. */
  primary: string;
  /** Hover and highlighted-item fill. */
  accent: string;
  destructive: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
}

export type ThemeColorKey = keyof ThemeColors;

export interface ThemePalette {
  id: string;
  name: string;
  light: ThemeColors;
  dark: ThemeColors;
}

export const DEFAULT_PALETTE_ID = "woofx3";

export const themePalettes: readonly ThemePalette[] = [
  {
    id: "woofx3",
    name: "woofx3",
    light: {
      background: "#ffffff",
      foreground: "#171717",
      card: "#fafafa",
      sidebar: "#f5f5f5",
      muted: "#ebebeb",
      mutedForeground: "#595959",
      border: "#e3e3e3",
      primary: "#7c3bed",
      accent: "#e8e7e9",
      destructive: "#e11414",
      chart1: "#450fa3",
      chart2: "#1f4ead",
      chart3: "#aa1849",
      chart4: "#b86614",
      chart5: "#1b986e",
    },
    dark: {
      background: "#121212",
      foreground: "#fafafa",
      card: "#171717",
      sidebar: "#1c1c1c",
      muted: "#262626",
      mutedForeground: "#a6a6a6",
      border: "#292929",
      primary: "#7c3bed",
      accent: "#28262b",
      destructive: "#e11414",
      chart1: "#a47de8",
      chart2: "#6791e4",
      chart3: "#eb7099",
      chart4: "#eda65e",
      chart5: "#52e0b1",
    },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    // Latte / Mocha
    light: {
      background: "#e6e9ef",
      foreground: "#4c4f69",
      card: "#eff1f5",
      sidebar: "#dce0e8",
      muted: "#dce0e8",
      mutedForeground: "#6c6f85",
      border: "#ccd0da",
      primary: "#8839ef",
      accent: "#ccd0da",
      destructive: "#d20f39",
      chart1: "#8839ef",
      chart2: "#1e66f5",
      chart3: "#40a02b",
      chart4: "#fe640b",
      chart5: "#179299",
    },
    dark: {
      background: "#181825",
      foreground: "#cdd6f4",
      card: "#1e1e2e",
      sidebar: "#11111b",
      muted: "#313244",
      mutedForeground: "#a6adc8",
      border: "#313244",
      primary: "#cba6f7",
      accent: "#45475a",
      destructive: "#f38ba8",
      chart1: "#cba6f7",
      chart2: "#89b4fa",
      chart3: "#a6e3a1",
      chart4: "#fab387",
      chart5: "#94e2d5",
    },
  },
  {
    id: "nord",
    name: "Nord",
    // Snow Storm / Polar Night, Frost for the brand, Aurora for charts
    light: {
      background: "#e5e9f0",
      foreground: "#2e3440",
      card: "#eceff4",
      sidebar: "#d8dee9",
      muted: "#d8dee9",
      mutedForeground: "#4c566a",
      border: "#c8d0dc",
      primary: "#5e81ac",
      accent: "#d8dee9",
      destructive: "#bf616a",
      chart1: "#5e81ac",
      chart2: "#81a1c1",
      chart3: "#8fa876",
      chart4: "#d08770",
      chart5: "#b48ead",
    },
    dark: {
      background: "#2e3440",
      foreground: "#eceff4",
      card: "#3b4252",
      sidebar: "#292e39",
      muted: "#434c5e",
      mutedForeground: "#a3acbd",
      border: "#434c5e",
      primary: "#88c0d0",
      accent: "#4c566a",
      destructive: "#bf616a",
      chart1: "#88c0d0",
      chart2: "#81a1c1",
      chart3: "#a3be8c",
      chart4: "#ebcb8b",
      chart5: "#b48ead",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    // Alucard / Dracula
    light: {
      background: "#fffbeb",
      foreground: "#1f1f1f",
      card: "#ffffff",
      sidebar: "#f3efdf",
      muted: "#eeeadb",
      mutedForeground: "#635d97",
      border: "#e0dccb",
      primary: "#644ac9",
      accent: "#cfcfde",
      destructive: "#cb3a2a",
      chart1: "#644ac9",
      chart2: "#036a96",
      chart3: "#14710a",
      chart4: "#a34d14",
      chart5: "#a3144d",
    },
    dark: {
      background: "#282a36",
      foreground: "#f8f8f2",
      card: "#303241",
      sidebar: "#21222c",
      muted: "#44475a",
      mutedForeground: "#a2a9c8",
      border: "#44475a",
      primary: "#bd93f9",
      accent: "#44475a",
      destructive: "#ff5555",
      chart1: "#bd93f9",
      chart2: "#8be9fd",
      chart3: "#50fa7b",
      chart4: "#ffb86c",
      chart5: "#ff79c6",
    },
  },
  {
    id: "solarized",
    name: "Solarized",
    light: {
      background: "#fdf6e3",
      foreground: "#073642",
      card: "#fffcf4",
      sidebar: "#eee8d5",
      muted: "#eee8d5",
      mutedForeground: "#657b83",
      border: "#e4dcc4",
      primary: "#268bd2",
      accent: "#e6dfc8",
      destructive: "#dc322f",
      chart1: "#268bd2",
      chart2: "#2aa198",
      chart3: "#859900",
      chart4: "#b58900",
      chart5: "#d33682",
    },
    dark: {
      background: "#002b36",
      foreground: "#eee8d5",
      card: "#073642",
      sidebar: "#00212b",
      muted: "#073642",
      mutedForeground: "#93a1a1",
      border: "#104a58",
      primary: "#268bd2",
      accent: "#0e4b5a",
      destructive: "#dc322f",
      chart1: "#268bd2",
      chart2: "#2aa198",
      chart3: "#859900",
      chart4: "#b58900",
      chart5: "#d33682",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    light: {
      background: "#fbf1c7",
      foreground: "#3c3836",
      card: "#f9f5d7",
      sidebar: "#f2e5bc",
      muted: "#ebdbb2",
      mutedForeground: "#7c6f64",
      border: "#d5c4a1",
      primary: "#af3a03",
      accent: "#ebdbb2",
      destructive: "#9d0006",
      chart1: "#af3a03",
      chart2: "#076678",
      chart3: "#79740e",
      chart4: "#b57614",
      chart5: "#8f3f71",
    },
    dark: {
      background: "#282828",
      foreground: "#ebdbb2",
      card: "#32302f",
      sidebar: "#1d2021",
      muted: "#3c3836",
      mutedForeground: "#a89984",
      border: "#3c3836",
      primary: "#fe8019",
      accent: "#504945",
      destructive: "#fb4934",
      chart1: "#fe8019",
      chart2: "#83a598",
      chart3: "#b8bb26",
      chart4: "#fabd2f",
      chart5: "#d3869b",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    // Day / Night
    light: {
      background: "#e1e2e7",
      foreground: "#3760bf",
      card: "#eef0f5",
      sidebar: "#d0d5e3",
      muted: "#d0d5e3",
      mutedForeground: "#6172b0",
      border: "#c4c8da",
      primary: "#2e7de9",
      accent: "#c4c8da",
      destructive: "#f52a65",
      chart1: "#2e7de9",
      chart2: "#9854f1",
      chart3: "#587539",
      chart4: "#b15c00",
      chart5: "#007197",
    },
    dark: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      card: "#1f2335",
      sidebar: "#16161e",
      muted: "#24283b",
      mutedForeground: "#787c99",
      border: "#292e42",
      primary: "#7aa2f7",
      accent: "#292e42",
      destructive: "#f7768e",
      chart1: "#7aa2f7",
      chart2: "#bb9af7",
      chart3: "#9ece6a",
      chart4: "#e0af68",
      chart5: "#7dcfff",
    },
  },
  {
    id: "one",
    name: "One",
    // One Light / One Dark
    light: {
      background: "#fafafa",
      foreground: "#383a42",
      card: "#ffffff",
      sidebar: "#eaeaeb",
      muted: "#f0f0f1",
      mutedForeground: "#696c77",
      border: "#dbdbdc",
      primary: "#4078f2",
      accent: "#e5e5e6",
      destructive: "#e45649",
      chart1: "#4078f2",
      chart2: "#a626a4",
      chart3: "#50a14f",
      chart4: "#c18401",
      chart5: "#0184bc",
    },
    dark: {
      background: "#282c34",
      foreground: "#abb2bf",
      card: "#2c313a",
      sidebar: "#21252b",
      muted: "#323842",
      mutedForeground: "#7f848e",
      border: "#3a3f4b",
      primary: "#61afef",
      accent: "#3a3f4b",
      destructive: "#e06c75",
      chart1: "#61afef",
      chart2: "#c678dd",
      chart3: "#98c379",
      chart4: "#e5c07b",
      chart5: "#56b6c2",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    // Dawn / main
    light: {
      background: "#faf4ed",
      foreground: "#575279",
      card: "#fffaf3",
      sidebar: "#f2e9e1",
      muted: "#f2e9e1",
      mutedForeground: "#797593",
      border: "#dfdad9",
      primary: "#907aa9",
      accent: "#dfdad9",
      destructive: "#b4637a",
      chart1: "#907aa9",
      chart2: "#56949f",
      chart3: "#286983",
      chart4: "#ea9d34",
      chart5: "#d7827e",
    },
    dark: {
      background: "#191724",
      foreground: "#e0def4",
      card: "#1f1d2e",
      sidebar: "#16141f",
      muted: "#26233a",
      mutedForeground: "#908caa",
      border: "#2a273f",
      primary: "#c4a7e7",
      accent: "#403d52",
      destructive: "#eb6f92",
      chart1: "#c4a7e7",
      chart2: "#9ccfd8",
      chart3: "#31748f",
      chart4: "#f6c177",
      chart5: "#ebbcba",
    },
  },
  {
    id: "github",
    name: "GitHub",
    light: {
      background: "#ffffff",
      foreground: "#1f2328",
      card: "#ffffff",
      sidebar: "#f6f8fa",
      muted: "#eaeef2",
      mutedForeground: "#656d76",
      border: "#d0d7de",
      primary: "#0969da",
      accent: "#eef1f4",
      destructive: "#cf222e",
      chart1: "#0969da",
      chart2: "#8250df",
      chart3: "#1a7f37",
      chart4: "#9a6700",
      chart5: "#bf3989",
    },
    dark: {
      background: "#0d1117",
      foreground: "#e6edf3",
      card: "#161b22",
      sidebar: "#010409",
      muted: "#21262d",
      mutedForeground: "#8d96a0",
      border: "#30363d",
      primary: "#2f81f7",
      accent: "#262c36",
      destructive: "#f85149",
      chart1: "#2f81f7",
      chart2: "#a371f7",
      chart3: "#3fb950",
      chart4: "#d29922",
      chart5: "#db61a2",
    },
  },
];

export function findPalette(id: string): ThemePalette | undefined {
  return themePalettes.find((palette) => palette.id === id);
}

export function getPalette(id: string): ThemePalette {
  const palette = findPalette(id);
  if (!palette) {
    throw new Error(`Unknown theme palette "${id}"`);
  }
  return palette;
}
