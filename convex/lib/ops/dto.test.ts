import { describe, expect, it } from "bun:test";
import type { Doc } from "../../_generated/dataModel";
import {
  accountSummaryDto,
  FORBIDDEN_RESPONSE_KEYS,
  instanceDto,
  invitationDto,
  planSummaryDto,
  provisioningDto,
  userDto,
} from "./dto";

const SECRET = "SECRET-VALUE-must-not-leak";

/** Every key at any depth, and every string value, of a response. */
function walk(value: unknown, keys: Set<string>, strings: Set<string>): void {
  if (typeof value === "string") {
    strings.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, keys, strings);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      walk(child, keys, strings);
    }
  }
}

function expectNoSecrets(response: unknown): void {
  const keys = new Set<string>();
  const strings = new Set<string>();
  walk(response, keys, strings);
  for (const key of keys) {
    expect(FORBIDDEN_RESPONSE_KEYS.has(key)).toBe(false);
  }
  for (const value of strings) {
    expect(value.includes(SECRET)).toBe(false);
  }
}

// Documents with every secret-bearing field filled in.
const user = { _id: "u1", _creationTime: 1, email: "a@example.com", name: "A" } as unknown as Doc<"users">;
const authAccount = {
  _id: "aa1",
  _creationTime: 1,
  userId: "u1",
  provider: "twitch",
  providerAccountId: "123",
  secret: SECRET,
  emailVerified: SECRET,
} as unknown as Doc<"authAccounts">;
const session = { _id: "s1", _creationTime: 5, userId: "u1", expirationTime: 10 } as unknown as Doc<"authSessions">;
const instance = {
  _id: "i1",
  _creationTime: 1,
  accountId: "k1",
  name: "Main",
  url: "https://engine.example.com",
  clientId: SECRET,
  clientSecret: SECRET,
  webhookSecret: SECRET,
  hosting: "managed",
  createdAt: 1,
} as unknown as Doc<"instances">;
const invitation = {
  _id: "v1",
  _creationTime: 1,
  accountId: "k1",
  email: "b@example.com",
  role: "member",
  token: SECRET,
  invitedByUserId: "u1",
  status: "pending",
  expiresAt: 9,
  createdAt: 1,
} as unknown as Doc<"invitations">;
const provisioning = {
  _id: "p1",
  _creationTime: 1,
  instanceId: "i1",
  accountId: "k1",
  requestedBy: "u1",
  slug: "main",
  status: "registered",
  steps: [{ key: "boot", label: "Boot", status: "succeeded" }],
  registrationToken: SECRET,
  upgrade: {
    fromVersion: "1",
    toVersion: "2",
    requestedBy: "u1",
    startedAt: 1,
    attempt: 1,
    rollingBack: false,
  },
} as unknown as Doc<"engineProvisioning">;
const account = {
  _id: "k1",
  _creationTime: 1,
  name: "Acme",
  ownerId: "u1",
  createdAt: 1,
} as unknown as Doc<"accounts">;
const entitlements = { plan: { key: "free", name: "Free" }, features: [], limits: {} };

describe("ops DTOs", () => {
  it("never carry a secret, whatever the documents hold", () => {
    expectNoSecrets([
      userDto(user, [authAccount], session),
      instanceDto(instance),
      invitationDto(invitation),
      provisioningDto(provisioning),
      accountSummaryDto(account, user, 2, entitlements, 1),
      planSummaryDto(entitlements),
    ]);
  });

  it("keep what the backoffice needs", () => {
    expect(userDto(user, [authAccount], session)).toEqual({
      id: "u1",
      email: "a@example.com",
      name: "A",
      providers: [{ provider: "twitch", providerAccountId: "123" }],
      createdAt: 1,
      lastSessionAt: 5,
    });
    expect(provisioningDto(provisioning).upgrade?.toVersion).toBe("2");
  });
});
