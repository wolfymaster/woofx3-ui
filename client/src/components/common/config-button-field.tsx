import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import type { CustomFieldRenderer, FieldDescriptor } from "@/components/common/configuration-form";
import { Button } from "@/components/ui/button";
import { useEngineScope } from "@/engine/context";
import { useInstance } from "@/hooks/use-instance";
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
  const { instance } = useInstance();
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
      <IntegrationButton
        instanceId={instance?._id}
        label={field.label}
        moduleId={action.reference.moduleId}
        integration={action.integration}
      />
    );
  }
  return <RequestButton label={field.label} reference={action.reference} />;
}

function RequestButton({
  label,
  reference,
}: {
  label: string;
  reference: Parameters<typeof useInternalSettingAction>[1];
}) {
  const { instanceId } = useEngineScope();
  const { trigger, status, message } = useInternalSettingAction(instanceId, reference);
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

function IntegrationButton({
  instanceId,
  label,
  moduleId,
  integration,
}: {
  instanceId: Id<"instances"> | undefined;
  label: string;
  moduleId: string;
  integration: string;
}) {
  const start = useAction(api.moduleOAuth.start);
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
      const { authorizeUrl } = await start({
        instanceId,
        moduleId,
        integration,
        redirectTo: window.location.pathname,
      });
      window.location.assign(authorizeUrl);
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
