import { Suspense } from "react";
import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import AdminDashboardRealtime from "@/components/admin/dashboard/AdminDashboardRealtime";
import { getAdminDashboardSnapshot } from "@/lib/admin/stats";
import {
  StatisticsSkeleton,
  RequestsSkeleton,
  RecentBooksSkeleton,
} from "@/components/admin/skeleton/DashboardSkeleton";

async function DashboardRealtimeSection() {
  const snapshot = await getAdminDashboardSnapshot();

  return (
    <AdminDashboardRealtime
      initialSnapshot={{
        stats: snapshot.data.stats ?? {
          totalBooks: 0,
          totalUsers: 0,
          borrowedBooks: 0,
        },
        latestBorrowRequests: snapshot.data.latestBorrowRequests ?? [],
        latestAccountRequests: snapshot.data.latestAccountRequests ?? [],
        recentBooks: snapshot.data.recentBooks ?? [],
      }}
    />
  );
}

const DashboardFallback = () => (
  <>
    <StatisticsSkeleton />

    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-10">
      <RequestsSkeleton />
      <RecentBooksSkeleton />
    </div>
  </>
);

export default function DashboardPage() {
  return (
    <DashboardLayout>
      <Suspense fallback={<DashboardFallback />}>
        <DashboardRealtimeSection />
      </Suspense>
    </DashboardLayout>
  );
}
