import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import { StatisticsSection } from "@/components/admin/dashboard/StatisticsSection";
import { RequestsSection } from "@/components/admin/dashboard/RequestsSection";
import { RecentBooksSection } from "@/components/admin/dashboard/RecentBooksSection";
import { getAdminDashboardSnapshot } from "@/lib/admin/stats";
import {
  StatisticsSkeleton,
  RequestsSkeleton,
  RecentBooksSkeleton,
} from "@/components/admin/skeleton/DashboardSkeleton";
import { Suspense } from "react";

export default async function DashboardPage() {
  // Single fetch — all three sections below will hit React.cache and get
  // the same result without additional DB round-trips.
  await getAdminDashboardSnapshot();

  return (
    <DashboardLayout>
      <Suspense fallback={<StatisticsSkeleton />}>
        <StatisticsSection />
      </Suspense>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-10">
        <Suspense fallback={<RequestsSkeleton />}>
          <RequestsSection />
        </Suspense>

        <Suspense fallback={<RecentBooksSkeleton />}>
          <RecentBooksSection />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
