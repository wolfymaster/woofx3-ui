import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Boxes } from "lucide-react";
import { useParams } from "wouter";
import { GenericResourceDetail } from "@/components/resources/generic-resource-detail";
import { ResourceKindPage } from "@/components/resources/resource-kind-page";
import { useInstance } from "@/hooks/use-instance";
import { dynamicLucideIcon } from "@/lib/dynamic-lucide-icon";
import { pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";
import { summarizeResourceValue } from "@/lib/resource-values";
import { decodeRouteParam } from "@/lib/route-param";

/**
 * The page for a resource kind a module declares and the dashboard has no page of
 * its own for, such as a wheel: the same list, settings, triggers and actions as
 * Counters or Timers, around a detail built from the kind's declarations.
 */
export default function ResourceKind() {
  const params = useParams<{ module: string; kind: string }>();
  const moduleName = decodeRouteParam(params.module);
  const kind = decodeRouteParam(params.kind);
  const qualifiedKind = `${moduleName}:${kind}`;

  const { instance } = useInstance();
  const definition = useQuery(
    api.resourceKinds.getForInstance,
    instance ? { instanceId: instance._id, kind: qualifiedKind } : "skip"
  );
  const name = definition?.name || kind;

  return (
    <ResourceKindPage
      // A new kind is a new page: nothing chosen on the last one carries over.
      key={qualifiedKind}
      kind={qualifiedKind}
      title={pluralKindName(name)}
      description={definition?.description ?? ""}
      icon={definition?.icon ? dynamicLucideIcon(definition.icon) : Boxes}
      basePath={resourceKindPath(moduleName, kind)}
      unavailableDescription={`No installed module provides ${pluralKindName(name).toLowerCase()} called "${qualifiedKind}". Install the module that does, or check the address.`}
      railValue={(props) => summarizeResourceValue(props.value)}
      detail={(props) => <GenericResourceDetail {...props} qualifiedKind={qualifiedKind} />}
    />
  );
}
