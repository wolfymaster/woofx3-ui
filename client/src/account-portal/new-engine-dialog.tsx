import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { suggestSlug, USERNAME_PREFIX } from "@shared/engine-slug";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useLocation } from "wouter";
import { SlugStatus, slugSubmittable, useSlugAvailability } from "@/components/onboarding/slug-availability";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actionErrorMessage } from "@/lib/action-error";
import { $currentInstanceId } from "@/lib/stores";

type Hosting = "managed" | "external";

/**
 * "Create another engine", for the organization's owner: an engine woofx3
 * hosts, named and given its address here, or one the owner runs themselves.
 * Either way the new engine becomes the selected one and setup takes over,
 * showing a hosted engine's build as it does the first engine's.
 */
export function NewEngineDialog({ accountId }: { accountId: Id<"accounts"> }) {
  const [, navigate] = useLocation();
  const managedEngines = useQuery(api.provisioning.isAvailable);
  const startNewEngine = useAction(api.provisioning.startNewEngine);
  const createInstance = useMutation(api.instances.create);
  const registerInstance = useAction(api.registration.registerInstance);

  const [open, setOpen] = useState(false);
  const [hosting, setHosting] = useState<Hosting>("managed");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managedAvailable = managedEngines?.available === true;
  const chosenHosting: Hosting = managedAvailable ? hosting : "external";
  const check = useSlugAvailability(chosenHosting === "managed" ? slug : "");

  function reset() {
    setHosting("managed");
    setName("");
    setSlug("");
    setSlugEdited(false);
    setUrl("");
    setError(null);
  }

  function changeName(next: string) {
    setName(next);
    if (!slugEdited) {
      setSlug(suggestSlug(next));
    }
  }

  function openEngine(instanceId: Id<"instances">) {
    $currentInstanceId.set(instanceId);
    navigate("/setup");
  }

  async function createManaged(): Promise<Id<"instances">> {
    const { instanceId } = await startNewEngine({ accountId, name: name.trim(), slug });
    return instanceId;
  }

  async function createExternal(): Promise<Id<"instances"> | null> {
    const instanceId = await createInstance({ accountId, name: name.trim(), url: url.trim() });
    const result = await registerInstance({ instanceId });
    if (!result.ok) {
      setError(`We couldn't connect to that server: ${result.error}`);
      return null;
    }
    return instanceId;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const instanceId = chosenHosting === "managed" ? await createManaged() : await createExternal();
      if (instanceId !== null) {
        openEngine(instanceId);
      }
    } catch (err) {
      setError(actionErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const ready = name.trim() !== "" && (chosenHosting === "managed" ? slugSubmittable(slug, check) : url.trim() !== "");

  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        data-testid="button-create-engine"
      >
        Create another engine
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create another engine</DialogTitle>
              <DialogDescription>
                Your new engine starts fresh, with its own overlays, alerts and streaming account.
              </DialogDescription>
            </DialogHeader>

            {managedAvailable && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={hosting === "managed" ? "default" : "outline"}
                  onClick={() => setHosting("managed")}
                  data-testid="button-new-engine-managed"
                >
                  woofx3 runs it
                </Button>
                <Button
                  type="button"
                  variant={hosting === "external" ? "default" : "outline"}
                  onClick={() => setHosting("external")}
                  data-testid="button-new-engine-external"
                >
                  I run it myself
                </Button>
              </div>
            )}

            <div>
              <Label htmlFor="new-engine-name">Name</Label>
              <Input
                id="new-engine-name"
                value={name}
                onChange={(event) => changeName(event.target.value)}
                placeholder="Second channel"
                className="mt-1"
                required
                data-testid="input-new-engine-name"
              />
            </div>

            {chosenHosting === "managed" ? (
              <div>
                <Label htmlFor="new-engine-slug">Address</Label>
                <div className="mt-1 flex items-center gap-1">
                  <span className="text-sm text-muted-foreground font-mono shrink-0">{USERNAME_PREFIX}</span>
                  <Input
                    id="new-engine-slug"
                    value={slug}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setSlug(event.target.value.trim().toLowerCase());
                    }}
                    placeholder="secondchannel"
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    data-testid="input-engine-slug"
                  />
                </div>
                <SlugStatus slug={slug} check={check} />
              </div>
            ) : (
              <div>
                <Label htmlFor="new-engine-url">Server address</Label>
                <Input
                  id="new-engine-url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="localhost:8080"
                  className="mt-1 font-mono"
                  required
                  data-testid="input-new-engine-url"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Where your server is running. Include the port if it needs one.
                </p>
              </div>
            )}

            {(error ?? check.checkError) && <p className="text-sm text-destructive">{error ?? check.checkError}</p>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!ready || submitting} data-testid="button-submit-new-engine">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {chosenHosting === "managed" ? "Create engine" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
