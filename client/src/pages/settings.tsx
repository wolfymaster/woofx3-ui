import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAction, useMutation as useConvexMutation } from "convex/react";
import {
  User,
  Bell,
  Palette,
  Shield,
  Key,
  Moon,
  Sun,
  Monitor,
  Check,
  CheckCircle2,
  Server,
  Loader2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader } from "@/components/layout/page-header";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { $engineUrl } from "@/lib/stores";
import { useStore } from "@nanostores/react";
import { api } from "@convex/_generated/api";
import { useInstance } from "@/hooks/use-instance";

type ConnectionStatus = "idle" | "testing" | "success" | "error";

function EngineSettingsTab() {
  const { instance, isLoading: instanceLoading } = useInstance();
  const testConnectionAction = useAction(api.engineHealth.testConnection);
  const updateInstance = useConvexMutation(api.instances.update);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savingUrl, setSavingUrl] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fallbackUrl = useStore($engineUrl);

  const [urlDraft, setUrlDraft] = useState(fallbackUrl);

  useEffect(() => {
    const next = instance?.url?.trim() || fallbackUrl;
    setUrlDraft(next);
  }, [instance, fallbackUrl]);

  const effectiveUrl = urlDraft.trim();

  const persistEngineUrl = useCallback(async () => {
    setSaveError(null);
    if (!instance) {
      return;
    }
    const trimmed = urlDraft.trim();
    if (!trimmed || trimmed === instance.url.trim()) {
      $engineUrl.set(trimmed);
      return;
    }
    setSavingUrl(true);
    try {
      await updateInstance({ instanceId: instance._id, url: trimmed });
      $engineUrl.set(trimmed);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingUrl(false);
    }
  }, [instance, urlDraft, updateInstance]);

  const handleTestConnection = useCallback(async () => {
    if (!effectiveUrl) {
      setStatus("error");
      setErrorMsg("No engine URL configured");
      return;
    }
    setStatus("testing");
    setErrorMsg(null);

    if (resetTimer.current) {
      clearTimeout(resetTimer.current);
    }

    try {
      const result = await testConnectionAction({ url: effectiveUrl });
      if (result.ok) {
        setStatus("success");
      } else {
        setStatus("error");
        setErrorMsg(result.error ?? "Unknown error");
      }
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }

    resetTimer.current = setTimeout(() => {
      setStatus("idle");
      setErrorMsg(null);
    }, 5000);
  }, [effectiveUrl, testConnectionAction]);

  useEffect(() => {
    return () => {
      if (resetTimer.current) {
        clearTimeout(resetTimer.current);
      }
    };
  }, []);

  if (instanceLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading instance…
        </CardContent>
      </Card>
    );
  }

  if (!instance) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          No instance selected. Complete onboarding or pick an instance from the header menu.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Engine Configuration</CardTitle>
        <CardDescription>
          Endpoint for the selected instance ({instance.name}). Each instance has its own engine URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-2">
          <Label htmlFor="engine-url">Engine URL</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="engine-url"
              placeholder="localhost:8080 or https://api.example.com"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={() => {
                void persistEngineUrl();
              }}
              className="flex-1 min-w-[200px]"
              data-testid="input-engine-url"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={savingUrl || !effectiveUrl}
              onClick={() => {
                void persistEngineUrl();
              }}
              data-testid="button-save-engine-url"
            >
              {savingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save URL"}
            </Button>
            <Button
              variant="outline"
              onClick={handleTestConnection}
              disabled={!effectiveUrl || status === "testing"}
              data-testid="button-test-connection"
            >
              {status === "testing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {status === "success" && <CheckCircle2 className="h-4 w-4 mr-2 text-green-500" />}
              {status === "error" && <XCircle className="h-4 w-4 mr-2 text-destructive" />}
              {status === "idle" && <Server className="h-4 w-4 mr-2" />}
              {status === "testing"
                ? "Testing..."
                : status === "success"
                  ? "Connected"
                  : status === "error"
                    ? "Failed"
                    : "Test Connection"}
            </Button>
          </div>
          {saveError && <p className="text-xs text-destructive">{saveError}</p>}
          {status === "error" && errorMsg && <p className="text-xs text-destructive">{errorMsg}</p>}
          {status === "success" && <p className="text-xs text-green-500">Engine is reachable.</p>}
          <p className="text-xs text-muted-foreground">
            The hostname and port (or full URL) where this instance&apos;s backend API is running. If no protocol is
            specified, the current page&apos;s protocol will be used.
          </p>
        </div>
        <Separator />
        <div className="grid gap-2">
          <Label>Registration Status</Label>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
            <div className={`h-2 w-2 rounded-full ${instance?.clientId ? "bg-green-500" : "bg-yellow-500"}`} />
            <p className="text-sm text-muted-foreground">
              {instance?.clientId
                ? "Registered with engine"
                : "Not registered — re-run onboarding or register from here."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <p className="text-sm text-muted-foreground">
            Saving the engine URL updates this instance and reconnects the live engine connection.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

type UserPreferences = { email: boolean; push: boolean; workflow: boolean; marketing: boolean };

export default function Settings() {
  const { theme, setTheme, preset, presets, setPreset } = useTheme();
  const queryClient = useQueryClient();
  const { instance } = useInstance();
  const deleteInstanceAction = useAction(api.instances.deleteInstance);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: preferences, isLoading: prefsLoading } = useQuery({
    queryKey: ["userPreferences"],
    queryFn: (): Promise<UserPreferences> =>
      Promise.resolve({ email: true, push: false, workflow: true, marketing: false }),
  });

  const [notifications, setNotifications] = useState<UserPreferences>({
    email: true,
    push: false,
    workflow: true,
    marketing: false,
  });

  // Sync local state with fetched preferences
  useEffect(() => {
    if (preferences) {
      setNotifications(preferences);
    }
  }, [preferences]);

  const updatePrefsMutation = useMutation({
    mutationFn: (prefs: UserPreferences) => Promise.resolve(prefs),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userPreferences"] });
    },
  });

  const handleNotificationChange = (key: keyof UserPreferences, value: boolean) => {
    const newPrefs = { ...notifications, [key]: value };
    setNotifications(newPrefs);
    updatePrefsMutation.mutate(newPrefs);
  };

  const handleDeleteInstance = async () => {
    if (!instance) return;
    setDeleting(true);
    try {
      await deleteInstanceAction({ instanceId: instance._id });
      window.location.href = "/";
    } catch (e) {
      console.error("Failed to delete instance:", e);
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  return (
    <div className="p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader title="Settings" description="Manage your account and application preferences." />

      <Tabs defaultValue="profile" className="space-y-6" orientation="vertical">
        <div className="flex flex-col md:flex-row gap-6">
          <TabsList className="flex-col h-auto justify-start bg-transparent p-0 w-full md:w-48 shrink-0">
            <TabsTrigger value="profile" className="justify-start w-full" data-testid="tab-profile">
              <User className="h-4 w-4 mr-2" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="appearance" className="justify-start w-full" data-testid="tab-appearance">
              <Palette className="h-4 w-4 mr-2" />
              Appearance
            </TabsTrigger>
            <TabsTrigger value="notifications" className="justify-start w-full" data-testid="tab-notifications">
              <Bell className="h-4 w-4 mr-2" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="security" className="justify-start w-full" data-testid="tab-security">
              <Shield className="h-4 w-4 mr-2" />
              Security
            </TabsTrigger>
            <TabsTrigger value="engine" className="justify-start w-full" data-testid="tab-engine">
              <Server className="h-4 w-4 mr-2" />
              Engine
            </TabsTrigger>
            <TabsTrigger value="integrations" className="justify-start w-full" data-testid="tab-integrations">
              <Key className="h-4 w-4 mr-2" />
              Integrations
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 min-w-0">
            <TabsContent value="profile" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                  <CardDescription>Update your personal information.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-20 w-20">
                      <AvatarImage src="" />
                      <AvatarFallback className="text-lg">AC</AvatarFallback>
                    </Avatar>
                    <div>
                      <Button variant="outline" size="sm">
                        Change Avatar
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">JPG, PNG or GIF. Max 2MB.</p>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="display-name">Display Name</Label>
                      <Input id="display-name" defaultValue="Alex Chen" data-testid="input-display-name" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" defaultValue="alex@example.com" data-testid="input-email" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="timezone">Timezone</Label>
                      <Select defaultValue="utc-8">
                        <SelectTrigger id="timezone" data-testid="select-timezone">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="utc-8">Pacific Time (UTC-8)</SelectItem>
                          <SelectItem value="utc-5">Eastern Time (UTC-5)</SelectItem>
                          <SelectItem value="utc">UTC</SelectItem>
                          <SelectItem value="utc+1">Central European (UTC+1)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button data-testid="button-save-profile">Save Changes</Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="appearance" className="mt-0 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Theme Mode</CardTitle>
                  <CardDescription>Choose between light and dark mode.</CardDescription>
                </CardHeader>
                <CardContent>
                  <RadioGroup
                    value={theme}
                    onValueChange={(v) => setTheme(v as "light" | "dark")}
                    className="grid grid-cols-3 gap-4"
                  >
                    <div>
                      <RadioGroupItem value="light" id="theme-light" className="peer sr-only" />
                      <Label
                        htmlFor="theme-light"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                        data-testid="button-theme-light"
                      >
                        <Sun className="mb-3 h-6 w-6" />
                        Light
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="dark" id="theme-dark" className="peer sr-only" />
                      <Label
                        htmlFor="theme-dark"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                        data-testid="button-theme-dark"
                      >
                        <Moon className="mb-3 h-6 w-6" />
                        Dark
                      </Label>
                    </div>
                    <div>
                      <RadioGroupItem value="system" id="theme-system" className="peer sr-only" disabled />
                      <Label
                        htmlFor="theme-system"
                        className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 opacity-50 cursor-not-allowed"
                      >
                        <Monitor className="mb-3 h-6 w-6" />
                        System
                      </Label>
                    </div>
                  </RadioGroup>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Color Theme</CardTitle>
                  <CardDescription>Select a color preset for your interface.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreset(p.id)}
                        className={cn(
                          "relative w-full text-left rounded-lg border-2 p-4 cursor-pointer hover-elevate",
                          preset.id === p.id ? "border-primary" : "border-muted"
                        )}
                        data-testid={`button-preset-${p.id}`}
                      >
                        {preset.id === p.id && (
                          <div className="absolute top-2 right-2">
                            <Check className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className="h-4 w-4 rounded-full"
                            style={{ backgroundColor: `hsl(${p.colors.primary})` }}
                          />
                          <span className="font-medium">{p.name}</span>
                        </div>
                        <div className="flex gap-1">
                          <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.background})` }} />
                          <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.sidebar})` }} />
                          <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.card})` }} />
                          <div className="h-6 w-6 rounded" style={{ backgroundColor: `hsl(${p.colors.accent})` }} />
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notifications" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Notification Preferences</CardTitle>
                  <CardDescription>Choose how you want to be notified.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Email Notifications</Label>
                      <p className="text-sm text-muted-foreground">Receive notifications via email.</p>
                    </div>
                    <Switch
                      checked={notifications.email}
                      onCheckedChange={(v) => handleNotificationChange("email", v)}
                      disabled={prefsLoading}
                      data-testid="switch-email-notifications"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Push Notifications</Label>
                      <p className="text-sm text-muted-foreground">Receive browser push notifications.</p>
                    </div>
                    <Switch
                      checked={notifications.push}
                      onCheckedChange={(v) => handleNotificationChange("push", v)}
                      disabled={prefsLoading}
                      data-testid="switch-push-notifications"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Workflow Alerts</Label>
                      <p className="text-sm text-muted-foreground">
                        Get notified when workflows fail or need attention.
                      </p>
                    </div>
                    <Switch
                      checked={notifications.workflow}
                      onCheckedChange={(v) => handleNotificationChange("workflow", v)}
                      disabled={prefsLoading}
                      data-testid="switch-workflow-notifications"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Marketing Updates</Label>
                      <p className="text-sm text-muted-foreground">Receive news about new features and updates.</p>
                    </div>
                    <Switch
                      checked={notifications.marketing}
                      onCheckedChange={(v) => handleNotificationChange("marketing", v)}
                      disabled={prefsLoading}
                      data-testid="switch-marketing-notifications"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="mt-0 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Password</CardTitle>
                  <CardDescription>Update your account password.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2">
                    <Label htmlFor="current-password">Current Password</Label>
                    <Input id="current-password" type="password" data-testid="input-current-password" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="new-password">New Password</Label>
                    <Input id="new-password" type="password" data-testid="input-new-password" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="confirm-password">Confirm New Password</Label>
                    <Input id="confirm-password" type="password" data-testid="input-confirm-password" />
                  </div>
                  <Button data-testid="button-update-password">Update Password</Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Two-Factor Authentication</CardTitle>
                  <CardDescription>Add an extra layer of security to your account.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium">
                        Status: <span className="text-muted-foreground">Disabled</span>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Protect your account with 2FA using an authenticator app.
                      </p>
                    </div>
                    <Button variant="outline" data-testid="button-enable-2fa">
                      Enable 2FA
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-destructive">Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions for this instance.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button
                    variant="destructive"
                    data-testid="button-delete-account"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    Delete Instance
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="engine" className="mt-0">
              <EngineSettingsTab />
            </TabsContent>

            <TabsContent value="integrations" className="mt-0">
              <Card>
                <CardHeader>
                  <CardTitle>Connected Services</CardTitle>
                  <CardDescription>Manage your connected streaming platforms.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded bg-purple-600 flex items-center justify-center text-white font-bold">
                        T
                      </div>
                      <div>
                        <p className="font-medium">Twitch</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <Button variant="outline" data-testid="button-connect-twitch">
                      Connect
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded bg-red-600 flex items-center justify-center text-white font-bold">
                        Y
                      </div>
                      <div>
                        <p className="font-medium">YouTube</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <Button variant="outline" data-testid="button-connect-youtube">
                      Connect
                    </Button>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded bg-blue-500 flex items-center justify-center text-white font-bold">
                        D
                      </div>
                      <div>
                        <p className="font-medium">Discord</p>
                        <p className="text-sm text-muted-foreground">Not connected</p>
                      </div>
                    </div>
                    <Button variant="outline" data-testid="button-connect-discord">
                      Connect
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>Manage API keys for external integrations.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">You haven't created any API keys yet.</p>
                    </div>
                    <Button variant="outline" data-testid="button-create-api-key">
                      <Key className="h-4 w-4 mr-2" />
                      Create API Key
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </div>
        </div>
      </Tabs>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Instance</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this instance? This action is irreversible and will permanently remove all
              data associated with this instance, including workflows, scenes, and assets.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteInstance}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <AlertTriangle className="h-4 w-4 mr-2" />
              )}
              Delete Instance
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
