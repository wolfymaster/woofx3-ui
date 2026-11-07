import { Check, MonitorPlay } from "lucide-react";
import type { ReactNode } from "react";
import { SETUP_STEPS, type SetupStepId, setupStepIndex } from "@/lib/setup-steps";
import { cn } from "@/lib/utils";

interface SetupShellProps {
  activeStep: SetupStepId | null;
  children: ReactNode;
}

/** Setup's frame: the woofx3 mark and, on a step, the progress dots. */
export function SetupShell({ activeStep, children }: SetupShellProps) {
  const activeIndex = activeStep === null ? -1 : setupStepIndex(activeStep);
  return (
    <div className="min-h-screen bg-background flex justify-center p-4 sm:pt-12">
      <div className="w-full max-w-lg space-y-6">
        <div className="flex items-center justify-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-primary text-primary-foreground">
            <MonitorPlay className="h-5 w-5" />
          </div>
          <span className="font-bold text-2xl tracking-tight">woofx3</span>
        </div>
        {activeStep !== null && (
          <ol className="flex items-center justify-center gap-2" aria-label="Setup progress">
            {SETUP_STEPS.map((step, index) => (
              <li key={step.id} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium",
                    index < activeIndex && "bg-primary text-primary-foreground",
                    index === activeIndex && "bg-primary/20 text-primary border-2 border-primary",
                    index > activeIndex && "bg-muted text-muted-foreground"
                  )}
                  aria-current={index === activeIndex ? "step" : undefined}
                >
                  {index < activeIndex ? <Check className="h-4 w-4" /> : index + 1}
                  <span className="sr-only">{step.title}</span>
                </span>
                {index < SETUP_STEPS.length - 1 && (
                  <span className={cn("h-px w-10", index < activeIndex ? "bg-primary" : "bg-muted")} />
                )}
              </li>
            ))}
          </ol>
        )}
        {children}
      </div>
    </div>
  );
}
