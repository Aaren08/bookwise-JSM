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
    typeof parsed.token !== "string"
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
) => {
  const entries = await Promise.all(
    entityIds.map(async (entityId) => ({
      entityId,
      lock: await getRowLock(entity, entityId),
    })),
  );

  return entries.reduce<Record<string, AdminRowLock | null>>((acc, entry) => {
    acc[entry.entityId] = entry.lock;
    return acc;
  }, {});
};

export const acquireLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  admin: AdminActor,
  token?: string,
) => {
  const nextToken = token || Math.random().toString(36).slice(2);
  const lock = {
    entity,
    entityId,
    adminId: admin.id,
    adminName: admin.name,
    expiresAt: new Date(Date.now() + ROW_LOCK_TTL_MS).toISOString(),
    token: nextToken,
  } satisfies AdminRowLock;

  const result = (await redis.eval(
    `
    local current = redis.call('GET', KEYS[1])
    local next = ARGV[1]
    local ttl = tonumber(ARGV[2])
    local adminId = ARGV[3]

    if not current then
      redis.call('SET', KEYS[1], next, 'PX', ttl)
      return next
    end

    local decoded = cjson.decode(current)
    if decoded.adminId == adminId then
      redis.call('SET', KEYS[1], next, 'PX', ttl)
      return next
    end

    return current
    `,
    [getLockKey(entity, entityId)],
    [JSON.stringify(lock), String(ROW_LOCK_TTL_MS), admin.id],
  )) as string | null;

  const resolvedLock = parseLock(result, entity, entityId);
  const acquired = resolvedLock?.adminId === admin.id;

  if (acquired) {
    await publishLockEvent(entity, entityId, resolvedLock);
  }

  return {
    acquired,
    lock: resolvedLock,
  };
};

export const releaseLock = async (
  entity: AdminRealtimeEntity,
  entityId: string,
  adminId?: string,
  token?: string,
) => {
  const result = (await redis.eval(
    `
    local current = redis.call('GET', KEYS[1])
    if not current then
      return ''
    end

    local decoded = cjson.decode(current)

    if ARGV[1] ~= '' and decoded.adminId ~= ARGV[1] then
      return current
    end

    if ARGV[2] ~= '' and decoded.token ~= ARGV[2] then
      return current
    end

    redis.call('DEL', KEYS[1])
    return '__deleted__'
    `,
    [getLockKey(entity, entityId)],
    [adminId ?? "", token ?? ""],
  )) as string | null;

  if (result === "__deleted__") {
    await publishLockEvent(entity, entityId, null);
    return { released: true, lock: null };
  }

  return {
    released: false,
    lock: parseLock(result, entity, entityId),
  };
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
}: UpdateWithVersionCheckArgs<TTable>) => {
  const result = await db
    .update(table as never)
    .set({
      ...values,
      updatedAt: new Date(),
      version: sql`${versionColumn} + 1`,
    } as never)
    .where(
      and(
        eq(idColumn, id),
        eq(versionColumn, expectedVersion),
      ),
    )
    .returning();

  const updatedRow = result[0];

  if (!updatedRow) {
    throw new Error(CONFLICT_ERROR_MESSAGE);
  }

  return updatedRow;
};
