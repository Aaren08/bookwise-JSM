import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import { StatisticsSection } from "@/components/admin/dashboard/StatisticsSection";
import { RequestsSection } from "@/components/admin/dashboard/RequestsSection";
import { RecentBooksSection } from "@/components/admin/dashboard/RecentBooksSection";
import { getAdminDashboardSnapshot } from "@/lib/admin/stats";
import { Suspense } from "react";

const StatisticsSkeleton = () => (
  <div className="grid gap-5 md:grid-cols-3">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="h-32 rounded-2xl bg-slate-200 animate-pulse" />
    ))}
  </div>
);

const RequestsSkeleton = () => (
  <div className="space-y-5">
    <div className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
    <div className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
  </div>
);

const RecentBooksSkeleton = () => (
  <div className="h-[470px] rounded-2xl bg-slate-200 animate-pulse" />
);

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
