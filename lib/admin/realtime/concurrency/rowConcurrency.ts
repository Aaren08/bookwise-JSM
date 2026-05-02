import "server-only";

import { auth } from "@/auth";
import redis from "@/database/redis";
import { db } from "@/database/drizzle";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import {
  ADMIN_ROW_LOCKS_CHANNEL,
  type AdminRealtimeEntity,
  type AdminRealtimeEvent,
  type AdminRealtimeMutationType,
  type AdminRowLock,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

export const ROW_LOCK_TTL_MS = 60_000;
export const ROW_LOCK_HEARTBEAT_MS = 20_000;
export const CONFLICT_ERROR_MESSAGE = "Update skipped — newer changes detected";

type AdminActor = {
  id: string;
  name: string;
};

// ─── Lua Scripts ────────────────────────────────────────────────────────────

const ACQUIRE_SCRIPT = `
  local key     = KEYS[1]
  local payload = ARGV[1]
  local ttl     = tonumber(ARGV[2])
  local adminId = ARGV[3]
  local newExpiry = ARGV[4]

  local current = redis.call('GET', key)

  if not current then
    redis.call('SET', key, payload, 'PX', ttl)
    return payload
  end

  local ok, decoded = pcall(cjson.decode, current)
  if not ok then
    redis.call('SET', key, payload, 'PX', ttl)
    return payload
  end

  if decoded.adminId == adminId then
    -- Re-entrant: refresh TTL, keep same token, bump version
    decoded.expiresAt = newExpiry
    decoded.version   = (decoded.version or 0) + 1
    local updated = cjson.encode(decoded)
    redis.call('SET', key, updated, 'PX', ttl)
    return updated
  end

  return current
`;

const HEARTBEAT_SCRIPT = `
  local key     = KEYS[1]
  local adminId = ARGV[1]
  local token   = ARGV[2]
  local ttl     = tonumber(ARGV[3])
  local newExpiry = ARGV[4]

  local current = redis.call('GET', key)
  if not current then return 0 end

  local ok, decoded = pcall(cjson.decode, current)
  if not ok then return 0 end

  if decoded.adminId ~= adminId or decoded.token ~= token then return 0 end

  decoded.expiresAt = newExpiry
  decoded.version   = (decoded.version or 0) + 1
  redis.call('SET', key, cjson.encode(decoded), 'PX', ttl)
  return 1
`;

// compare-and-delete: requires BOTH adminId AND token, rejects empty guards
const RELEASE_SCRIPT = `
  local key     = KEYS[1]
  local adminId = ARGV[1]
  local token   = ARGV[2]

  if adminId == '' or token == '' then
    return {'ERR', 'missing_identity'}
  end

  local current = redis.call('GET', key)
  if not current then return {'OK', 'already_gone'} end

  local ok, decoded = pcall(cjson.decode, current)
  if not ok then
    redis.call('DEL', key)
    return {'OK', 'corrupt_deleted'}
  end

  if decoded.adminId ~= adminId then return {'ERR', 'wrong_owner'} end
  if decoded.token   ~= token   then return {'ERR', 'token_mismatch'} end

  redis.call('DEL', key)
  return {'OK', 'released'}
`;

const getLockKey = (entity: AdminRealtimeEntity, entityId: string) =>
  `lock:${entity}:${entityId}`;

const parseLock = (
  value: unknown,
  entity: AdminRealtimeEntity,
  entityId: string,
) => {
  if (!value) return null;

  let parsed: Partial<AdminRowLock> | null = null;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return null;
    }
  } else if (typeof value === "object") {
    parsed = value as Partial<AdminRowLock>;
  }

  if (
    !parsed ||
    typeof parsed.adminId !== "string" ||
    typeof parsed.adminName !== "string" ||
    typeof parsed.expiresAt !== "string" ||
    typeof parsed.token !== "string" ||
    typeof parsed.version !== "number"
  ) {
    return null;
  }

  return {
    entity,
    entityId,
    adminId: parsed.adminId,
    adminName: parsed.adminName,
    expiresAt: parsed.expiresAt,
    token: parsed.token,
    version: parsed.version,
  } satisfies AdminRowLock;
};

const publishRealtimePayload = async (
  channel: string,
  event: AdminRealtimeEvent,
) => {
  await redis.publish(channel, JSON.stringify(event));
};

const publishLockEvent = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  lock: AdminRowLock | null,
) => {
  await publishRealtimePayload(ADMIN_ROW_LOCKS_CHANNEL, {
    kind: "lock",
    channel: ADMIN_ROW_LOCKS_CHANNEL,
    type: lock ? "LOCK_ACQUIRED" : "LOCK_RELEASED",
    entity,
    entityId,
    id: entityId,
    adminName: lock?.adminName,
    lock,
    publishedAt: new Date().toISOString(),
  });
};

export const requireAdminActor = async (): Promise<AdminActor> => {
  const session = await auth();

  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Forbidden");
  }

  return {
    id: session.user.id,
    name: session.user.name || session.user.email || "Admin",
  };
};

export const getRowLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
) => {
  const value = await redis.get<string>(getLockKey(entity, entityId));
  return parseLock(value, entity, entityId);
};

