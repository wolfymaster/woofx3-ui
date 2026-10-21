import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { CustomFieldRenderer, FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { useEngineScope } from "@/engine/context";
import { useModuleOAuthConnectRequest } from "@/engine/hooks/use-module-oauth";
import { useInternalSettingAction } from "@/hooks/use-internal-setting-action";
import { actionErrorMessage } from "@/lib/action-error";
import { buttonActionOf } from "@/lib/field-options-reference";

/**
 * A `button` field: it stores nothing and fires what its `action` names when
 * pressed, either a request the declaring module answers or connecting an
 * account through one of the module's integrations. The action must have been
 * told where it was declared (see withFieldOptionsOwner), since the engine only
 * runs a request it can find in an installed manifest.
 */
function ConfigButtonField({ field }: { field: FieldDescriptor }) {
  const action = buttonActionOf(field.action);
  if (!action) {
    return <p className="text-xs text-muted-foreground">{field.label} does nothing on this engine.</p>;
  }
  if (!action.reference) {
    return (
      <p className="text-xs text-destructive">
        {field.label} doesn't say which module it belongs to, so it can't be pressed here.
      </p>
    );
  }
  if (action.kind === "integration") {
    return (
      <IntegrationButton label={field.label} moduleId={action.reference.moduleId} integration={action.integration} />
    );
  }
  return <RequestButton label={field.label} reference={action.reference} />;
}

function RequestButton({
  label,
  reference,
}: {
  label: string;
  reference: Parameters<typeof useInternalSettingAction>[0];
}) {
  const { instanceId } = useEngineScope();
  const { trigger, status, message } = useInternalSettingAction(reference);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!instanceId || status === "pending"}
        onClick={trigger}
        data-testid={`button-field-${reference?.fieldId}`}
      >
        {status === "pending" && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
      {status === "success" && message && (
        <p className="text-xs text-emerald-600 dark:text-emerald-400" aria-live="polite">
          {message}
        </p>
      )}
      {status === "error" && (
        <p className="text-xs text-destructive" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

function IntegrationButton({ label, moduleId, integration }: { label: string; moduleId: string; integration: string }) {
  const { instanceId } = useEngineScope();
  const connectModuleOAuth = useModuleOAuthConnectRequest();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (!instanceId) {
      return;
    }
    setStarting(true);
    setError(null);
    try {
      // Coming back to the same page leaves the streamer where they pressed it.
      await connectModuleOAuth({ moduleId, integration, returnTo: window.location.pathname });
    } catch (err) {
      setError(actionErrorMessage(err));
      setStarting(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!instanceId || starting}
        onClick={() => void connect()}
      >
        {starting && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden="true" />}
        {label}
      </Button>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export const ConfigButtonFieldRenderer: CustomFieldRenderer = ({ field }) => <ConfigButtonField field={field} />;
