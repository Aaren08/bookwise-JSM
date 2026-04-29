import { NextResponse } from "next/server";
import {
  ADMIN_ROW_REALTIME_CHANNELS,
  type AdminRealtimeEntity,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";
import {
  listRowLocks,
  requireAdminActor,
} from "@/lib/admin/realtime/concurrency/rowConcurrency";
import {
  getBooksForSync,
  getBorrowRecordsForSync,
  getApprovedUsersForSync,
  getPendingUsersForSync,
} from "@/lib/admin/realtime/concurrency/rowSyncFetchers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isValidEntity = (value: string): value is AdminRealtimeEntity =>
  ADMIN_ROW_REALTIME_CHANNELS.includes(
    value as (typeof ADMIN_ROW_REALTIME_CHANNELS)[number],
  );

/**
 * Fetch entity rows for the given IDs.
 * If `ids` is empty, returns first-page records (page 1 / 20 rows) —
 * this is used by the row-resync path when the client has no tracked IDs yet.
 */
const fetchEntityRows = async (
  entity: AdminRealtimeEntity,
  ids: string[],
): Promise<unknown[]> => {
  switch (entity) {
    case "borrow_requests":
      return getBorrowRecordsForSync(ids.length > 0 ? ids : undefined);
    case "account_requests":
      return getPendingUsersForSync(ids.length > 0 ? ids : undefined);
    case "users":
      return getApprovedUsersForSync(ids.length > 0 ? ids : undefined);
    case "books":
      return getBooksForSync(ids.length > 0 ? ids : undefined);
    default:
      return [];
  }
};

/**
 * GET /api/admin/sync
 *
 * Query params:
 *   entity      — required. One of ADMIN_ROW_REALTIME_CHANNELS.
 *   ids         — optional. Comma-separated row IDs to fetch locks + rows for.
 *                 If omitted, returns first-page data.
 *   includeRows — optional. When "true" the response also includes `rows[]`.
 *
 * Called by the client after every SSE reconnect and on the periodic 60s
 * safety resync to re-hydrate both lock state and row data.
 */
export async function GET(request: Request) {
  try {
    await requireAdminActor();
  } catch {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entity = searchParams.get("entity");
  const ids = searchParams.get("ids");
  const includeRows = searchParams.get("includeRows") === "true";

  if (!entity || !isValidEntity(entity)) {
    return NextResponse.json({ message: "Invalid entity" }, { status: 400 });
  }

  const rowIds = ids
    ? ids
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean)
    : [];

  // Fetch locks (always) and rows (when requested) in parallel
  const [locks, rows] = await Promise.all([
    listRowLocks(entity, rowIds),
    includeRows ? fetchEntityRows(entity, rowIds) : Promise.resolve(null),
  ]);

  return NextResponse.json({
    success: true,
    entity,
    locks,
    ...(rows !== null && { rows }),
    syncedAt: new Date().toISOString(),
  });
}
