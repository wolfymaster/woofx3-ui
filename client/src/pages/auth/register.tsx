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
import { afterRegisterPath, nextPathFromLocation, withNext } from "@/lib/auth-next-path";
import { IS_DESKTOP } from "@/lib/desktop";
import { PASSWORD_MIN_LENGTH, type RegisterError, registerError } from "@/lib/register-error";
import { signUpSiteKey } from "@/lib/sign-up-challenge";
import { startTwitchSignIn, TWITCH_SIGN_IN_STORAGE_ERROR } from "@/lib/twitch-sign-in";
import { loadTurnstileScript, TurnstileChallenge } from "@/user-page/widgets/turnstile";

// The desktop app signs in with Twitch through the system browser, which its
// window cannot follow. IS_DESKTOP is a build constant, so the web build
// carries none of it.
const DesktopTwitchSignIn = IS_DESKTOP ? lazy(() => import("@/desktop/TwitchSignIn")) : null;

// Password sign-up carries a Turnstile token that Convex checks before it
// creates the user. The desktop app's window is not a host name a Turnstile
// widget can allow, so it offers no password sign-up.
const SIGN_UP_SITE_KEY = IS_DESKTOP
  ? null
  : signUpSiteKey(import.meta.env.VITE_TURNSTILE_SITE_KEY, import.meta.env.DEV);

export default function Register() {
  const navigateAfterSignIn = useNavigateAfterSignIn();
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<RegisterError | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  // A token works once, so every refused sign-up remounts the challenge for a fresh one.
  const [challengeRound, setChallengeRound] = useState(0);

  function handleTwitchRegister() {
    setError(null);
    setIsLoading(true);
    try {
      startTwitchSignIn(afterRegisterPath(window.location.search));
    } catch {
      setError({ kind: "exists-or-unknown", message: TWITCH_SIGN_IN_STORAGE_ERROR });
      setIsLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (turnstileToken === null) {
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const { signingIn } = await signIn("password", { email, password, flow: "signUp", turnstileToken });
      if (!signingIn) {
        setError(registerError(new Error("sign-up returned no session")));
        setIsLoading(false);
        return;
      }
      navigateAfterSignIn(afterRegisterPath(window.location.search));
    } catch (err) {
      setError(registerError(err));
      setTurnstileToken(null);
      setChallengeRound((round) => round + 1);
      setIsLoading(false);
    }
  }

  return (
    <AuthLayout>
      <Card className={AUTH_CARD_CLASS}>
        <CardHeader>
          <CardTitle>Create account</CardTitle>
          <CardDescription>Sign up to start streaming with woofx3</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {DesktopTwitchSignIn ? (
            <Suspense fallback={null}>
              <DesktopTwitchSignIn nextPath={afterRegisterPath(window.location.search)} />
            </Suspense>
          ) : (
            <Button className="w-full" onClick={handleTwitchRegister} disabled={isLoading}>
              <TwitchGlyph className="mr-2" />
              Continue with Twitch
            </Button>
          )}

          {SIGN_UP_SITE_KEY === null ? (
            <p className="text-sm text-muted-foreground text-center">
              To sign up with email, create your account on the woofx3 website, then sign in here.
            </p>
          ) : (
            <>
              <div className="relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                  or
                </span>
              </div>

              <form onSubmit={handleRegister} className="space-y-3">
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
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
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="mt-1"
                    required
                    minLength={PASSWORD_MIN_LENGTH}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">At least {PASSWORD_MIN_LENGTH} characters.</p>
                </div>

                <TurnstileChallenge
                  key={challengeRound}
                  siteKey={SIGN_UP_SITE_KEY}
                  load={loadTurnstileScript}
                  onToken={setTurnstileToken}
                  appearance="interaction-only"
                  className="flex justify-center"
                />

                {error && (
                  <p className="text-sm text-destructive">
                    {error.message}{" "}
                    {error.kind === "exists-or-unknown" && (
                      <Link href={withNext("/auth/login", nextPathFromLocation("") || null)} className="underline">
                        Sign in
                      </Link>
                    )}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={isLoading || turnstileToken === null}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
                </Button>
              </form>
            </>
          )}
        </CardContent>
        <CardFooter className="justify-center">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link
              href={withNext("/auth/login", nextPathFromLocation("") || null)}
              className="text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </AuthLayout>
  );
}
