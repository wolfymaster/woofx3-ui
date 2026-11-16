import type { Id } from "@convex/_generated/dataModel";
import type { MyOrganization } from "@convex/organizations";

type LabelledOrganization = Pick<MyOrganization, "accountId" | "name" | "role">;

/**
 * What the organization switcher calls each organization. Names are not unique (every new organization starts as
 * "My woofx3"), so organizations sharing a name get the viewer's role added, and ones still alike get a count. The
 * stored name is never changed, and nothing about other members is shown.
 */
export function organizationLabels(organizations: readonly LabelledOrganization[]): Map<Id<"accounts">, string> {
  const sameName = countBy(organizations, (org) => org.name);
  const sameRole = countBy(organizations, (org) => `${org.name}\n${org.role}`);
  const seen = new Map<string, number>();
  const labels = new Map<Id<"accounts">, string>();
  for (const org of organizations) {
    if ((sameName.get(org.name) ?? 0) < 2) {
      labels.set(org.accountId, org.name);
      continue;
    }
    const withRole = `${org.name} (${org.role})`;
    if ((sameRole.get(`${org.name}\n${org.role}`) ?? 0) < 2) {
      labels.set(org.accountId, withRole);
      continue;
    }
    const position = (seen.get(withRole) ?? 0) + 1;
    seen.set(withRole, position);
    labels.set(org.accountId, `${withRole} ${position}`);
  }
  return labels;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return counts;
}
