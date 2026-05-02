import { NextResponse } from "next/server";
import {
  acquireLock,
  listRowLocks,
  releaseLock,
  requireAdminActor,
  refreshLock,
} from "@/lib/admin/realtime/concurrency/rowConcurrency";
import {
  ADMIN_ROW_REALTIME_CHANNELS,
  type AdminRealtimeEntity,
} from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isValidEntity = (value: string) =>
  ADMIN_ROW_REALTIME_CHANNELS.includes(
    value as (typeof ADMIN_ROW_REALTIME_CHANNELS)[number],
  );

const parseBody = async (request: Request) => {
  const payload = (await request.json()) as {
    entity?: string;
    entityId?: string;
    token?: string;
  };

  if (!payload.entity || !payload.entityId || !isValidEntity(payload.entity)) {
    return null;
  }

  return {
    entity: payload.entity as AdminRealtimeEntity,
    entityId: payload.entityId,
    token: payload.token,
  };
};

export async function GET(request: Request) {
  try {
    await requireAdminActor();

    const { searchParams } = new URL(request.url);
    const entity = searchParams.get("entity");
    const ids = searchParams.get("ids");

    if (!entity || !isValidEntity(entity)) {
      return NextResponse.json({ message: "Invalid entity" }, { status: 400 });
    }

    const resolvedEntity = entity as AdminRealtimeEntity;

    const rowIds = ids
      ? ids
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];

    const locks = await listRowLocks(resolvedEntity, rowIds);

    return NextResponse.json({
      success: true,
      locks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ message }, { status: 401 });
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdminActor();
    const body = await parseBody(request);

    if (!body) {
      return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
    }

    const result = await acquireLock(body.entity, body.entityId, admin);

    if (!result.acquired) {
      return NextResponse.json(
        {
          success: false,
          message: result.lock
            ? `Row locked by ${result.lock.adminName}`
            : "Unable to acquire row lock",
          lock: result.lock,
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      lock: result.lock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const admin = await requireAdminActor();
    const body = await parseBody(request); // must include token

    if (!body?.token) {
      return NextResponse.json(
        { message: "token required for heartbeat" },
        { status: 400 },
      );
    }

    const refreshed = await refreshLock(
      body.entity,
      body.entityId,
      admin.id,
      body.token,
    );

    if (!refreshed) {
      return NextResponse.json(
        { success: false, message: "Lock not owned or expired" },
        { status: 409 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    return NextResponse.json({ success: false, message }, { status: 401 });
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdminActor();
    const body = await parseBody(request);

    if (!body) {
      return NextResponse.json({ message: "Invalid payload" }, { status: 400 });
    }

    // Fix 1: guard against missing token before calling releaseLock
    if (!body.token) {
      return NextResponse.json(
        { message: "token is required to release a lock" },
        { status: 400 },
      );
    }

    const result = await releaseLock(
      body.entity,
      body.entityId,
      admin.id,
      body.token, // now guaranteed string
    );

    // Fix 2: result has `reason`, not `lock`
    return NextResponse.json({
      success: result.released,
      reason: result.reason,
      message: result.released
        ? "Lock released"
        : "Lock not owned by current admin",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    const status = message === "Forbidden" ? 403 : 500;
    return NextResponse.json({ success: false, message }, { status });
  }
}
