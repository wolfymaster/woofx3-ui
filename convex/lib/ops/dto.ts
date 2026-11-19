import type { z } from "zod";
import type { Doc } from "../../_generated/dataModel";
import type { Entitlements } from "../entitlements";
import type {
  accountDetailDtoSchema,
  accountSummaryDtoSchema,
  auditEntryDtoSchema,
  engineDetailDtoSchema,
  engineEventPathDtoSchema,
  featureFlagCatalogDtoSchema,
  featureFlagDtoSchema,
  featureFlagRulesDtoSchema,
  hostedStorageLimitsDtoSchema,
  instanceDtoSchema,
  instanceHealthDtoSchema,
  invitationDtoSchema,
  moduleStorageLimitDtoSchema,
  notificationDtoSchema,
  planSummaryDtoSchema,
  provisioningDtoSchema,
  userDetailDtoSchema,
  userDtoSchema,
  userRefDtoSchema,
} from "./contract";

/**
 * What the ops API returns. Every response is built field by field from
 * the contract's schemas (contract.ts), never by spreading a document, so a secret added to a table later
 * cannot reach the backoffice without someone writing it here. Never
 * returned: registration tokens, instance client secrets and webhook
 * secrets, invitation tokens, OAuth and platform tokens, session tokens,
 * and anything in authAccounts beyond the provider and its account id.
 */

export type UserDto = z.infer<typeof userDtoSchema>;
export type UserRefDto = z.infer<typeof userRefDtoSchema>;
export type PlanSummaryDto = z.infer<typeof planSummaryDtoSchema>;
export type AccountSummaryDto = z.infer<typeof accountSummaryDtoSchema>;
export type InvitationDto = z.infer<typeof invitationDtoSchema>;
export type InstanceDto = z.infer<typeof instanceDtoSchema>;
export type ProvisioningDto = z.infer<typeof provisioningDtoSchema>;
export type AuditEntryDto = z.infer<typeof auditEntryDtoSchema>;
export type NotificationDto = z.infer<typeof notificationDtoSchema>;
export type FeatureFlagRulesDto = z.infer<typeof featureFlagRulesDtoSchema>;
export type FeatureFlagDto = z.infer<typeof featureFlagDtoSchema>;
export type FeatureFlagCatalogDto = z.infer<typeof featureFlagCatalogDtoSchema>;
export type UserDetailDto = z.infer<typeof userDetailDtoSchema>;
export type AccountDetailDto = z.infer<typeof accountDetailDtoSchema>;
export type EngineDetailDto = z.infer<typeof engineDetailDtoSchema>;
export type ModuleStorageLimitDto = z.infer<typeof moduleStorageLimitDtoSchema>;
export type EngineEventPathDto = z.infer<typeof engineEventPathDtoSchema>;
export type InstanceHealthDto = z.infer<typeof instanceHealthDtoSchema>;
export type HostedStorageLimitsDto = z.infer<typeof hostedStorageLimitsDtoSchema>;

export function userDto(
  user: Doc<"users">,
  authAccounts: readonly Doc<"authAccounts">[],
  lastSession: Doc<"authSessions"> | null
): UserDto {
  return {
    id: user._id,
    email: user.email ?? null,
    name: user.name ?? null,
    providers: authAccounts.map((account) => ({
      provider: account.provider,
      providerAccountId: account.providerAccountId,
    })),
    createdAt: user._creationTime,
    lastSessionAt: lastSession?._creationTime ?? null,
  };
}

export function userRefDto(user: Doc<"users">): UserRefDto {
  return { id: user._id, email: user.email ?? null, name: user.name ?? null };
}

export function planSummaryDto(entitlements: Entitlements): PlanSummaryDto {
  return {
    plan: entitlements.plan ? { key: entitlements.plan.key, name: entitlements.plan.name } : null,
    features: [...entitlements.features],
    limits: { ...entitlements.limits },
  };
}

