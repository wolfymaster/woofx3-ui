import { type ComponentType, createContext, type ReactNode, useContext } from "react";

// What the Marketplace tab can do in one mode of the app. The hosted app has
// an account: it buys listings, takes uploads, routes local endpoints through
// the companion and relays webhooks from its own site. The desktop app's
// local mode has only its engine. Each app root builds its mode and mounts it
// here, so a mode's import tree holds nothing it cannot run, and the pages
// read what to offer from the mode rather than from which app they are in.

/** Who last wrote a setting a module's local endpoint names. */
export interface SettingSource {
  source: "companion" | "manual" | null;
  /** The companion has the setting's endpoint turned on, so handing the setting back to it means something. */
  companionEnabled: boolean;
}

/** Where a module's settings came from, for the settings form. */
export interface ModuleSettingSources {
  /** By setting key; a key not here has no recorded source. */
  sources: ReadonlyMap<string, SettingSource>;
  /**
   * Changes whenever something other than the form writes a setting, so the
   * form reloads; null while it loads, or when nothing else writes settings.
   */
  revision: string | null;
  /** Hands the setting back to the companion, which fills it on its next report. */
  returnToCompanion: (key: string) => Promise<void>;
}

/**
 * A connect of a module's `oauth[]` integration that the provider sent the
 * browser back from. `label` names the provider to the streamer.
 */
export type ModuleOAuthResult =
  | { status: "finishing"; connectCode: string; label: string }
  | { status: "connected"; label: string }
  | { status: "error"; message: string };

export interface MarketplaceMode {
  /** Whether listings can be bought: quotes, what the account owns, and checkout. */
  purchases: boolean;
  /** Whether a module can be installed from an archive uploaded here. */
  uploads: boolean;
  /** Shown on an installed module's Settings tab above its own settings; null shows nothing. */
  ModuleSettingsExtras: ComponentType<{ moduleId: string }> | null;
  /** A hook, called on every render of the settings form, so a mode keeps the same one for its whole life. */
  useSettingSources: (moduleId: string) => ModuleSettingSources;
  /**
   * The OAuth connect the page was returned to, finished, and a function that
   * dismisses its banner. Once read, the query string becomes `returnSearch`.
   * A hook, like `useSettingSources`.
   */
  useOAuthReturn: (returnSearch?: string) => [ModuleOAuthResult | null, () => void];
}

const MarketplaceModeContext = createContext<MarketplaceMode | null>(null);

/** Mounted by each app root with that app's mode. */
export function MarketplaceModeProvider({ mode, children }: { mode: MarketplaceMode; children: ReactNode }) {
  return <MarketplaceModeContext.Provider value={mode}>{children}</MarketplaceModeContext.Provider>;
}

/** The mode the Marketplace tab runs in. Throws outside a `MarketplaceModeProvider`. */
export function useMarketplaceMode(): MarketplaceMode {
  const mode = useContext(MarketplaceModeContext);
  if (mode === null) {
    throw new Error("useMarketplaceMode: no MarketplaceModeProvider above this component");
  }
  return mode;
}
