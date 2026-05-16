import { useState, useEffect, useCallback } from "react";
import { useAction } from "convex/react";
import { HardDrive, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@convex/_generated/api";
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
  publicUrlPrefix?: string;
}

export function StorageSettingsTab() {
  const { instance } = useInstance();
  const getConfig = useAction(api.storage.getConfig);
  const setConfig = useAction(api.storage.setConfig);

  const [config, setConfigState] = useState<StorageConfig>({
    provider: "file",
    maxFileSize: 100,
    allowedExtensions: ["png", "jpg", "jpeg", "gif", "webp", "mp4", "webm"],
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    if (!instance) return;
    setIsLoading(true);
    try {
      const result = await getConfig({ instanceId: instance._id });
      if (result) {
        setConfigState(result as unknown as StorageConfig);
      }
    } catch {
    } finally {
      setIsLoading(false);
    }
  }, [instance, getConfig]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    if (!instance) return;
    setIsSaving(true);
    try {
      await setConfig({ instanceId: instance._id, config: config as unknown as Record<string, unknown> });
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
            <Label htmlFor="public-url">Public URL Prefix</Label>
            <Input
              id="public-url"
              value={config.publicUrlPrefix || ""}
              onChange={(e) => updateConfig({ publicUrlPrefix: e.target.value })}
              placeholder="https://cdn.example.com/"
            />
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
