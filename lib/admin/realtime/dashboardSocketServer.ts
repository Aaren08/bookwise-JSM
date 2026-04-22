import "server-only";

import {
  publishAdminDashboardUpdate,
  publishBookAvailabilityUpdate,
} from "@/lib/admin/realtime/dashboardRedisPubSub";

declare global {
  var adminDashboardWss: undefined;
}

export const broadcastAdminDashboardUpdate = async () => {
  await publishAdminDashboardUpdate();
};

export const broadcastBookAvailabilityUpdate = async (
  bookId: string,
  availableCount: number,
  reservedCount: number,
  borrowedCount: number,
) => {
  await publishBookAvailabilityUpdate(
    bookId,
    availableCount,
    reservedCount,
    borrowedCount,
  );
};

