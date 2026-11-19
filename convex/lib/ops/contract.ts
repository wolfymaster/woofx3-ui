import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import type { Doc } from "../../_generated/dataModel";
import { ADD_ONS, validateEntitlementInput } from "../entitlements";
import {
  FEATURE_FLAG_DESCRIPTION_MAX,
  FEATURE_FLAG_KEY_MAX,
  FEATURE_FLAG_OWNER_MAX,
  isFeatureFlagKey,
  validateFeatureFlagDefinition,
  validateFeatureFlagRules,
} from "../featureFlags";
import {
  NOTIFICATION_ACTION_LABEL_MAX,
  NOTIFICATION_DESCRIPTION_MAX,
  NOTIFICATION_HEADING_MAX,
  NOTIFICATION_LINK_MAX,
  notificationLinkKind,
} from "../notifications";
import { BILLING_INTERVALS, LIFECYCLE_REASONS, PLAN_TIERS, SUBSCRIPTION_STATES } from "../organization";
import { normalizeEmail } from "../teamAccess";

/**
 * The ops API's contract, and the single source everything else derives from:
 * the route matcher (routes.ts), the request parsers in the handler, the DTO
 * types (dto.ts) and the published OpenAPI document (openapi/ops.json, written
 * by `bun run ops:openapi`). Change a route, a body or a DTO here and nowhere else.
 */

extendZodWithOpenApi(z);

export const OPS_PATH_PREFIX = "/api/ops/";

/** Revision of the published document; bump it when a change would break a consumer. */
export const OPS_API_VERSION = "1.0.0";

const ID_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

const idSegment = z.string().regex(ID_SEGMENT);

/** Fails with one message whatever is wrong with the value: missing, mistyped or out of range. */
const text = (message: string) => z.string({ required_error: message, invalid_type_error: message });

/** A whole number of at least 0 within JavaScript's safe range, or null where the field allows it. */
const wholeNumber = (message: string) =>
  z.number({ required_error: message, invalid_type_error: message }).int(message).safe(message).min(0, message);

/** An ISO date, YYYY-MM-DD. */
const FLAG_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The largest billing projection version: the plane keeps it in a Postgres `integer`. */
export const MAX_PROJECTION_VERSION = 2 ** 31 - 1;

export const PROVISIONING_STATUSES = [
  "requested",
  "provisioning",
  "ready",
  "registering",
  "registered",
  "upgrading",
  "failed",
  "deprovisioning",
  "deleted",
  "stopping",
  "stopped",
  "starting",
] as const satisfies readonly Doc<"engineProvisioning">["status"][];

export const provisioningStatusSchema = z.enum(PROVISIONING_STATUSES);

export const ENGINE_ACTIONS = ["upgrade", "retry", "delete"] as const;
export const engineActionSchema = z.enum(ENGINE_ACTIONS);
export type EngineAction = z.infer<typeof engineActionSchema>;

// ---------------------------------------------------------------------------
// DTOs: what responses carry. Mappers in dto.ts build them field by field.
// ---------------------------------------------------------------------------

// Convex creation times carry fractional milliseconds, so this is not an integer.
const epochMs = z.number();

export const userRefDtoSchema = z
  .object({ id: z.string(), email: z.string().nullable(), name: z.string().nullable() })
  .openapi("UserRefDto");

export const userDtoSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    providers: z.array(z.object({ provider: z.string(), providerAccountId: z.string() })),
    createdAt: epochMs,
    lastSessionAt: epochMs.nullable(),
  })
  .openapi("UserDto");

export const planRefSchema = z.object({ key: z.string(), name: z.string() }).openapi("PlanRef");

export const planSummaryDtoSchema = z
  .object({
    plan: z.union([planRefSchema, z.null()]),
    features: z.array(z.string()),
    limits: z.record(z.string(), z.number().nullable()).openapi({ description: "Null is unlimited." }),
  })
  .openapi("PlanSummaryDto");

export const accountSummaryDtoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    owner: z.union([userRefDtoSchema, z.null()]),
    memberCount: z.number().int(),
    plan: z.union([planRefSchema, z.null()]),
    managedEngineCount: z.number().int(),
    createdAt: epochMs,
  })
  .openapi("AccountSummaryDto");

export const invitationDtoSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    platformLogin: z.string().nullable(),
    role: z.string(),
    status: z.string(),
    expiresAt: epochMs,
    createdAt: epochMs,
  })
  .openapi("InvitationDto");

export const instanceDtoSchema = z
  .object({
    id: z.string(),
    accountId: z.string(),
    name: z.string(),
    url: z.string(),
    hosting: z.enum(["managed", "external"]),
    createdAt: epochMs,
    lastEngineActivityAt: epochMs.nullable(),
    companionHostname: z.string().nullable(),
    marketplaceDevAccess: z.boolean(),
  })
  .openapi("InstanceDto");

export const provisioningDtoSchema = z
  .object({
    id: z.string(),
    instanceId: z.string(),
    accountId: z.string(),
    maintenanceEngineId: z.string().nullable(),
    runId: z.string().nullable(),
    slug: z.string(),
    status: provisioningStatusSchema,
    steps: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        status: z.string(),
        error: z.string().nullable(),
        detail: z.string().nullable(),
      })
    ),
    publicUrl: z.string().nullable(),
    reportedVersion: z.string().nullable(),
    error: z.string().nullable(),
    registrationAttempts: z.number().int(),
    upgrade: z
      .object({
        fromVersion: z.string(),
        toVersion: z.string(),
        startedAt: epochMs,
        attempt: z.number().int(),
        rollingBack: z.boolean(),
        outcome: z.string().nullable(),
        error: z.string().nullable(),
        acknowledged: z.boolean(),
      })
      .nullable(),
    createdAt: epochMs,
  })
  .openapi("ProvisioningDto");

