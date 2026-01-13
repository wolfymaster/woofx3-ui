import { useState } from 'react';
import {
  Settings as SettingsIcon,
  User,
  Bell,
  Palette,
  Shield,
  Key,
  Globe,
  Moon,
  Sun,
  Monitor,
  Check,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageHeader } from '@/components/layout/page-header';
import { useTheme } from '@/hooks/use-theme';
import { cn } from '@/lib/utils';

export default function Settings() {
  const { theme, setTheme, preset, presets, setPreset } = useTheme();
  const [notifications, setNotifications] = useState({
    email: true,
    push: false,
    workflow: true,
    marketing: false,
  });

  return (
    <div className="p-6 lg:p-8 max-w-[1000px] mx-auto">
      <PageHeader
        title="Settings"
        description="Manage your account and application preferences."
      />

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
                      <Button variant="outline" size="sm">Change Avatar</Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        JPG, PNG or GIF. Max 2MB.
                      </p>
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
                    onValueChange={(v) => setTheme(v as 'light' | 'dark')}
                    className="grid grid-cols-3 gap-4"
                  >
                    <div>
                      <RadioGroupItem
                        value="light"
                        id="theme-light"
                        className="peer sr-only"
                      />
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
                      <RadioGroupItem
                        value="dark"
                        id="theme-dark"
                        className="peer sr-only"
                      />
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
                      <RadioGroupItem
                        value="system"
                        id="theme-system"
                        className="peer sr-only"
                        disabled
                      />
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
                    {presets.map(p => (
                      <div
                        key={p.id}
                        onClick={() => setPreset(p.id)}
                        className={cn(
                          'relative rounded-lg border-2 p-4 cursor-pointer hover-elevate',
                          preset.id === p.id ? 'border-primary' : 'border-muted'
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
                          <div
                            className="h-6 w-6 rounded"
                            style={{ backgroundColor: `hsl(${p.colors.background})` }}
                          />
                          <div
                            className="h-6 w-6 rounded"
                            style={{ backgroundColor: `hsl(${p.colors.sidebar})` }}
                          />
                          <div
                            className="h-6 w-6 rounded"
                            style={{ backgroundColor: `hsl(${p.colors.card})` }}
                          />
                          <div
                            className="h-6 w-6 rounded"
                            style={{ backgroundColor: `hsl(${p.colors.accent})` }}
                          />
                        </div>
                      </div>
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
                      <p className="text-sm text-muted-foreground">
                        Receive notifications via email.
                      </p>
                    </div>
                    <Switch
                      checked={notifications.email}
                      onCheckedChange={(v) => setNotifications(prev => ({ ...prev, email: v }))}
                      data-testid="switch-email-notifications"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Push Notifications</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive browser push notifications.
                      </p>
                    </div>
                    <Switch
                      checked={notifications.push}
                      onCheckedChange={(v) => setNotifications(prev => ({ ...prev, push: v }))}
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
                      onCheckedChange={(v) => setNotifications(prev => ({ ...prev, workflow: v }))}
                      data-testid="switch-workflow-notifications"
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Marketing Updates</Label>
                      <p className="text-sm text-muted-foreground">
                        Receive news about new features and updates.
                      </p>
                    </div>
                    <Switch
                      checked={notifications.marketing}
                      onCheckedChange={(v) => setNotifications(prev => ({ ...prev, marketing: v }))}
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
                      <p className="font-medium">Status: <span className="text-muted-foreground">Disabled</span></p>
                      <p className="text-sm text-muted-foreground">
                        Protect your account with 2FA using an authenticator app.
                      </p>
                    </div>
                    <Button variant="outline" data-testid="button-enable-2fa">Enable 2FA</Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-destructive/50">
                <CardHeader>
                  <CardTitle className="text-destructive">Danger Zone</CardTitle>
                  <CardDescription>Irreversible actions for your account.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="destructive" data-testid="button-delete-account">Delete Account</Button>
                </CardContent>
              </Card>
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
                    <Button variant="outline" data-testid="button-connect-twitch">Connect</Button>
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
                    <Button variant="outline" data-testid="button-connect-youtube">Connect</Button>
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
                    <Button variant="outline" data-testid="button-connect-discord">Connect</Button>
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
                      <p className="text-sm text-muted-foreground">
                        You haven't created any API keys yet.
                      </p>
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
    </div>
  );
}
