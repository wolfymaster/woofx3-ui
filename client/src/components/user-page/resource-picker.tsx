import { parseKindRef } from "@convex/lib/resourceKinds";
import type { BindableResourceKind } from "@shared/user-pages";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useResourceInstancesOfKind } from "@/engine/hooks/use-module-resources";
import { resourceName } from "@/lib/resource-instance";
import { pluralKindName, resourceKindPath } from "@/lib/resource-kind-route";

interface ResourcePickerProps {
  id: string;
  kind: BindableResourceKind;
  /** The bound resource's canonical id; empty while none is chosen. */
  value: string;
  onChange: (canonicalId: string) => void;
}

/**
 * Picks one of the instance's resources of `kind` for a widget to show. A
 * binding to a resource that has since been deleted stays selected and is
 * named as missing, so the owner sees why the page will not save.
 */
export function ResourcePicker({ id, kind, value, onChange }: ResourcePickerProps) {
  const rows = useResourceInstancesOfKind(kind);
  const ref = parseKindRef(kind);
  if (!ref?.module) {
    throw new Error(`Bindable resource kind ${kind} is not module-qualified`);
  }
  const kindName = pluralKindName(ref.kind).toLowerCase();
  const missing = value !== "" && rows !== undefined && !rows.some((row) => row.canonicalId === value);

  if (rows !== undefined && rows.length === 0 && value === "") {
    return (
      <p className="text-sm text-muted-foreground">
        You have no {kindName} yet.{" "}
        <Link href={resourceKindPath(ref.module, ref.kind)} className="font-medium text-foreground underline">
          Create one
        </Link>{" "}
        to show it here.
      </p>
    );
  }

  return (
    <Select value={value === "" ? undefined : value} onValueChange={onChange} disabled={rows === undefined}>
      <SelectTrigger id={id} data-testid={`${id}-trigger`}>
        <SelectValue placeholder={rows === undefined ? "Loading…" : `Choose one of your ${kindName}`} />
      </SelectTrigger>
      <SelectContent>
        {(rows ?? []).map((row) => (
          <SelectItem key={row.canonicalId} value={row.canonicalId}>
            {resourceName(row)}
          </SelectItem>
        ))}
        {missing && (
          <SelectItem value={value} disabled>
            Deleted: {value}
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