export const auditEntryDtoSchema = z
  .object({
    id: z.string(),
    caller: z.string().nullable(),
    actor: z.string(),
    action: z.string(),
    target: z.string(),
    reason: z.string().nullable(),
    request: z.string().nullable(),
    result: z.string(),
    at: epochMs,
  })
  .openapi("AuditEntryDto");

export const notificationDtoSchema = z
  .object({
    id: z.string(),
    heading: z.string(),
    description: z.string(),
    link: z.string().nullable(),
    actionLabel: z.string().nullable(),
    audience: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("all") }),
      z.object({ kind: z.literal("account"), accountId: z.string() }),
      z.object({ kind: z.literal("user"), userId: z.string() }),
    ]),
    recipients: z.number().int(),
    delivering: z.boolean(),
    createdBy: z.string(),
    createdAt: epochMs,
  })
  .openapi("NotificationDto");

export const referralDtoSchema = z
  .object({
    referralId: z.string(),
    referrerAccountId: z
      .string()
      .nullable()
      .openapi({ description: "The org the referrer owns; null when they have none." }),
    code: z.string(),
    rewardCents: z.number().int(),
    capturedAt: epochMs,
    status: z.enum(["captured", "org_created"]),
    eligible: z.boolean().openapi({
      description:
        "True only when the referred org exists, the referrer has a different org, and both owners verified their email.",
    }),
  })
  .openapi("ReferralDto");

export const referralCodeDtoSchema = z
  .object({
    code: z.string(),
    userId: z.string(),
    email: z.string().nullable(),
    rewardCents: z.number().int(),
    issuedBy: z.string(),
    issuedAt: epochMs,
    revokedAt: epochMs.nullable(),
    referralCount: z.number().int(),
  })
  .openapi("ReferralCodeDto");

export const referralCodePageSchema = z
  .object({ codes: z.array(referralCodeDtoSchema), cursor: z.string().nullable() })
  .openapi("ReferralCodePage");

/** A flag's targeting, with every field present so the backoffice never guesses. */
export const featureFlagRulesDtoSchema = z
  .object({
    users: z.array(z.string()),
    accounts: z.array(z.string()),
    instances: z.array(z.string()),
    percent: z.number().nullable(),
    hosting: z.enum(["managed", "external"]).nullable(),
    entitlement: z.string().nullable(),
  })
  .openapi("FeatureFlagRulesDto");

export const featureFlagDtoSchema = z
  .object({
    key: z.string(),
    description: z.string(),
    owner: z.string(),
    removeBy: z.string().openapi({ format: "date", description: "ISO date by which the flag should be gone." }),
    state: z.enum(["off", "on", "rules"]),
    rules: featureFlagRulesDtoSchema,
    overdue: z.boolean().openapi({ description: "Past its removeBy date, so it is cleanup to do." }),
    updatedAt: epochMs,
    updatedBy: z.string().openapi({ description: "The operator who last changed it." }),
  })
  .openapi("FeatureFlagDto");

export const featureFlagCatalogDtoSchema = z
  .object({
    flags: z.array(featureFlagDtoSchema),
    entitlements: z.array(z.object({ key: z.string(), description: z.string() })),
  })
  .openapi("FeatureFlagCatalogDto");

const hostedStorageLimitsSchema = z
  .object({
    totalBytes: z.number().int().nullable(),
    fileBytes: z.number().int().nullable(),
    moduleStorageBytes: z.number().int().nullable(),
  })
  .openapi("HostedStorageLimits", { description: "Null is unlimited." });

const hostedStorageOverrideSchema = z
  .object({
    totalBytes: z.number().int().nullable().optional(),
    fileBytes: z.number().int().nullable().optional(),
    moduleStorageBytes: z.number().int().nullable().optional(),
  })
  .openapi("HostedStorageOverride", {
    description: "A field left out inherits the account's limit; null is unlimited.",
  });

export const hostedStorageLimitsDtoSchema = z
  .object({
    inherited: hostedStorageLimitsSchema,
    override: hostedStorageOverrideSchema,
    effective: hostedStorageLimitsSchema,
  })
  .openapi("HostedStorageLimitsDto");

export const userDetailDtoSchema = z
  .object({
    user: userDtoSchema,
    accounts: z.array(z.object({ accountId: z.string(), name: z.string(), role: z.string() })),
    instances: z.array(z.object({ instanceId: z.string(), accountId: z.string(), name: z.string(), role: z.string() })),
    activeSessionCount: z.number().int(),
  })
  .openapi("UserDetailDto");

export const accountDetailDtoSchema = z
  .object({
    account: accountSummaryDtoSchema,
    members: z.array(z.object({ user: userRefDtoSchema, role: z.string() })),
    invitations: z.array(invitationDtoSchema),
    entitlements: planSummaryDtoSchema,
    instances: z.array(
      z.object({ instance: instanceDtoSchema, provisioning: z.union([provisioningDtoSchema, z.null()]) })
    ),
  })
  .openapi("AccountDetailDto");

export const engineDetailDtoSchema = z
  .object({
    provisioning: provisioningDtoSchema,
    instance: z.union([instanceDtoSchema, z.null()]),
    account: z.union([accountSummaryDtoSchema, z.null()]),
    hostedStorage: z
      .union([hostedStorageLimitsDtoSchema, z.null()])
      .openapi({ description: "Null when the instance is gone or someone else hosts the engine." }),
    isLive: z.boolean().openapi({ description: "True while the owner's stream is live." }),
  })
  .openapi("EngineDetailDto");

