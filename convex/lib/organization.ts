import { type Infer, v } from "convex/values";

// The organization is stored as `accounts`: its id is the marketplace buyer
// identity and the ops API's `/api/ops/accounts`, so the table keeps its name
// and code keeps saying `account`. User-facing copy says "organization".

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const ENGINE_ROLES = ["owner", "admin", "member"] as const;

/** `accountMembers.role`: a user's role in the organization. */
export const orgRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));
/** `instanceMembers.role`: a user's role on one engine, independent of their org role. */
export const engineRoleValidator = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"));

export type OrgRole = Infer<typeof orgRoleValidator>;
export type EngineRole = Infer<typeof engineRoleValidator>;
