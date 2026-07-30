import { api } from "@convex/_generated/api";
import { useAction } from "convex/react";
import { HardDrive, Save } from "lucide-react";
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

export function StorageSettingsTab() {
  const { instance } = useInstance();
  const getConfig = useAction(api.storage.getConfig);
  const setConfig = useAction(api.storage.setConfig);
  const getEngineInfo = useAction(api.engineInfo.getEngineInfo);
  const setStreamwareBaseUrl = useAction(api.engineInfo.setStreamwareBaseUrl);

  const [config, setConfigState] = useState<StorageConfig>({
    provider: "file",
    maxFileSize: 100,
    allowedExtensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm"],
  });
  // The engine's single streamwareBaseUrl (widget assets, ${woofx3_asset_url} in
  // workflow steps, and scene overlays) — a separate engine RPC from
  // getStorageConfig/setStorageConfig, not part of the engine's StorageConfig.
  const [streamwareBaseUrl, setStreamwareBaseUrlState] = useState("");
  const [baseUrlError, setBaseUrlError] = useState<string | null>(null);
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
      setStreamwareBaseUrlState(engineInfo?.streamwareBaseUrl ?? "");
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
    setBaseUrlError(null);
    const trimmedBaseUrl = streamwareBaseUrl.trim();
    if (!isValidBaseUrl(trimmedBaseUrl)) {
      setBaseUrlError("Enter a valid http:// or https:// URL, or leave blank.");
      return;
    }
    setIsSaving(true);
    try {
      await Promise.all([
        setConfig({ instanceId: instance._id, config: config as unknown as Record<string, unknown> }),
        setStreamwareBaseUrl({ instanceId: instance._id, value: trimmedBaseUrl }),
      ]);
      setStreamwareBaseUrlState(trimmedBaseUrl);
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
          <div>
            <Label htmlFor="public-url">Streamware base URL</Label>
            <Input
              id="public-url"
              value={streamwareBaseUrl}
              onChange={(e) => setStreamwareBaseUrlState(e.target.value)}
              placeholder="https://cdn.example.com"
              data-testid="input-streamware-base-url"
            />
            {baseUrlError && <p className="mt-1 text-xs text-destructive">{baseUrlError}</p>}
            <p className="mt-1 text-xs text-muted-foreground">
              Base URL the engine uses to serve widget assets, resolve <code>${"{woofx3_asset_url}"}</code> in workflow
              steps, and host scene overlays. Leave blank to use the engine&apos;s default.
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
