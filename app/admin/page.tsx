import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import AdminDashboardRealtime from "@/components/admin/dashboard/AdminDashboardRealtime";
import { getAdminDashboardSnapshot } from "@/lib/admin/stats";

export default async function DashboardPage() {
  const snapshot = await getAdminDashboardSnapshot();

  return (
    <DashboardLayout>
      <AdminDashboardRealtime initialSnapshot={snapshot.data} />
    </DashboardLayout>
  );
}
