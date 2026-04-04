export type StorageProvider = "convex" | "r2" | "local";

export interface UploadIntent {
  /** URL the browser uploads the file to */
  uploadUrl: string;
  /** HTTP method the browser must use */
  method: "PUT" | "POST";
  /** Extra headers the browser must include on the upload request */
  headers?: Record<string, string>;
  /** Provider-specific file key. Pass this back to assets.create(). */
  fileKey: string;
  /** Which storage backend issued this intent */
  provider: StorageProvider;
  /**
   * When true (Convex only), the upload response body contains the real key
   * as `{ storageId: string }` — use that instead of fileKey.
   */
  requiresResponseKey: boolean;
}
