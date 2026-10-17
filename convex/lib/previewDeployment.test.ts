import { describe, expect, it } from "bun:test";
import { isPreviewDeployment } from "./previewDeployment";

describe("isPreviewDeployment", () => {
  it("is true only when the preview workflow marked the deployment", () => {
    expect(isPreviewDeployment({ PREVIEW_DEPLOYMENT: "true" })).toBe(true);
    expect(isPreviewDeployment({})).toBe(false);
    expect(isPreviewDeployment({ PREVIEW_DEPLOYMENT: "false" })).toBe(false);
    expect(isPreviewDeployment({ PREVIEW_DEPLOYMENT: "1" })).toBe(false);
  });
});
