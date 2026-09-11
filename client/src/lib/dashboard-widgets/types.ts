import type { ComponentType } from "react";

// UI-native dashboard canvas widgets (chat, macro pad, stream status, ...) —
// NOT to be confused with module/engine-contributed "module widgets"
// (WidgetDefinition/WidgetInstance in the shared @woofx3/api contract),
// which are a separate concept: overlay elements a module bundles as an
// HTML/JS asset, placed on a scene, and rendered as an iframe by the OBS
// browser source. This registry never touches that system.
//
// Forward-compat note: that shared contract's `WidgetDefinition.surface`
// field already has a `"dashboard"` variant reserved for modules eventually
// contributing dashboard cards too — via the same asset-bundle/iframe
// mechanism (third-party module code can't safely run as a React component
// in our own bundle). Nothing produces that data yet, so this registry only
// holds native widgets for now; a module-sourced entry would be a distinct
// variant of DashboardWidgetDefinition added when that lands, not a
// different registry.

export interface DashboardWidgetProps {
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}

export type DashboardWidgetCategory = "stream" | "automation" | "utility";

export interface DashboardWidgetDefinition {
  /** Stable catalog key, persisted as DashboardPanelWidget.type. */
  type: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  category: DashboardWidgetCategory;
  component: ComponentType<DashboardWidgetProps>;
}

// A zone can hold more than one widget (stacked, resizable) — this is the
// per-widget identity within its zone. `slotId` is optional in the schema
// because rows saved before multi-widget zones only had one widget per
// zoneId; this falls back to zoneId for that legacy shape, which stays
// unique in practice since there was only ever one widget there.
export function widgetSlotId(widget: { zoneId: string; slotId?: string }): string {
  return widget.slotId ?? widget.zoneId;
}
