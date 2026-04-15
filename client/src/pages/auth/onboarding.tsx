import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useAction, useMutation, useQuery } from 'convex/react';
import { useConvexAuth } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MonitorPlay, Loader2, Check, Server, Building2 } from 'lucide-react';
import { $currentInstanceId } from '@/lib/stores';
import type { Id } from '@convex/_generated/dataModel';

const STEPS = [
  { id: 'account', title: 'Create your workspace', icon: Building2, description: 'Set up your account name' },
  { id: 'instance', title: 'Connect your woofx3 instance', icon: Server, description: 'Enter the URL of your woofx3 installation' },
];

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.getMe);

  const [step, setStep] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: Account
  const [accountName, setAccountName] = useState('');

  // Step 2: Instance
  const [instanceName, setInstanceName] = useState('');
  const [instanceUrl, setInstanceUrl] = useState('localhost:8080');

  const createAccount = useMutation(api.accounts.createAccount);
  const createInstance = useMutation(api.instances.create);
  const registerInstance = useAction(api.registration.registerInstance);
  const existingAccount = useQuery(api.accounts.getMyAccount);
  const [workspaceAccountId, setWorkspaceAccountId] = useState<Id<'accounts'> | null>(null);
  const [registrationStatus, setRegistrationStatus] = useState<string | null>(null);
  const didPrefill = useRef(false);

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
      setError(err.message || 'Failed to create account.');
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
        throw new Error('Account not found');
      }

      setRegistrationStatus('Creating instance...');
      const instanceId = await createInstance({
        accountId: accountIdToUse,
        name: instanceName.trim(),
        url: instanceUrl.trim(),
      });

      // Register with the woofx3 engine (handshake)
      setRegistrationStatus('Registering with engine...');
      const result = await registerInstance({ instanceId });

      if (!result.ok) {
        setError(`Engine registration failed: ${result.error}`);
        return;
      }

      $currentInstanceId.set(instanceId);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to create instance.');
    } finally {
      setIsLoading(false);
      setRegistrationStatus(null);
    }
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentStep = STEPS[step];

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
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-colors ${
                i < step
                  ? 'bg-primary text-primary-foreground'
                  : i === step
                  ? 'bg-primary/20 text-primary border-2 border-primary'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {i < step ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px w-12 ${i < step ? 'bg-primary' : 'bg-muted'}`} />
              )}
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
            {step === 0 && (
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

            {step === 1 && (
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
                    {registrationStatus ?? 'Get started'}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
