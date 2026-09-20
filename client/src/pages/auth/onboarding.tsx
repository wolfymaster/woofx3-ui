import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Building2, Check, Loader2, MonitorPlay, Server } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ManagedEngineStep } from "@/components/onboarding/managed-engine-step";
import { ProvisioningProgress } from "@/components/onboarding/provisioning-progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { suggestSlug } from "@/lib/engine-slug";
import { $currentInstanceId } from "@/lib/stores";

const STEPS = [
  { id: "account", title: "Create your workspace", icon: Building2, description: "Set up your account name" },
  {
    id: "instance",
    title: "Set up your engine",
    icon: Server,
    description: "woofx3 can run it for you, or connect one you already have",
  },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.getMe);

  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Account
  const [accountName, setAccountName] = useState("");

  // Step 2: Instance
  const [instanceName, setInstanceName] = useState("");
  const [instanceUrl, setInstanceUrl] = useState("localhost:8080");
  // The managed path is the default; this reveals the bring-your-own form.
  const [connectExisting, setConnectExisting] = useState(false);

  const createAccount = useMutation(api.accounts.createAccount);
  const createInstance = useMutation(api.instances.create);
  const registerInstance = useAction(api.registration.registerInstance);
  const existingAccount = useQuery(api.accounts.getMyAccount);
  const managedEngines = useQuery(api.provisioning.isAvailable);
  const instances = useQuery(api.instances.listForCurrentUser);
  const [workspaceAccountId, setWorkspaceAccountId] = useState<Id<"accounts"> | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const didPrefill = useRef(false);

  // An engine that is being built, or was built but never finished
  // registering. The state lives in Convex, so reloading mid-provision comes
  // back here rather than to an empty form.
  const unfinishedManagedInstance = useMemo(
    () => instances?.find((instance) => instance?.hosting === "managed" && !instance.clientId) ?? null,
    [instances]
  );
  const [provisioningInstanceId, setProvisioningInstanceId] = useState<Id<"instances"> | null>(null);
  const unfinishedProvisioning = useQuery(
    api.provisioning.forInstance,
    unfinishedManagedInstance ? { instanceId: unfinishedManagedInstance._id } : "skip"
  );

  useEffect(() => {
    if (!unfinishedManagedInstance || unfinishedProvisioning === undefined) {
      return;
    }
    // A deleted engine is not something to wait on: the instance is still
    // there but has nothing behind it, so offer to set one up again.
    if (unfinishedProvisioning === null || unfinishedProvisioning.status === "deleted") {
      setProvisioningInstanceId(null);
      return;
    }
    setProvisioningInstanceId(unfinishedManagedInstance._id);
  }, [unfinishedManagedInstance, unfinishedProvisioning]);

  useEffect(() => {
    if (!user?.name || didPrefill.current) {
      return;
    }
    setAccountName(user.name);
    setInstanceName(`${user.name}'s Instance`);
    didPrefill.current = true;
  }, [user?.name]);

  async function handleAccountStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      if (!existingAccount) {
        const id = await createAccount({ name: accountName.trim() });
        setWorkspaceAccountId(id);
      } else {
        setWorkspaceAccountId(existingAccount._id);
      }
      setStep(1);
    } catch (err: any) {
      setError(err.message || "Failed to create account.");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleInstanceStep(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const accountIdToUse = existingAccount?._id ?? workspaceAccountId;
      if (!accountIdToUse) {
        throw new Error("Account not found");
      }

      setRegistrationStatus("Creating instance...");
      const instanceId = await createInstance({
        accountId: accountIdToUse,
        name: instanceName.trim(),
        url: instanceUrl.trim(),
      });

      // Register with the woofx3 engine (handshake)
      setRegistrationStatus("Registering with engine...");
      const result = await registerInstance({ instanceId });

      if (!result.ok) {
        setError(`Engine registration failed: ${result.error}`);
        return;
      }

      $currentInstanceId.set(instanceId);
      navigate("/");
    } catch (err: any) {
      setError(err.message || "Failed to create instance.");
    } finally {
      setIsLoading(false);
      setRegistrationStatus(null);
    }
  }

  if (!isAuthenticated) {
    return null;
  }

  // While an engine is being built the second step is where the user is, even
  // though no form is on screen.
  const activeStep = provisioningInstanceId ? 1 : step;
  const currentStep = STEPS[activeStep];
  const accountId = existingAccount?._id ?? workspaceAccountId;
  const managedAvailable = managedEngines?.available === true;
  const showManagedStep = managedAvailable && !connectExisting && accountId !== null;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-center gap-3 mb-8">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <span className="font-bold text-2xl tracking-tight">woofx3</span>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                  i < activeStep
                    ? "bg-primary text-primary-foreground"
                    : i === activeStep
                      ? "bg-primary/20 text-primary border-2 border-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {i < activeStep ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && <div className={`h-px w-12 ${i < activeStep ? "bg-primary" : "bg-muted"}`} />}
            </div>
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                <currentStep.icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>{currentStep.title}</CardTitle>
                <CardDescription>{currentStep.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {provisioningInstanceId && <ProvisioningProgress instanceId={provisioningInstanceId} />}

            {!provisioningInstanceId && step === 0 && (
              <form onSubmit={handleAccountStep} className="space-y-4">
                <div>
                  <Label htmlFor="account-name">Workspace Name</Label>
                  <Input
                    id="account-name"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    placeholder="My Stream Studio"
                    className="mt-1"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    This is your account name. You can change it later.
                  </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Continue
                </Button>
              </form>
            )}

            {!provisioningInstanceId && step === 1 && showManagedStep && accountId && (
              <ManagedEngineStep
                accountId={accountId}
                suggestedSlug={suggestSlug(user?.name ?? accountName)}
                onStarted={setProvisioningInstanceId}
                onConnectExisting={() => setConnectExisting(true)}
              />
            )}

            {!provisioningInstanceId && step === 1 && !showManagedStep && (
              <form onSubmit={handleInstanceStep} className="space-y-4">
                <div>
                  <Label htmlFor="instance-name">Instance Name</Label>
                  <Input
                    id="instance-name"
                    value={instanceName}
                    onChange={(e) => setInstanceName(e.target.value)}
                    placeholder="My woofx3 Instance"
                    className="mt-1"
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="instance-url">woofx3 API URL</Label>
                  <Input
                    id="instance-url"
                    value={instanceUrl}
                    onChange={(e) => setInstanceUrl(e.target.value)}
                    placeholder="localhost:8080"
                    className="mt-1 font-mono"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    The URL where your woofx3 instance is running. Include port if needed.
                  </p>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={() => setStep(0)}
                    disabled={isLoading}
                  >
                    Back
                  </Button>
                  <Button type="submit" className="flex-1" disabled={isLoading}>
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {registrationStatus ?? "Get started"}
                  </Button>
                </div>

                {managedAvailable && (
                  <button
                    type="button"
                    onClick={() => setConnectExisting(false)}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-create-managed-engine"
                  >
                    Don&apos;t have one? Let woofx3 run it for you
                  </button>
                )}
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
