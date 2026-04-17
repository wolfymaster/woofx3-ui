/**
 * UI-local scene types used by the scene editor and scene list pages.
 * These describe the visual scene / widget layout the UI owns — they
 * do NOT flow to or from the engine. Engine-side scene data (if any)
 * would live in @woofx3/api.
 */

export interface Widget {
  id: string;
  type: string;
  name: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
  properties: Record<string, unknown>;
}

export interface Scene {
  id: string;
  name: string;
  description: string;
  accountId: string;
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
  accountId: string;
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
