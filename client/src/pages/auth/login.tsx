import { useAuthActions } from "@convex-dev/auth/react";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Link } from "wouter";
import { AUTH_CARD_CLASS, AuthLayout } from "@/components/auth/auth-layout";
import { TwitchGlyph } from "@/components/twitch/twitch-glyph";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useNavigateAfterSignIn } from "@/hooks/use-navigate-after-sign-in";
import { nextPathFromLocation, withNext } from "@/lib/auth-next-path";
import { IS_DESKTOP } from "@/lib/desktop";
import { startTwitchSignIn, TWITCH_SIGN_IN_STORAGE_ERROR } from "@/lib/twitch-sign-in";

// The desktop app signs in with Twitch through the system browser, which its
// window cannot follow. IS_DESKTOP is a build constant, so the web build
// carries none of it.
const DesktopTwitchSignIn = IS_DESKTOP ? lazy(() => import("@/desktop/TwitchSignIn")) : null;

function getLoginNextPath(): string {
  return nextPathFromLocation("/");
}

/** The raw `?next=`, to hand on to Register when it is a path we would follow. */
function nextParam(): string | null {
  const next = nextPathFromLocation("");
  return next === "" ? null : next;
}

export default function Login() {
  const navigateAfterSignIn = useNavigateAfterSignIn();
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleTwitchLogin() {
    setError(null);
    setIsLoading(true);
    try {
      startTwitchSignIn(getLoginNextPath());
    } catch {
      setError(TWITCH_SIGN_IN_STORAGE_ERROR);
      setIsLoading(false);
    }
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const { signingIn } = await signIn("password", { email, password, flow: "signIn" });
      if (!signingIn) {
        setError("Invalid email or password.");
        setIsLoading(false);
        return;
      }
      navigateAfterSignIn(getLoginNextPath());
    } catch (e) {
      setError("Invalid email or password.");
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Sign in to run your stream</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DesktopTwitchSignIn ? (
            <Suspense fallback={null}>
              <DesktopTwitchSignIn nextPath={getLoginNextPath()} />
            </Suspense>
          ) : (
            <Button variant="outline" className="w-full" onClick={handleTwitchLogin} disabled={isLoading}>
              <TwitchGlyph className="mr-2" />
              Continue with Twitch
            </Button>
          )}

          <div className="relative">
            <Separator />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
              or
            </span>
          </div>

          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1"
                required
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="mt-1"
                required
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link href={withNext("/auth/register", nextParam())} className="text-primary hover:underline">
              Register
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
