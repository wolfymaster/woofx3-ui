import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { SetupStatus } from "@convex/setup";
import { useAction, useQuery } from "convex/react";
import { Copy, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { browserSourceUrlForKey } from "@/lib/browser-source-url";
import { findAlertWidget, SETUP_OVERLAY_NAME, SETUP_OVERLAY_SIZE, setupOverlayWidgets } from "@/lib/setup-overlay";

interface OverlayStepProps {
  instanceId: Id<"instances">;
  status: SetupStatus;
  onContinue: () => void;
}

function Actions({ onContinue, continueLabel }: { onContinue: () => void; continueLabel: string }) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" className="flex-1" onClick={onContinue} data-testid="button-overlay-skip">
        Skip
      </Button>
      <Button className="flex-1" onClick={onContinue} data-testid="button-overlay-continue">
        {continueLabel}
      </Button>
    </div>
  );
}

/**
 * The browser-source URL to put woofx3 on stream, with the steps for adding it
 * to OBS. Uses the instance's first scene, or creates one with a full-screen
 * alert widget when there is none. Scenes live on the engine, so before the
 * engine is ready this only says where the URL will be.
 */
export function OverlayStep({ instanceId, status, onContinue }: OverlayStepProps) {
  const scenes = useQuery(api.scenes.list, status.engineRegistered ? { instanceId } : "skip");
  const catalog = useQuery(api.sceneWidgets.listForInstance, status.engineRegistered ? { instanceId } : "skip");
  const createScene = useAction(api.sceneActions.createScene);
  const getOrCreateKey = useAction(api.browserSource.getOrCreateBrowserSourceKey);
  const { toast } = useToast();
  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The engine announces a new scene by webhook, so a created scene shows up
  // in `scenes` a moment after createScene returns.
  const scene = scenes ? [...scenes].sort((a, b) => a._creationTime - b._creationTime)[0] : undefined;
  const sceneId = scene?.engineSceneId ? scene._id : null;

  useEffect(() => {
    if (!sceneId || url) {
      return;
    }
    let cancelled = false;
    getOrCreateKey({ sceneId })
      .then((key) => {
        if (!cancelled) {
          setUrl(browserSourceUrlForKey(key));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sceneId, url, getOrCreateKey]);

  if (!status.engineRegistered) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your overlay lives on your engine, so its URL is ready once the engine is. You&apos;ll find it in the Getting
          started list on your dashboard.
        </p>
        <Actions onContinue={onContinue} continueLabel="Continue" />
      </div>
    );
  }

  async function handleCreate() {
    setError(null);
    setCreating(true);
    try {
      await createScene({
        instanceId,
        name: SETUP_OVERLAY_NAME,
        widgetsJson: JSON.stringify(setupOverlayWidgets(findAlertWidget(catalog ?? []))),
        layoutJson: JSON.stringify({ ...SETUP_OVERLAY_SIZE, backgroundColor: "transparent" }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreating(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).then(
      () => toast({ title: "Copied", description: "Paste it into an OBS browser source." }),
      () => toast({ title: "Couldn't copy", variant: "destructive" })
    );
  }

  let body: React.ReactNode;
  if (scenes === undefined || catalog === undefined) {
    body = <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />;
  } else if (!scene) {
    body = (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          We&apos;ll make a full-screen overlay where your alerts play. You can add more to it in Scenes later.
        </p>
        <Button onClick={() => void handleCreate()} disabled={creating} data-testid="button-create-overlay">
          {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Create my overlay
        </Button>
      </div>
    );
  } else if (!url) {
    body = (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Getting {scene.name}&apos;s URL…
      </p>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="flex gap-2">
          <Input readOnly value={url} className="font-mono text-xs" data-testid="input-overlay-url" />
          <Button variant="outline" size="icon" aria-label="Copy URL" onClick={() => copy(url)}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>In OBS, click + under Sources and choose Browser.</li>
          <li>Paste this URL into the URL field.</li>
          <li>
            Set the width to {SETUP_OVERLAY_SIZE.width} and the height to {SETUP_OVERLAY_SIZE.height}, then click OK.
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {body}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Actions onContinue={onContinue} continueLabel={url ? "I've added it" : "Continue"} />
    </div>
  );
}
