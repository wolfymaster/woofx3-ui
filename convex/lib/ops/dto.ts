import type { Doc } from "../../_generated/dataModel";
import type { Entitlements } from "../entitlements";

/**
 * What the ops API returns. Every response is built field by field from
 * these, never by spreading a document, so a secret added to a table later
 * cannot reach the backoffice without someone writing it here. Never
 * returned: registration tokens, instance client secrets and webhook
 * secrets, invitation tokens, OAuth and platform tokens, session tokens,
 * and anything in authAccounts beyond the provider and its account id.
 */

export interface UserDto {
  id: string;
  email: string | null;
  name: string | null;
  providers: { provider: string; providerAccountId: string }[];
  createdAt: number;
  lastSessionAt: number | null;
}

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

export interface UserRefDto {
  id: string;
  email: string | null;
  name: string | null;
}

export function userRefDto(user: Doc<"users">): UserRefDto {
  return { id: user._id, email: user.email ?? null, name: user.name ?? null };
}

export interface PlanSummaryDto {
  plan: { key: string; name: string } | null;
  features: string[];
  limits: Record<string, number | null>;
  expiresAt: number | null;
}

export function planSummaryDto(entitlements: Entitlements): PlanSummaryDto {
  return {
    plan: entitlements.plan ? { key: entitlements.plan.key, name: entitlements.plan.name } : null,
    features: [...entitlements.features],
    limits: { ...entitlements.limits },
    expiresAt: entitlements.expiresAt ?? null,
  };
}

export interface AccountSummaryDto {
  id: string;
  name: string;
  owner: UserRefDto | null;
  memberCount: number;
  plan: { key: string; name: string } | null;
  managedEngineCount: number;
  createdAt: number;
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

export interface InvitationDto {
  id: string;
  email: string | null;
  platformLogin: string | null;
  role: string;
  status: string;
  expiresAt: number;
  createdAt: number;
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

export interface InstanceDto {
  id: string;
  accountId: string;
  name: string;
  url: string;
  hosting: "managed" | "external";
  createdAt: number;
  lastViewedAt: number | null;
  lastEngineActivityAt: number | null;
  companionHostname: string | null;
  marketplaceDevAccess: boolean;
}

export function instanceDto(instance: Doc<"instances">): InstanceDto {
  return {
    id: instance._id,
    accountId: instance.accountId,
    name: instance.name,
    url: instance.url,
    hosting: instance.hosting ?? "external",
    createdAt: instance.createdAt,
    lastViewedAt: instance.lastViewedAt ?? null,
    lastEngineActivityAt: instance.lastEngineActivityAt ?? null,
    companionHostname: instance.companionHostname ?? null,
    marketplaceDevAccess: instance.marketplaceDevAccess ?? false,
  };
}

export interface ProvisioningDto {
  id: string;
  instanceId: string;
  accountId: string;
  maintenanceEngineId: string | null;
  runId: string | null;
  slug: string;
  status: Doc<"engineProvisioning">["status"];
  steps: { key: string; label: string; status: string; error: string | null; detail: string | null }[];
  publicUrl: string | null;
  reportedVersion: string | null;
  error: string | null;
  registrationAttempts: number;
  upgrade: {
    fromVersion: string;
    toVersion: string;
    startedAt: number;
    attempt: number;
    rollingBack: boolean;
    outcome: string | null;
    error: string | null;
    acknowledged: boolean;
  } | null;
  createdAt: number;
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

export interface AuditEntryDto {
  id: string;
  actor: string;
  action: string;
  target: string;
  reason: string | null;
  request: string | null;
  result: string;
  at: number;
}

export function auditEntryDto(entry: Doc<"opsAuditLog">): AuditEntryDto {
  return {
    id: entry._id,
    actor: entry.actor,
    action: entry.action,
    target: entry.target,
    reason: entry.reason ?? null,
    request: entry.request ?? null,
    result: entry.result,
    at: entry.at,
  };
}

export interface NotificationDto {
  id: string;
  heading: string;
  description: string;
  link: string | null;
  actionLabel: string | null;
  audience: { kind: "all" } | { kind: "account"; accountId: string } | { kind: "user"; userId: string };
  recipients: number;
  delivering: boolean;
  createdBy: string;
  createdAt: number;
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