export const listRowLocks = async (
  entity: AdminRealtimeEntity,
  entityIds: string[],
): Promise<Record<string, AdminRowLock | null>> => {
  if (entityIds.length === 0) return {};

  const keys = entityIds.map((id) => getLockKey(entity, id));

  // Single round-trip instead of N
  const values = await redis.mget<string[]>(...keys);

  return entityIds.reduce<Record<string, AdminRowLock | null>>(
    (acc, entityId, index) => {
      acc[entityId] = parseLock(values[index], entity, entityId);
      return acc;
    },
    {},
  );
};

export const acquireLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  admin: AdminActor,
  existingToken?: string,
) => {
  const now = Date.now();
  const expiresAt = new Date(now + ROW_LOCK_TTL_MS).toISOString();

  // Only generate a fresh token if we don't already own the lock
  // The script will reuse the existing token if re-entrant
  const token = existingToken ?? Math.random().toString(36).slice(2);

  const lock: AdminRowLock = {
    entity,
    entityId,
    adminId: admin.id,
    adminName: admin.name,
    expiresAt,
    token,
    version: 1,
  };

  const result = (await redis.eval(
    ACQUIRE_SCRIPT,
    [getLockKey(entity, entityId)],
    [JSON.stringify(lock), String(ROW_LOCK_TTL_MS), admin.id, expiresAt],
  )) as string | null;

  const resolvedLock = parseLock(result, entity, entityId);
  const acquired = resolvedLock?.adminId === admin.id;

  if (acquired) {
    await publishLockEvent(entity, entityId, resolvedLock).catch((err) =>
      console.error("[acquireLock] publishLockEvent failed:", err),
    );
    return { acquired: true, lock: resolvedLock };
  }

  return { acquired: false, lock: null, blockedBy: resolvedLock };
};

// Heartbeat (TTL refresh only, no token rotation)
export const refreshLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token: string,
): Promise<boolean> => {
  if (!adminId || !token) {
    console.warn("[refreshLock] Called with empty adminId or token — skipped");
    return false;
  }

  const newExpiry = new Date(Date.now() + ROW_LOCK_TTL_MS).toISOString();

  const result = (await redis.eval(
    HEARTBEAT_SCRIPT,
    [getLockKey(entity, entityId)],
    [adminId, token, String(ROW_LOCK_TTL_MS), newExpiry],
  )) as 0 | 1;

  return result === 1;
};

export const releaseLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string, // required — not optional
  token: string, // required — not optional
): Promise<{ released: boolean; reason: string }> => {
  if (!adminId || !token) {
    console.error(
      "[releaseLock] Attempted release with empty adminId or token",
      {
        entity,
        entityId,
        hasAdminId: !!adminId,
        hasToken: !!token,
      },
    );
    return { released: false, reason: "missing_identity" };
  }

  const result = (await redis.eval(
    RELEASE_SCRIPT,
    [getLockKey(entity, entityId)],
    [adminId, token],
  )) as [string, string];

  const [status, reason] = result;
  const released = status === "OK";

  if (released) {
    await publishLockEvent(entity, entityId, null).catch((err) =>
      console.error("[releaseLock] publishLockEvent failed:", err),
    );
  } else {
    console.warn("[releaseLock] Release rejected", {
      entity,
      entityId,
      adminId,
      reason,
      // Log partial token for tracing without exposing full secret
      tokenPrefix: token.slice(0, 6),
    });
  }

  return { released, reason };
};

export class LockOwnershipError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "LockOwnershipError";
    this.code = code;
  }
}

export const assertLockOwnership = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId: string,
  token?: string,
) => {
  if (!token) {
    throw new LockOwnershipError(
      "Your editing session expired. Please reopen and try again.",
      "lock_expired",
    );
  }

  const lock = await getRowLock(entity, entityId);

  if (!lock || lock.adminId !== adminId || (token && lock.token !== token)) {
    if (!lock) {
      throw new LockOwnershipError(
        "This session expired. Please reopen the action.",
        "lock_expired",
      );
    }
    if (lock.adminId !== adminId) {
      throw new LockOwnershipError(
        `Currently being edited by ${lock.adminName}`,
        "lock_conflict",
      );
    }
    // Token mismatch usually means the lock was re-acquired or expired/refreshed
    throw new LockOwnershipError(
      "Your editing session expired. Please reopen and try again.",
      "lock_expired",
    );
  }
  return lock;
};

export const publishEvent = async <TData>(
  channel: AdminRealtimeEntity,
  payload: {
    type: AdminRealtimeMutationType;
    entityId: string;
    data: TData | null;
  },
) => {
  await publishRealtimePayload(channel, {
    kind: "row",
    channel,
    type: payload.type,
    entityId: payload.entityId,
    data: payload.data,
    publishedAt: new Date().toISOString(),
  });
};

type UpdateWithVersionCheckArgs<TTable> = {
  table: TTable;
  idColumn: AnyPgColumn;
  versionColumn: AnyPgColumn;
  id: string;
  expectedVersion: number;
  values: Record<string, unknown>;
};

export const updateWithVersionCheck = async <TTable>({
  table,
  idColumn,
  versionColumn,
  id,
  expectedVersion,
  values,
  trx,
}: UpdateWithVersionCheckArgs<TTable> & { trx?: unknown }) => {
  const dbInstance = trx ? (trx as typeof db) : db;
  const result = await dbInstance
    .update(table as never)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${versionColumn} + 1`,
    } as never)
    .where(and(eq(idColumn, id), eq(versionColumn, expectedVersion)))
    .returning();

  const updatedRow = result[0];

  if (!updatedRow) {
    throw new Error(CONFLICT_ERROR_MESSAGE);
  }

  return updatedRow;
};
