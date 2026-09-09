import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useInstance } from "@/hooks/use-instance";

interface StorageConfig {
  provider: "file" | "s3";
  destination?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle?: boolean;
  maxFileSize?: number;
  allowedExtensions?: string[];
}

function isValidBaseUrl(value: string): boolean {
  if (!value) {
    return true;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function StorageSettings() {
  const { instance } = useInstance();
  const getConfig = useAction(api.storage.getConfig);
  const setConfig = useAction(api.storage.setConfig);
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  const setOverlayPublicUrl = useAction(api.engineInfo.setOverlayPublicUrl);

  const [config, setConfigState] = useState<StorageConfig>({
    provider: "file",
    maxFileSize: 100,
    allowedExtensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm"],
  });
  // Public base URL the api's overlay gateway is reachable at — covers both
  // overlay access (what mintOverlayToken/rotateOverlayToken/listOverlayTokens
  // compose the browser-source and scene-preview URLs from) and asset
  // resolution (widgets, module assets, uploads all proxy through the same
  // /overlay/ surface). A separate engine RPC from getStorageConfig/
  // setStorageConfig, not part of the engine's StorageConfig — that's purely
  // about which backend barkloader writes bytes to, not public reachability.
  const [overlayPublicUrl, setOverlayPublicUrlState] = useState("");
  const [overlayUrlError, setOverlayUrlError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!instance) return;
    setIsLoading(true);
    try {
      const [result, engineInfo] = await Promise.all([
        getConfig({ instanceId: instance._id }),
        getEngineInfo({ instanceId: instance._id }),
      ]);
      if (result) {
        setConfigState(result as unknown as StorageConfig);
      }
      setOverlayPublicUrlState(engineInfo?.overlayPublicUrl ?? "");
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [instance, getConfig, getEngineInfo]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!instance) return;
    setOverlayUrlError(null);
    const trimmedOverlayUrl = overlayPublicUrl.trim();
    if (!isValidBaseUrl(trimmedOverlayUrl)) {
      setOverlayUrlError("Enter a valid http:// or https:// URL, or leave blank.");
      return;
    }
    setIsSaving(true);
    try {
      await Promise.all([
        setConfig({ instanceId: instance._id, config: config as unknown as Record<string, unknown> }),
        setOverlayPublicUrl({ instanceId: instance._id, value: trimmedOverlayUrl }),
      ]);
      setOverlayPublicUrlState(trimmedOverlayUrl);
    } finally {
      setIsSaving(false);
    }
  };

  const updateConfig = (updates: Partial<StorageConfig>) => {
    setConfigState((prev) => ({ ...prev, ...updates }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading storage config...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-lg font-medium mb-4">Storage Provider</h2>
        <div className="space-y-4">
          <div>
            <Label>Provider</Label>
            <div className="flex gap-2 mt-2">
              {(["file", "s3"] as const).map((provider) => (
                <Button
                  key={provider}
                  variant={config.provider === provider ? "default" : "outline"}
                  onClick={() => updateConfig({ provider })}
                >
                  {provider.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {config.provider === "file" && (
            <div>
              <Label htmlFor="destination">Destination Path</Label>
              <Input
                id="destination"
                value={config.destination || ""}
                onChange={(e) => updateConfig({ destination: e.target.value })}
                placeholder="/path/to/storage"
              />
            </div>
          )}

          {config.provider === "s3" && (
            <div className="space-y-4">
              <div>
                <Label htmlFor="bucket">Bucket Name</Label>
                <Input
                  id="bucket"
                  value={config.bucket || ""}
                  onChange={(e) => updateConfig({ bucket: e.target.value })}
                  placeholder="my-bucket"
                />
              </div>
              <div>
                <Label htmlFor="region">Region</Label>
                <Input
                  id="region"
                  value={config.region || ""}
                  onChange={(e) => updateConfig({ region: e.target.value })}
                  placeholder="us-east-1"
                />
              </div>
              <div>
                <Label htmlFor="endpoint">Endpoint URL</Label>
                <Input
                  id="endpoint"
                  value={config.endpoint || ""}
                  onChange={(e) => updateConfig({ endpoint: e.target.value })}
                  placeholder="https://s3.amazonaws.com"
                />
              </div>
              <div>
                <Label htmlFor="access-key">Access Key ID</Label>
                <Input
                  id="access-key"
                  type="password"
                  value={config.accessKey || ""}
                  onChange={(e) => updateConfig({ accessKey: e.target.value })}
                  placeholder="AKIA..."
                />
              </div>
              <div>
                <Label htmlFor="secret-key">Secret Access Key</Label>
                <Input
                  id="secret-key"
                  type="password"
                  value={config.secretKey || ""}
                  onChange={(e) => updateConfig({ secretKey: e.target.value })}
                  placeholder="..."
                />
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-medium mb-4">File Settings</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="max-file-size">Max File Size (MB)</Label>
            <Input
              id="max-file-size"
              type="number"
              value={config.maxFileSize || 100}
              onChange={(e) => updateConfig({ maxFileSize: parseInt(e.target.value, 10) })}
            />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-medium mb-4">Scene Manager Public URL</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="overlay-public-url">Public URL</Label>
            <Input
              id="overlay-public-url"
              value={overlayPublicUrl}
              onChange={(e) => setOverlayPublicUrlState(e.target.value)}
              placeholder="https://scenes.example.com"
              data-testid="input-overlay-public-url"
            />
            {overlayUrlError && <p className="mt-1 text-xs text-destructive">{overlayUrlError}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              Public base URL the engine&apos;s <strong>Scene Manager</strong> service is reachable at — browser-source
              and scene-preview links are built from it (<code>{"{url}/scene/{sceneId}?token=…"}</code>), as are
              widget/module asset URLs. Point this at Scene Manager (port <code>9101</code> by default), not the API
              gateway — the API service no longer serves scenes. Leave blank to use the engine&apos;s default.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          <Save className="h-4 w-4 mr-2" />
          {isSaving ? "Saving..." : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
