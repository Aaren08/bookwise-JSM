import "server-only";

import { publishAdminDashboardUpdate } from "@/lib/admin/realtime/dashboardRedisPubSub";

declare global {
  var adminDashboardWss: undefined;
}

export const broadcastAdminDashboardUpdate = async () => {
  await publishAdminDashboardUpdate();
};
