import { ResourceKindPage } from "@/components/resources/resource-kind-page";
import { resourceKindPath } from "@/lib/resource-kind-route";
import { decodeRouteParam } from "@/lib/route-param";

interface ResourceKindProps {
  /** The module declaring the kind, as its address segment, still encoded. */
  moduleName: string;
  /** The kind's name, as its address segment, still encoded. */
  kind: string;
}

/** The page for one resource kind, whichever module declares it. */
export default function ResourceKind(props: ResourceKindProps) {
  const moduleName = decodeRouteParam(props.moduleName);
  const kind = decodeRouteParam(props.kind);
  const qualifiedKind = `${moduleName}:${kind}`;

  return (
    <ResourceKindPage
      // A new kind is a new page: nothing chosen on the last one carries over.
      key={qualifiedKind}
      kind={qualifiedKind}
      basePath={resourceKindPath(moduleName, kind)}
    />
  );
}
