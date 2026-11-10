import { Button } from "@/components/ui/button";
import { useInstallUpdate } from "./use-ready-update";

/** The restart action for a ready update, with the reason a failed install gave. */
export function UpdateRestartButton() {
  const { install, installing, failure } = useInstallUpdate();
  return (
    <>
      {failure && <p className="mt-1 text-sm text-destructive">{failure}</p>}
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => void install()} disabled={installing} data-testid="button-restart-to-update">
          {installing ? "Restarting…" : "Restart to update"}
        </Button>
      </div>
    </>
  );
}
