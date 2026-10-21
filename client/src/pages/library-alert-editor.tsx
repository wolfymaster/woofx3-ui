import { Bell, Loader2 } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { LibraryAlertEditor } from "@/components/alert-editor/library-alert-editor";
import { EmptyState } from "@/components/common/empty-state";
import { useEngineScope } from "@/engine/context";
import { useEngineCapabilities } from "@/engine/hooks/use-engine-capabilities";
import { ALERT_LIBRARY_CAPABILITIES } from "@/lib/engine-capabilities";

/** A library alert's editor, on its own route so a deep link and the browser's back button work. */
export default function LibraryAlertEditorPage() {
  const params = useParams<{ compositionId: string }>();
  const compositionId = decodeParam(params.compositionId);
  const [, navigate] = useLocation();
  const { instanceId } = useEngineScope();
  const support = useEngineCapabilities().support(...ALERT_LIBRARY_CAPABILITIES);

  // Back returns to the editor the library was opened from, when there is one.
  const back = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate("/stream/alerts");
  };

  if (!instanceId || support === "checking") {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (support === "unsupported" || compositionId === "") {
    return (
      <div className="p-8">
        <EmptyState
          icon={Bell}
          title="There's no alert library here"
          description="This engine doesn't keep an alert library, or the link is incomplete."
          action={{ label: "Back to alerts", onClick: () => navigate("/stream/alerts") }}
        />
      </div>
    );
  }

  return <LibraryAlertEditor instanceId={instanceId} compositionId={compositionId} onBack={back} />;
}

/** A route segment decoded; one that is not valid percent-encoding is kept as written, and matches nothing. */
function decodeParam(segment: string | undefined): string {
  if (!segment) {
    return "";
  }
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}
