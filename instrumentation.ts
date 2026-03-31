export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { ensureAdminDashboardSocketServer } =
    await import("@/lib/admin/realtime/dashboardSocketServer");

  ensureAdminDashboardSocketServer();
}