export const moduleStorageLimitDtoSchema = z
  .object({
    engineId: z.string().openapi({ description: "The maintenance API's engine id." }),
    instanceId: z.string(),
    limitBytes: z.number().int().nullable().openapi({ description: "Null is unlimited." }),
  })
  .openapi("ModuleStorageLimitDto");

export const engineEventPathDtoSchema = z
  .object({
    instanceId: z.string(),
    name: z.string(),
    path: z.enum(["queue", "webhook"]),
    eventsTargetSetAt: epochMs.nullable(),
  })
  .openapi("EngineEventPathDto");

export const instanceHealthDtoSchema = z
  .object({
    instance: instanceDtoSchema,
    live: z
      .object({
        isLive: z.boolean(),
        startedAt: z.string().nullable(),
        lastUpdatedAt: epochMs,
        lastUpdateSource: z.string(),
      })
      .nullable(),
    sync: z
      .object({
        status: z.string(),
        lastSyncedAt: epochMs,
        lastError: z.string(),
        consecutiveErrorCount: z.number().int(),
        lastDurationMs: z.number(),
      })
      .nullable(),
    recentAlerts: z.array(
      z.object({
        engineAlertId: z.string(),
        status: z.string(),
        error: z.string().nullable(),
        createdAt: epochMs,
      })
    ),
    failingWorkflows: z.array(
      z.object({ engineWorkflowId: z.string(), reason: z.string().nullable(), since: z.string() })
    ),
  })
  .openapi("InstanceHealthDto");

/** A page of a cursor-paginated list; pass `cursor` back until it is null. */
function pageOf<T extends z.ZodTypeAny>(name: string, item: T) {
  return z.object({ page: z.array(item), cursor: z.string().nullable() }).openapi(name);
}

const engineActionResultSchema = z
  .union([
    z.object({ outcome: z.enum(["started", "already_running", "already_current", "not_started"]) }),
    z.object({ retried: z.enum(["provisioning", "registration", "upgrade"]) }),
    z.object({ deprovisioning: z.boolean() }),
  ])
  .openapi("EngineActionResult", {
    description: "Upgrade answers `outcome`, retry answers `retried`, delete answers `deprovisioning`.",
  });

// ---------------------------------------------------------------------------
// Requests: bodies are parsed with these, so what the document says is what is enforced.
// ---------------------------------------------------------------------------

export const storageLimitsRequestSchema = z
  .strictObject({
    totalBytes: byteLimit("totalBytes").optional(),
    fileBytes: byteLimit("fileBytes").optional(),
    moduleStorageBytes: byteLimit("moduleStorageBytes").optional(),
  })
  .openapi("StorageLimitsRequest", {
    description:
      "Replaces the engine's whole override. A field left out inherits the account's limit, null is unlimited, and `{}` clears the override.",
  });

function byteLimit(field: string) {
  return z.union([
    wholeNumber(`${field} must be a whole number of bytes of at least 0, or null for unlimited`),
    z.null(),
  ]);
}

const NOTIFICATION_REQUEST_ID_MAX = 100;
const NOTIFICATION_AUDIENCE_ID_MAX = 64;
const NOTIFICATION_AUDIENCE_MESSAGE =
  'audience must be { kind: "all" }, { kind: "account", accountId } or { kind: "user", userId }';

const audienceId = (field: string) =>
  text(NOTIFICATION_AUDIENCE_MESSAGE)
    .min(1, NOTIFICATION_AUDIENCE_MESSAGE)
    .max(NOTIFICATION_AUDIENCE_ID_MAX, NOTIFICATION_AUDIENCE_MESSAGE)
    .openapi({ description: `The ${field} the notification is for.` });

const optionalText = (message: string) => z.union([z.string(), z.null()], { errorMap: () => ({ message }) }).optional();

export const notificationRequestSchema = z
  .object({
    requestId: text(`requestId must be 1 to ${NOTIFICATION_REQUEST_ID_MAX} characters`)
      .min(1, `requestId must be 1 to ${NOTIFICATION_REQUEST_ID_MAX} characters`)
      .max(NOTIFICATION_REQUEST_ID_MAX, `requestId must be 1 to ${NOTIFICATION_REQUEST_ID_MAX} characters`)
      .openapi({ description: "Makes a repeated request answer the notification already created." }),
    heading: text("heading and description must be strings")
      .trim()
      .min(1, `heading must be 1 to ${NOTIFICATION_HEADING_MAX} characters`)
      .max(NOTIFICATION_HEADING_MAX, `heading must be 1 to ${NOTIFICATION_HEADING_MAX} characters`),
    description: text("heading and description must be strings")
      .trim()
      .min(1, `description must be 1 to ${NOTIFICATION_DESCRIPTION_MAX} characters`)
      .max(NOTIFICATION_DESCRIPTION_MAX, `description must be 1 to ${NOTIFICATION_DESCRIPTION_MAX} characters`),
    link: optionalText("link must be a string or null").openapi({
      description: `An in-app path starting with "/" or an https:// URL, at most ${NOTIFICATION_LINK_MAX} characters.`,
    }),
    actionLabel: optionalText("actionLabel must be a string or null").openapi({
      description: `The link button's text, at most ${NOTIFICATION_ACTION_LABEL_MAX} characters; only with a link.`,
    }),
    audience: z.discriminatedUnion(
      "kind",
      [
        z.object({ kind: z.literal("all") }),
        z.object({ kind: z.literal("account"), accountId: audienceId("account") }),
        z.object({ kind: z.literal("user"), userId: audienceId("user") }),
      ],
      { errorMap: () => ({ message: NOTIFICATION_AUDIENCE_MESSAGE }) }
    ),
  })
  .transform((raw, ctx) => {
    const actionLabel = (raw.actionLabel ?? "").trim();
    const link = (raw.link ?? "").trim();
    const refuse = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    if (actionLabel.length > NOTIFICATION_ACTION_LABEL_MAX) {
      return refuse(`actionLabel must be at most ${NOTIFICATION_ACTION_LABEL_MAX} characters`);
    }
    if (link === "") {
      if (actionLabel !== "") {
        return refuse("actionLabel needs a link");
      }
      return { ...raw, link: null, actionLabel: null };
    }
    if (notificationLinkKind(link) === null) {
      return refuse(
        `link must be a path in the app starting with "/" or an https:// URL, at most ${NOTIFICATION_LINK_MAX} characters`
      );
    }
    return { ...raw, link, actionLabel: actionLabel === "" ? null : actionLabel };
  })
  .openapi("NotificationRequest");

