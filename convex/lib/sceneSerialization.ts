// Pure parsers for the engine's scene JSON payloads (widgetsJson / layoutJson),
// extracted from the webhook upsert so they can be unit-tested without the
// Convex runtime. Both are total: malformed or unexpected input yields safe
// defaults rather than throwing — webhook handlers must never crash on bad data.

export interface SceneLayout {
  width?: number;
  height?: number;
  backgroundColor?: string;
}

export function parseSceneWidgets(widgetsJson: string): unknown[] {
  try {
    const parsed = JSON.parse(widgetsJson || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseSceneLayout(layoutJson: string): SceneLayout {
  try {
    const parsed = JSON.parse(layoutJson || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SceneLayout;
    }
    return {};
  } catch {
    return {};
  }
}
