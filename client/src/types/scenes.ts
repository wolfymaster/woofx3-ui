/**
 * Scene / widget types used by the scene editor and scene list pages.
 * Scenes are engine-authoritative: the editor mutates this local shape,
 * then serializes widgets/layout to JSON and writes through
 * convex/sceneActions.ts → engine RPC. The Convex `scenes` table is a
 * read cache populated by engine webhooks.
 */

export interface Widget {
  id: string;
  widgetCanonicalId: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  settings: Record<string, unknown>;
}

export interface Scene {
  id: string;
  engineSceneId: string;
  name: string;
  description: string;
  width: number;
  height: number;
  backgroundColor: string;
  widgets: Widget[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateSceneInput {
  name: string;
  description?: string;
  width?: number;
  height?: number;
  backgroundColor?: string;
  widgets?: Widget[];
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