const FLAG_KEY_MESSAGE = `key must be 1 to ${FEATURE_FLAG_KEY_MAX} characters: a lowercase word, then dot- or dash-separated words`;
const FLAG_TARGET_MAX = 100;
const FLAG_STATE_MESSAGE = 'state must be "off", "on" or "rules"';

const flagKey = (message: string) =>
  text(message)
    .trim()
    .refine(isFeatureFlagKey, message)
    .openapi({ description: "A lowercase word, then dot- or dash-separated words." });

const flagTargets = (field: "users" | "accounts" | "instances") =>
  z
    .array(text(`${field} must hold ids`).trim().regex(ID_SEGMENT, `${field} must hold ids`), {
      required_error: `${field} must be a list of at most ${FLAG_TARGET_MAX} ids`,
      invalid_type_error: `${field} must be a list of at most ${FLAG_TARGET_MAX} ids`,
    })
    .max(FLAG_TARGET_MAX, `${field} must be a list of at most ${FLAG_TARGET_MAX} ids`)
    .optional();

const featureFlagRulesRequestSchema = z
  .object({
    users: flagTargets("users"),
    accounts: flagTargets("accounts"),
    instances: flagTargets("instances"),
    percent: z
      .number({ invalid_type_error: "percent must be a number" })
      .optional()
      .openapi({ description: "A whole number from 0 to 100." }),
    hosting: z.enum(["managed", "external"], { message: 'hosting must be "managed" or "external"' }).optional(),
    entitlement: text("entitlement must name an entitlement feature")
      .trim()
      .min(1, "entitlement must name an entitlement feature")
      .optional()
      .openapi({ description: "A key of the entitlement catalog, as `featureFlags.list` returns it." }),
  })
  .transform((input, ctx) => {
    const rules: {
      users?: string[];
      accounts?: string[];
      instances?: string[];
      percent?: number;
      hosting?: "managed" | "external";
      entitlement?: string;
    } = {};
    for (const field of ["users", "accounts", "instances"] as const) {
      const ids = input[field];
      if (ids !== undefined && ids.length > 0) {
        rules[field] = ids;
      }
    }
    if (input.percent !== undefined) {
      rules.percent = input.percent;
    }
    if (input.hosting !== undefined) {
      rules.hosting = input.hosting;
    }
    if (input.entitlement !== undefined) {
      rules.entitlement = input.entitlement;
    }
    try {
      validateFeatureFlagRules(rules);
    } catch (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: (error as Error).message });
      return z.NEVER;
    }
    return Object.keys(rules).length === 0 ? undefined : rules;
  });

export const featureFlagRequestSchema = z
  .object({
    key: flagKey(FLAG_KEY_MESSAGE),
    description: text(`description must be 1 to ${FEATURE_FLAG_DESCRIPTION_MAX} characters`)
      .trim()
      .min(1, `description must be 1 to ${FEATURE_FLAG_DESCRIPTION_MAX} characters`)
      .max(FEATURE_FLAG_DESCRIPTION_MAX, `description must be at most ${FEATURE_FLAG_DESCRIPTION_MAX} characters`),
    owner: text(`owner must be 1 to ${FEATURE_FLAG_OWNER_MAX} characters`)
      .trim()
      .min(1, `owner must be 1 to ${FEATURE_FLAG_OWNER_MAX} characters`)
      .max(FEATURE_FLAG_OWNER_MAX, `owner must be at most ${FEATURE_FLAG_OWNER_MAX} characters`),
    removeBy: text("removeBy must be a date, YYYY-MM-DD")
      .trim()
      .openapi({ format: "date" })
      .refine(
        (value) => FLAG_DATE.test(value),
        (value) => ({
          message: `removeBy must be a date, YYYY-MM-DD, got "${value}"`,
        })
      ),
    state: z.enum(["off", "on", "rules"], { message: FLAG_STATE_MESSAGE }),
    rules: featureFlagRulesRequestSchema.optional().openapi({
      description: 'Required under state "rules" and refused otherwise.',
    }),
  })
  .transform((flag, ctx) => {
    const refuse = (message: string) => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    };
    try {
      validateFeatureFlagDefinition(flag);
    } catch (error) {
      return refuse((error as Error).message);
    }
    if (flag.state === "rules" && flag.rules === undefined) {
      return refuse('state "rules" needs at least one rule');
    }
    if (flag.state !== "rules" && flag.rules !== undefined) {
      return refuse(`state "${flag.state}" ignores rules; set state "rules" to target`);
    }
    return flag;
  })
  .openapi("FeatureFlagRequest", {
    description:
      "The whole definition: a create and an update carry the same shape; the key names the row. Unknown fields are ignored.",
  });

export const featureFlagKeyRequestSchema = z
  .object({ key: flagKey("key must name a feature flag") })
  .openapi("FeatureFlagKeyRequest");

