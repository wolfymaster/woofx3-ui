import { Cloud, Loader2, Monitor } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { chooseHostMode, type HostModeKind } from "./host";

interface ModeOption {
  mode: HostModeKind;
  title: string;
  description: string;
  action: string;
  icon: typeof Monitor;
}

const OPTIONS: readonly ModeOption[] = [
  {
    mode: "local",
    title: "Run woofx3 on this computer",
    description: "Everything runs here, and no account is needed. You can sign in to an account later.",
    action: "Run here",
    icon: Monitor,
  },
  {
    mode: "companion",
    title: "Sign in to woofx3",
    description:
      "Use your woofx3 account and its engine. This computer connects it to OBS and the other apps on your network.",
    action: "Sign in",
    icon: Cloud,
  },
];

/**
 * The first screen of a desktop app whose mode was never chosen. Choosing
 * restarts the app into that mode, so this only ever comes back with an
 * error.
 */
export function ModeChooser() {
  const [choosing, setChoosing] = useState<HostModeKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (mode: HostModeKind) => {
    setChoosing(mode);
    setError(null);
    chooseHostMode(mode).catch((reason: unknown) => {
      setChoosing(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    });
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold">Welcome to woofx3</h1>
          <p className="text-sm text-muted-foreground">How do you want to run it?</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {OPTIONS.map((option) => (
            <Card key={option.mode} className="flex flex-col">
              <CardHeader>
                <option.icon className="h-6 w-6 text-muted-foreground" />
                <CardTitle className="text-base">{option.title}</CardTitle>
                <CardDescription>{option.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button
                  className="w-full"
                  onClick={() => choose(option.mode)}
                  disabled={choosing !== null}
                  data-testid={`button-mode-${option.mode}`}
                >
                  {choosing === option.mode && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {option.action}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        {error && (
          <p className="text-sm text-destructive text-center" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
