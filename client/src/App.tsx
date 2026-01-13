import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BroadcastShell } from "@/components/layout/broadcast-shell";
import { useTheme } from "@/hooks/use-theme";

import Dashboard from "@/pages/dashboard";
import Modules from "@/pages/modules";
import Workflows from "@/pages/workflows";
import WorkflowBuilder from "@/pages/workflow-builder";
import Assets from "@/pages/assets";
import Scenes from "@/pages/scenes";
import SceneEditor from "@/pages/scene-editor";
import Team from "@/pages/team";
import Settings from "@/pages/settings";
import NotFound from "@/pages/not-found";

function ThemeInitializer({ children }: { children: React.ReactNode }) {
  useTheme();
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/modules" component={Modules} />
      <Route path="/modules/installed" component={Modules} />
      <Route path="/workflows" component={Workflows} />
      <Route path="/workflows/new" component={WorkflowBuilder} />
      <Route path="/workflows/:id" component={WorkflowBuilder} />
      <Route path="/assets" component={Assets} />
      <Route path="/scenes" component={Scenes} />
      <Route path="/scenes/:id" component={SceneEditor} />
      <Route path="/team" component={Team} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppContent() {
  return (
    <BroadcastShell>
      <Router />
    </BroadcastShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeInitializer>
          <AppContent />
          <Toaster />
        </ThemeInitializer>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