const MAX_REWARD_CENTS = 1_000_000;
const REFERRAL_ACTOR_MAX = 200;
const REFERRAL_EMAIL_MAX = 320;
const REFERRAL_ACTOR_MESSAGE = `actor must be 1 to ${REFERRAL_ACTOR_MAX} characters`;
const REFERRAL_REWARD_MESSAGE = `rewardCents must be a positive integer of at most ${MAX_REWARD_CENTS}`;

const referralActor = text(REFERRAL_ACTOR_MESSAGE)
  .trim()
  .min(1, REFERRAL_ACTOR_MESSAGE)
  .max(REFERRAL_ACTOR_MAX, REFERRAL_ACTOR_MESSAGE)
  .openapi({ description: "The operator named on the code." });
const referralReward = z
  .number({ required_error: REFERRAL_REWARD_MESSAGE, invalid_type_error: REFERRAL_REWARD_MESSAGE })
  .int(REFERRAL_REWARD_MESSAGE)
  .positive(REFERRAL_REWARD_MESSAGE)
  .max(MAX_REWARD_CENTS, REFERRAL_REWARD_MESSAGE);

export const issueReferralCodeRequestSchema = z
  .object({
    email: text("email must be an email address")
      .transform((email) => normalizeEmail(email))
      .refine((email) => email.includes("@") && email.length <= REFERRAL_EMAIL_MAX, "email must be an email address")
      .openapi({ description: "The user the code is issued to; they must already have signed in." }),
    rewardCents: referralReward,
    actor: referralActor,
  })
  .openapi("IssueReferralCodeRequest");

export const updateReferralCodeRequestSchema = z
  .object({ rewardCents: referralReward, actor: referralActor })
  .openapi("UpdateReferralCodeRequest");

export const revokeReferralCodeRequestSchema = z.object({ actor: referralActor }).openapi("RevokeReferralCodeRequest");

const BILLING_LIMIT_ENTRIES_MESSAGE = "overrides.limits must be an object of amounts";
const BILLING_OVERRIDES_MESSAGE =
  "overrides needs addFeatures and removeFeatures as arrays of strings, and limits as an object";
const oneOf = <T extends readonly [string, ...string[]]>(values: T, message: string) => z.enum(values, { message });
const nullableTime = (field: string) =>
  z.union([wholeNumber(`${field} must be null or epoch milliseconds`), z.null()], {
    errorMap: () => ({ message: `${field} must be null or epoch milliseconds` }),
  });
const stringList = (message: string) => z.array(z.string(), { required_error: message, invalid_type_error: message });