export function accountSummaryDto(
  account: Doc<"accounts">,
  owner: Doc<"users"> | null,
  memberCount: number,
  entitlements: Entitlements,
  managedEngineCount: number
): AccountSummaryDto {
  return {
    id: account._id,
    name: account.name,
    owner: owner ? userRefDto(owner) : null,
    memberCount,
    plan: entitlements.plan ? { key: entitlements.plan.key, name: entitlements.plan.name } : null,
    managedEngineCount,
    createdAt: account.createdAt,
  };
}

export function invitationDto(invitation: Doc<"invitations">): InvitationDto {
  return {
    id: invitation._id,
    email: invitation.email ?? null,
    platformLogin: invitation.platformLogin ?? null,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    createdAt: invitation.createdAt,
  };
}

export function instanceDto(instance: Doc<"instances">): InstanceDto {
  return {
    id: instance._id,
    accountId: instance.accountId,
    name: instance.name,
    url: instance.url,
    hosting: instance.hosting ?? "external",
    createdAt: instance.createdAt,
    lastEngineActivityAt: instance.lastEngineActivityAt ?? null,
    companionHostname: instance.companionHostname ?? null,
    marketplaceDevAccess: instance.marketplaceDevAccess ?? false,
  };
}

export function provisioningDto(row: Doc<"engineProvisioning">): ProvisioningDto {
  return {
    id: row._id,
    instanceId: row.instanceId,
    accountId: row.accountId,
    maintenanceEngineId: row.maintenanceEngineId ?? null,
    runId: row.runId ?? null,
    slug: row.slug,
    status: row.status,
    steps: row.steps.map((step) => ({
      key: step.key,
      label: step.label,
      status: step.status,
      error: step.error ?? null,
      detail: step.detail ?? null,
    })),
    publicUrl: row.publicUrl ?? null,
    reportedVersion: row.reportedVersion ?? null,
    error: row.error ?? null,
    registrationAttempts: row.registrationAttempts ?? 0,
    upgrade: row.upgrade
      ? {
          fromVersion: row.upgrade.fromVersion,
          toVersion: row.upgrade.toVersion,
          startedAt: row.upgrade.startedAt,
          attempt: row.upgrade.attempt,
          rollingBack: row.upgrade.rollingBack,
          outcome: row.upgrade.outcome ?? null,
          error: row.upgrade.error ?? null,
          acknowledged: row.upgrade.acknowledged ?? false,
        }
      : null,
    createdAt: row._creationTime,
  };
}

export function auditEntryDto(entry: Doc<"opsAuditLog">): AuditEntryDto {
  return {
    id: entry._id,
    caller: entry.caller ?? null,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    reason: entry.reason ?? null,
    request: entry.request ?? null,
    result: entry.result,
    at: entry.at,
  };
}

export function notificationDto(notification: Doc<"notifications">): NotificationDto {
  return {
    id: notification._id,
    heading: notification.heading,
    description: notification.description,
    link: notification.link ?? null,
    actionLabel: notification.actionLabel ?? null,
    audience: notification.audience,
    recipients: notification.recipients,
    delivering: notification.delivering,
    createdBy: notification.createdBy,
    createdAt: notification._creationTime,
  };
}

export function featureFlagDto(row: Doc<"featureFlags">, today: string): FeatureFlagDto {
  return {
    key: row.key,
    description: row.description,
    owner: row.owner,
    removeBy: row.removeBy,
    state: row.state,
    rules: {
      users: [...(row.rules?.users ?? [])],
      accounts: [...(row.rules?.accounts ?? [])],
      instances: [...(row.rules?.instances ?? [])],
      percent: row.rules?.percent ?? null,
      hosting: row.rules?.hosting ?? null,
      entitlement: row.rules?.entitlement ?? null,
    },
    overdue: row.removeBy < today,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

/** Keys no ops response may contain, at any depth. The DTO test walks every response against these. */
export const FORBIDDEN_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  "registrationToken",
  "clientSecret",
  "webhookSecret",
  "token",
  "accessToken",
  "refreshToken",
  "sealedAccessToken",
  "sealedRefreshToken",
  "secret",
  "emailVerified",
  "sessionId",
  "clientId",
]);
