export const ADMIN_ROW_REALTIME_CHANNELS = [
  "borrow_requests",
  "account_requests",
  "books",
  "users",
] as const;

export const ADMIN_ROW_LOCKS_CHANNEL = "locks";
export const ADMIN_ROW_REALTIME_ENDPOINT = "/api/admin/realtime/rows";
export const ADMIN_ROW_REALTIME_RETRY_MS = 2000;
export const ADMIN_ROW_REALTIME_KEEPALIVE_MS = 25000;
export const ADMIN_ROW_REALTIME_HEARTBEAT_MS = 15_000;
export const ADMIN_ROW_SYNC_ENDPOINT = "/api/admin/sync";

export type AdminRealtimeEntity = (typeof ADMIN_ROW_REALTIME_CHANNELS)[number];
export type AdminRealtimeMutationType = "CREATE" | "UPDATE" | "DELETE";

export type AdminRealtimeRowEvent<TData = unknown> = {
  kind: "row";
  channel: AdminRealtimeEntity;
  type: AdminRealtimeMutationType;
  entityId: string;
  data: TData | null;
  publishedAt: string;
};

export type AdminRowLock = {
  entity: AdminRealtimeEntity;
  entityId: string;
  adminId: string;
  adminName: string;
  expiresAt: string;
  token: string;
  version: number;
};

export type AdminRealtimeLockEvent = {
  kind: "lock";
  channel: typeof ADMIN_ROW_LOCKS_CHANNEL;
  type: "LOCK_ACQUIRED" | "LOCK_RELEASED";
  entity: AdminRealtimeEntity;
  entityId: string;
  id: string;
  adminName?: string;
  lock: AdminRowLock | null;
  publishedAt: string;
};

export type AdminRealtimeHeartbeatEvent = {
  kind: "heartbeat";
  timestamp: string;
};

export type AdminRealtimeEvent<TData = unknown> =
  | AdminRealtimeRowEvent<TData>
  | AdminRealtimeLockEvent
  | AdminRealtimeHeartbeatEvent;

export const encodeAdminRealtimeEvent = (message: AdminRealtimeEvent) =>
  `data: ${JSON.stringify(message)}\n\n`;

/** Emits a proper named SSE heartbeat frame (not a comment). */
export const encodeHeartbeatEvent = (): string =>
  `event: heartbeat\ndata: ${JSON.stringify({ kind: "heartbeat", timestamp: new Date().toISOString() })}\n\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object";

export const isAdminRowLock = (value: unknown): value is AdminRowLock => {
  if (!isRecord(value)) return false;

  return (
    typeof value.entity === "string" &&
    typeof value.entityId === "string" &&
    typeof value.adminId === "string" &&
    typeof value.adminName === "string" &&
    typeof value.expiresAt === "string" &&
    typeof value.token === "string" &&
    typeof value.version === "number"
  );
};

export const isAdminRealtimeHeartbeatEvent = (
  value: unknown,
): value is AdminRealtimeHeartbeatEvent =>
  isRecord(value) &&
  value.kind === "heartbeat" &&
  typeof value.timestamp === "string";

export const isAdminRealtimeEvent = (
  value: unknown,
): value is AdminRealtimeEvent => {
  if (!isRecord(value)) return false;

  if (value.kind === "heartbeat") {
    return isAdminRealtimeHeartbeatEvent(value);
  }

  if (value.kind === "row") {
    return (
      typeof value.channel === "string" &&
      typeof value.type === "string" &&
      typeof value.entityId === "string" &&
      typeof value.publishedAt === "string" &&
      ("data" in value || value.data === null)
    );
  }

  if (value.kind === "lock") {
    return (
      value.channel === ADMIN_ROW_LOCKS_CHANNEL &&
      typeof value.type === "string" &&
      typeof value.entity === "string" &&
      typeof value.entityId === "string" &&
      typeof value.id === "string" &&
      typeof value.publishedAt === "string" &&
      (value.lock === null || isAdminRowLock(value.lock))
    );
  }

  return false;
};
