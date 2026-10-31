import type { MarketplaceMode, ModuleOAuthResult, ModuleSettingSources } from "@/lib/marketplace-mode";

// Local mode's Marketplace tab: anonymous browsing and free installs, since
// buying needs an account. The engine runs on this computer, so it dials a
// module's local endpoints itself and no companion writes their settings;
// inbound webhooks are relayed by the hosted site, and connecting a module's
// OAuth integration goes through an account, so neither has anything to show.

const NO_SETTING_SOURCES: ModuleSettingSources = {
  sources: new Map(),
  revision: null,
  returnToCompanion: async () => {
    throw new Error("No companion fills in settings on this computer.");
  },
};

function useNoSettingSources(): ModuleSettingSources {
  return NO_SETTING_SOURCES;
}

/** Nothing to dismiss: no connect ever returns here. */
function dismissNothing(): void {}

const NO_OAUTH_RETURN: [ModuleOAuthResult | null, () => void] = [null, dismissNothing];

function useNoOAuthReturn(): [ModuleOAuthResult | null, () => void] {
  return NO_OAUTH_RETURN;
}

export const localMarketplaceMode: MarketplaceMode = {
  purchases: false,
  uploads: false,
  ModuleSettingsExtras: null,
  useSettingSources: useNoSettingSources,
  useOAuthReturn: useNoOAuthReturn,
};