/** The management plane's `OrgBillingProjection`, times in epoch milliseconds. */
export const billingProjectionRequestSchema = z
  .strictObject({
    accountId: text("accountId must be a non-empty string")
      .min(1, "accountId must be a non-empty string")
      .openapi({ description: "Must equal the account in the path." }),
    version: wholeNumber(`version must be a whole number from 1 to ${MAX_PROJECTION_VERSION}`)
      .min(1, `version must be a whole number from 1 to ${MAX_PROJECTION_VERSION}`)
      .max(MAX_PROJECTION_VERSION, `version must be a whole number from 1 to ${MAX_PROJECTION_VERSION}`),
    tier: z.union([oneOf(PLAN_TIERS, `tier must be null or one of ${PLAN_TIERS.join(", ")}`), z.null()], {
      errorMap: () => ({ message: `tier must be null or one of ${PLAN_TIERS.join(", ")}` }),
    }),
    addOns: stringList("addOns must be an array of strings").superRefine((keys, ctx) => {
      const unknown = keys.find((key) => !(key in ADD_ONS));
      if (unknown !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown add-on "${unknown}"; code must list it in ADD_ONS first`,
        });
      }
    }),
    standing: oneOf(SUBSCRIPTION_STATES, `standing must be one of ${SUBSCRIPTION_STATES.join(", ")}`),
    reason: z.union(
      [oneOf(LIFECYCLE_REASONS, `reason must be null or one of ${LIFECYCLE_REASONS.join(", ")}`), z.null()],
      {
        errorMap: () => ({ message: `reason must be null or one of ${LIFECYCLE_REASONS.join(", ")}` }),
      }
    ),
    trialEndsAt: nullableTime("trialEndsAt"),
    graceEndsAt: nullableTime("graceEndsAt"),
    periodEnd: nullableTime("periodEnd"),
    interval: z.union(
      [oneOf(BILLING_INTERVALS, `interval must be null or one of ${BILLING_INTERVALS.join(", ")}`), z.null()],
      {
        errorMap: () => ({ message: `interval must be null or one of ${BILLING_INTERVALS.join(", ")}` }),
      }
    ),
    exemptUntil: nullableTime("exemptUntil"),
    spinDownAt: nullableTime("spinDownAt"),
    hasProviderSubscription: z.boolean({
      required_error: "hasProviderSubscription must be a boolean",
      invalid_type_error: "hasProviderSubscription must be a boolean",
    }),
    discount: z.union([z.strictObject({ label: z.string() }), z.null()], {
      errorMap: () => ({ message: "discount must be null or { label: string }" }),
    }),
    overrides: z
      .object(
        {
          addFeatures: stringList(BILLING_OVERRIDES_MESSAGE),
          removeFeatures: stringList(BILLING_OVERRIDES_MESSAGE),
          limits: z.record(
            z.string(),
            z.union([z.number(), z.null()], {
              errorMap: (issue) => ({
                message: `limit "${String(issue.path.at(-1))}" must be a number, or null for unlimited`,
              }),
            }),
            { errorMap: () => ({ message: BILLING_LIMIT_ENTRIES_MESSAGE }) }
          ),
        },
        { errorMap: () => ({ message: BILLING_OVERRIDES_MESSAGE }) }
      )
      .transform((overrides, ctx) => {
        const limits = Object.entries(overrides.limits).map(([key, value]) => ({ key, value }));
        try {
          validateEntitlementInput({
            features: overrides.addFeatures,
            removeFeatures: overrides.removeFeatures,
            limits,
          });
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : "invalid overrides",
          });
          return z.NEVER;
        }
        return { addFeatures: overrides.addFeatures, removeFeatures: overrides.removeFeatures, limits };
      }),
  })
  .superRefine((projection, ctx) => {
    const need = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (projection.standing === "suspended" && projection.reason === null) {
      need("a suspended standing needs a reason");
    }
    if (projection.standing === "past_due" && projection.graceEndsAt === null) {
      need("a past_due standing needs graceEndsAt");
    }
    if (projection.standing === "trialing" && projection.trialEndsAt === null) {
      need("a trialing standing needs trialEndsAt");
    }
  })
  .openapi("BillingProjectionRequest", {
    description:
      "Unknown fields are refused, so Convex must learn a field before the plane sends it. `overrides.limits` is an object of amounts; null is unlimited.",
  });

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export interface OpsRouteSpec {
  /** The route's name: its operationId, and what a caller's scope lists. */
  name: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  /** Under OPS_PATH_PREFIX; `{name}` is one path segment. */
  path: string;
  summary: string;
  /** Path parameters that are not a plain id. */
  params?: Record<string, z.ZodTypeAny>;
  query?: z.AnyZodObject;
  body?: z.ZodTypeAny;
  /** The `data` of the success answer. */
  response: z.ZodTypeAny;
  /** Status of the success answer; 200 unless stated. */
  successStatus?: 200 | 201;
  /** Status to the codes the route itself can answer, besides the authentication ones every route can. */
  errors?: Record<number, readonly string[]>;
}

const pageQuery = z.object({
  cursor: z.string().optional().openapi({ description: "The `cursor` of the previous page." }),
});
const searchQuery = pageQuery.extend({
  q: z.string().optional().openapi({ description: "What to search for." }),
});

export const OPS_ROUTES = [
  {
    name: "users.list",
    method: "GET",
    path: "/api/ops/users",
    summary: "Users, newest first. `q` is an email address exactly, a Twitch user id exactly, or words of the name.",
    query: searchQuery,
    response: pageOf("UserPage", userDtoSchema),
  },
  {
    name: "users.get",
    method: "GET",
    path: "/api/ops/users/{userId}",
    summary: "A user, their account and instance memberships, and how many sessions are active. Audited.",
    response: userDetailDtoSchema,
    errors: { 404: ["not_found"] },
  },
  {
    name: "accounts.list",
    method: "GET",
    path: "/api/ops/accounts",
    summary: "Accounts with owner, member count, plan and managed engine count; `q` searches the name.",
    query: searchQuery,
    response: pageOf("AccountPage", accountSummaryDtoSchema),
  },
  {
    name: "accounts.get",
    method: "GET",
    path: "/api/ops/accounts/{accountId}",
    summary:
      "An account, its members, pending invitations, resolved entitlements, instances and each instance's provisioning. Audited.",
    response: accountDetailDtoSchema,
    errors: { 404: ["not_found"] },
  },
  {
    name: "accounts.referral",
    method: "GET",
    path: "/api/ops/accounts/{accountId}/referral",
    summary: "Who referred the org's owner, or 404 when the owner arrived without a valid referral link. Audited.",
    response: referralDtoSchema,
    errors: { 404: ["not_found"] },
  },
  {
    name: "engines.list",
    method: "GET",
    path: "/api/ops/engines",
    summary: "Every engine provisioning row, or those in one status, for drift checks against the maintenance API.",
    query: pageQuery.extend({ status: provisioningStatusSchema.optional() }),
    response: pageOf("ProvisioningPage", provisioningDtoSchema),
    errors: { 400: ["invalid_status"] },
  },
  {
    name: "engines.moduleStorageLimits",
    method: "GET",
    path: "/api/ops/engines/module-storage-limits",
    summary:
      "Each managed engine's module storage limit after its override, by maintenance engine id. A page may hold fewer rows than its size: engines without a maintenance id or hosted elsewhere are skipped.",
    query: pageQuery,
    response: pageOf("ModuleStorageLimitPage", moduleStorageLimitDtoSchema),
  },
  {
    name: "engines.eventPath",
    method: "GET",
    path: "/api/ops/engines/event-path",
    summary: "Which route each registered engine posts its events to.",
    query: pageQuery,
    response: pageOf("EngineEventPathPage", engineEventPathDtoSchema),
  },
  {
    name: "engines.byMaintenanceId",
    method: "GET",
    path: "/api/ops/engines/by-maintenance-id/{engineId}",
    summary: "One managed engine's provisioning row, instance, account and hosted storage limits.",
    response: engineDetailDtoSchema,
    errors: { 404: ["not_found"] },
  },
  {
    name: "instances.health",
    method: "GET",
    path: "/api/ops/instances/{instanceId}/health",
    summary: "Live state, sync state, recent alerts and failing workflows.",
    response: instanceHealthDtoSchema,
    errors: { 404: ["not_found"] },
  },
  {
    name: "audit.list",
    method: "GET",
    path: "/api/ops/audit",
    summary: "The audit log, newest first, for one operator or one target, not both.",
    query: pageQuery.extend({ actor: z.string().optional(), target: z.string().optional() }),
    response: pageOf("AuditEntryPage", auditEntryDtoSchema),
    errors: { 400: ["one_filter"] },
  },
  {
    name: "notifications.list",
    method: "GET",
    path: "/api/ops/notifications",
    summary: "Notifications, newest first.",
    query: pageQuery,
    response: pageOf("NotificationPage", notificationDtoSchema),
  },
  {
    name: "featureFlags.list",
    method: "GET",
    path: "/api/ops/feature-flags",
    summary: "Every UI feature flag with its targeting, and the entitlements a rule may name.",
    response: featureFlagCatalogDtoSchema,
  },
  {
    name: "referralCodes.list",
    method: "GET",
    path: "/api/ops/referral-codes",
    summary: "Referral codes, newest first.",
    query: pageQuery,
    response: referralCodePageSchema,
  },
  {
    name: "referralCodes.issue",
    method: "POST",
    path: "/api/ops/referral-codes",
    summary: "Issues a code to the user with the given email.",
    body: issueReferralCodeRequestSchema,
    response: referralCodeDtoSchema,
    successStatus: 201,
    errors: { 400: ["validation_failed"], 404: ["user_not_found"], 409: ["code_exists"] },
  },
  {
    name: "referralCodes.update",
    method: "PATCH",
    path: "/api/ops/referral-codes/{code}",
    summary: "Changes a code's reward.",
    body: updateReferralCodeRequestSchema,
    response: referralCodeDtoSchema,
    errors: { 400: ["validation_failed"], 404: ["not_found"], 409: ["code_revoked"] },
  },
  {
    name: "referralCodes.revoke",
    method: "POST",
    path: "/api/ops/referral-codes/{code}/revoke",
    summary: "Revokes a code.",
    body: revokeReferralCodeRequestSchema,
    response: referralCodeDtoSchema,
    errors: { 400: ["validation_failed"], 404: ["not_found"], 409: ["code_revoked"] },
  },
  {
    name: "engines.act",
    method: "POST",
    path: "/api/ops/engines/{instanceId}/{action}",
    summary: "An operator's upgrade, retry or delete of a customer's managed engine, exactly as the customer could.",
    params: { action: engineActionSchema },
    response: engineActionResultSchema,
    errors: { 404: ["not_found"], 409: ["refused"], 502: ["maintenance_error"] },
  },
  {
    name: "instances.setStorageLimits",
    method: "POST",
    path: "/api/ops/instances/{instanceId}/storage-limits",
    summary: "Replaces a managed engine's hosted storage override.",
    body: storageLimitsRequestSchema,
    response: hostedStorageLimitsDtoSchema,
    errors: { 400: ["invalid_storage_limits"], 404: ["not_found"], 409: ["not_managed"] },
  },
  {
    name: "notifications.create",
    method: "POST",
    path: "/api/ops/notifications",
    summary: "Creates a notification; a repeated `requestId` answers the one already created.",
    body: notificationRequestSchema,
    response: notificationDtoSchema,
    errors: { 400: ["invalid_notification"], 404: ["not_found"] },
  },
  {
    name: "notifications.delete",
    method: "POST",
    path: "/api/ops/notifications/{notificationId}/delete",
    summary: "Deletes a notification.",
    response: z.object({ id: z.string() }),
    errors: { 404: ["not_found"] },
  },
  {
    name: "featureFlags.create",
    method: "POST",
    path: "/api/ops/feature-flags",
    summary: "Creates a flag.",
    body: featureFlagRequestSchema,
    response: featureFlagDtoSchema,
    errors: { 400: ["invalid_feature_flag", "unknown_target"], 409: ["already_exists"] },
  },
  {
    name: "featureFlags.remove",
    method: "POST",
    path: "/api/ops/feature-flags/delete",
    summary: "Deletes the flag the body names. The key travels in the body because keys contain dots.",
    body: featureFlagKeyRequestSchema,
    response: z.object({ key: z.string() }),
    errors: { 400: ["invalid_feature_flag"], 404: ["not_found"] },
  },
  {
    name: "featureFlags.update",
    method: "PUT",
    path: "/api/ops/feature-flags",
    summary: "Retargets the flag the body names, with the same shape and refusals as a create.",
    body: featureFlagRequestSchema,
    response: featureFlagDtoSchema,
    errors: { 400: ["invalid_feature_flag", "unknown_target"], 404: ["not_found"] },
  },
  {
    name: "accounts.billingProjection",
    method: "POST",
    path: "/api/ops/accounts/{accountId}/billing-projection",
    summary:
      "Stores the management plane's billing projection unless an equal or newer version is held (`applied: false`).",
    body: billingProjectionRequestSchema,
    response: z.object({ applied: z.boolean(), version: z.number().int() }),
    errors: { 400: ["invalid_billing_projection"], 404: ["not_found"], 409: ["version_conflict"] },
  },
  {
    name: "accounts.billingProjectionReset",
    method: "POST",
    path: "/api/ops/accounts/{accountId}/billing-projection-reset",
    summary: "Sets the stored projection version back to 0 so the plane's next push is applied.",
    response: z.object({ previousVersion: z.number().int(), version: z.literal(0) }),
    errors: { 404: ["not_found", "no_projection"] },
  },
] as const satisfies readonly OpsRouteSpec[];

/**
 * Throws unless the table is consistent: a route's name is its scope name and
 * operationId, so names must be unique; a request names one route by method
 * and path, so those must be unique too; and every path parameter is named once.
 */
export function validateOpsRoutes(routes: readonly OpsRouteSpec[]): void {
  const names = new Set<string>();
  const endpoints = new Set<string>();
  for (const route of routes) {
    if (route.name === "" || names.has(route.name)) {
      throw new Error(`ops route name "${route.name}" is empty or used twice`);
    }
    names.add(route.name);
    const endpoint = `${route.method} ${route.path}`;
    if (!route.path.startsWith(OPS_PATH_PREFIX) || endpoints.has(endpoint)) {
      throw new Error(`ops route ${route.name}: "${endpoint}" is outside ${OPS_PATH_PREFIX} or used twice`);
    }
    endpoints.add(endpoint);
    if (route.response === undefined) {
      throw new Error(`ops route ${route.name} has no response schema`);
    }
    const params = [...route.path.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "");
    if (params.some((param) => !/^\w+$/.test(param)) || new Set(params).size !== params.length) {
      throw new Error(`ops route ${route.name}: path "${route.path}" has an unnamed or repeated parameter`);
    }
    for (const param of Object.keys(route.params ?? {})) {
      if (!params.includes(param)) {
        throw new Error(`ops route ${route.name} gives a schema to "${param}", which its path does not name`);
      }
    }
  }
}

validateOpsRoutes(OPS_ROUTES);

export type OpsRouteName = (typeof OPS_ROUTES)[number]["name"];

type PathParamNames<Path extends string> = Path extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PathParamNames<Rest>
  : never;

type PathParamValue<Spec, Name extends string> = Spec extends { params: infer P }
  ? Name extends keyof P
    ? P[Name] extends z.ZodType<infer Value>
      ? Value
      : string
    : string
  : string;

/** A matched request: the route's name and method, and each path parameter by name. */
export type OpsRoute = {
  [Spec in (typeof OPS_ROUTES)[number] as Spec["name"]]: {
    method: Spec["method"];
    name: Spec["name"];
  } & { [Name in PathParamNames<Spec["path"]>]: PathParamValue<Spec, Name> };
}[OpsRouteName];

// ---------------------------------------------------------------------------
// The OpenAPI document
// ---------------------------------------------------------------------------

const errorEnvelopeSchema = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi("ErrorEnvelope");

const AUTH_ERRORS: Record<number, readonly string[]> = {
  400: ["actor_required", "invalid_reason", "reason_too_long"],
  401: ["unauthorized"],
  403: ["forbidden_route"],
};

export function isWriteRoute(spec: Pick<OpsRouteSpec, "method">): boolean {
  return spec.method !== "GET";
}

/** The codes a route can answer under each status, the authentication ones included. */
export function routeErrors(spec: OpsRouteSpec): Record<number, string[]> {
  const merged: Record<number, string[]> = {};
  const sources = [AUTH_ERRORS, isWriteRoute(spec) ? { 400: ["reason_required"] } : {}, spec.errors ?? {}];
  for (const source of sources) {
    for (const [status, codes] of Object.entries(source)) {
      merged[Number(status)] = [...(merged[Number(status)] ?? []), ...codes];
    }
  }
  return merged;
}

const bearerAuth = "bearerAuth";

export function buildOpsOpenApi(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", bearerAuth, {
    type: "http",
    scheme: "bearer",
    description:
      "A per-caller secret of at least 43 characters. Each caller may use only the routes in its scope; any other route answers 403.",
  });
  registry.register("ErrorEnvelope", errorEnvelopeSchema);

  for (const spec of OPS_ROUTES as readonly OpsRouteSpec[]) {
    const params = Object.fromEntries(
      [...spec.path.matchAll(/\{(\w+)\}/g)].map(([, name = ""]) => [name, spec.params?.[name] ?? idSegment])
    );
    const headers: Record<string, z.ZodTypeAny> = {
      "X-Woofx3-Actor": z.string().min(1).max(320).openapi({ description: "The operator the caller acts for." }),
    };
    if (isWriteRoute(spec)) {
      headers["X-Woofx3-Reason"] = z
        .string()
        .min(1)
        .openapi({ description: "Why, as percent-encoded UTF-8 (encodeURIComponent), at most 500 characters." });
    }
    const errors = Object.fromEntries(
      Object.entries(routeErrors(spec)).map(([status, codes]) => [
        status,
        {
          description: `Error codes: ${codes.join(", ")}.`,
          content: { "application/json": { schema: errorEnvelopeSchema } },
        },
      ])
    );
    registry.registerPath({
      operationId: spec.name,
      method: spec.method.toLowerCase() as "get" | "post" | "put" | "patch",
      path: spec.path,
      summary: spec.summary,
      security: [{ [bearerAuth]: [] }],
      request: {
        params: z.object(params),
        ...(spec.query ? { query: spec.query } : {}),
        headers: z.object(headers),
        ...(spec.body ? { body: { required: true, content: { "application/json": { schema: spec.body } } } } : {}),
      },
      responses: {
        [spec.successStatus ?? 200]: {
          description: "The result, under `data`.",
          content: { "application/json": { schema: z.object({ data: spec.response }) } },
        },
        ...errors,
      },
    });
  }

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "woofx3 ops API",
      version: OPS_API_VERSION,
      description:
        "What the internal backoffice reads about users, accounts and engines, and what the maintenance billing process pushes. Servers call it with a per-caller secret; it sends no CORS headers.",
    },
  });
  return dropRepeatedAlternatives(document) as Record<string, unknown>;
}

/** The generator lists `null` twice for a union that includes z.null(); a repeated alternative adds nothing. */
function dropRepeatedAlternatives(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(dropRepeatedAlternatives);
  }
  if (node === null || typeof node !== "object") {
    return node;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    const mapped = dropRepeatedAlternatives(child);
    if (key === "anyOf" && Array.isArray(mapped)) {
      const seen = new Set<string>();
      copy[key] = mapped.filter((alternative) => {
        const text = JSON.stringify(alternative);
        return seen.has(text) ? false : (seen.add(text), true);
      });
    } else {
      copy[key] = mapped;
    }
  }
  return copy;
}
