import { useEffect } from 'react';
import { Switch, Route, useLocation } from "wouter";
import { ConvexProvider, ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BroadcastShell } from "@/components/layout/broadcast-shell";
import { useTheme } from "@/hooks/use-theme";
import { Loader2 } from "lucide-react";
import { api } from "@convex/_generated/api";

import Dashboard from "@/pages/dashboard";
import Modules from "@/pages/modules";
import ModuleInstall from "@/pages/module-install";
import Workflows from "@/pages/workflows";
import WorkflowsNew from "@/pages/workflows-new";
import WorkflowBuilder from "@/pages/workflow-builder";
import Assets from "@/pages/assets";
import Scenes from "@/pages/scenes";
import SceneEditor from "@/pages/scene-editor";
import Team from "@/pages/team";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";
import Login from "@/pages/auth/login";
import Register from "@/pages/auth/register";
import Onboarding from "@/pages/auth/onboarding";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);

function SplashScreen() {
  return (
    <div className="h-screen w-full flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground mb-4" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    </div>
  );
}

// Redirects unauthenticated users to login
function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      navigate('/auth/login');
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) return <SplashScreen />;
  if (!isAuthenticated) return null;
  return <>{children}</>;
}

// Redirects users who haven't completed onboarding
function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const account = useQuery(api.accounts.getMyAccount);
  const instances = useQuery(api.instances.listForCurrentUser);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isAuthenticated) return;
    if (account === undefined || instances === undefined) return; // still loading

    if (!account || instances.length === 0) {
      navigate('/auth/onboarding');
    }
  }, [isAuthenticated, account, instances, navigate]);

  if (account === undefined || instances === undefined) return <SplashScreen />;
  if (!account || instances.length === 0) return null;
  return <>{children}</>;
}

function ThemeInitializer({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Switch>
      {/* Auth routes — accessible without authentication */}
      <Route path="/auth/login" component={Login} />
      <Route path="/auth/register" component={Register} />
      <Route path="/auth/onboarding">
        <AuthGuard>
          <Onboarding />
        </AuthGuard>
      </Route>

      {/* Protected app routes */}
      <Route>
        <AuthGuard>
          <OnboardingGuard>
            <BroadcastShell>
              <Switch>
                <Route path="/" component={Dashboard} />
                <Route path="/modules" component={Modules} />
                <Route path="/modules/installed" component={Modules} />
                <Route path="/modules/install" component={ModuleInstall} />
                <Route path="/workflows" component={Workflows} />
                <Route path="/workflows/new" component={WorkflowsNew} />
                <Route path="/workflows/:id" component={WorkflowBuilder} />
                <Route path="/assets" component={Assets} />
                <Route path="/scenes" component={Scenes} />
                <Route path="/scenes/:id" component={SceneEditor} />
                <Route path="/team" component={Team} />
                <Route path="/settings" component={Settings} />
                <Route component={NotFound} />
              </Switch>
            </BroadcastShell>
          </OnboardingGuard>
        </AuthGuard>
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <ConvexProvider client={convex}>
      <ConvexAuthProvider client={convex}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <ThemeInitializer>
              <AppRoutes />
              <Toaster />
            </ThemeInitializer>
          </TooltipProvider>
        </QueryClientProvider>
      </ConvexAuthProvider>
    </ConvexProvider>
  );
}

export default App;
