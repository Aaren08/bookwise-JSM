import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import { Suspense } from "react";
import { StatisticsSection } from "@/components/admin/dashboard/StatisticsSection";
import { RequestsSection } from "@/components/admin/dashboard/RequestsSection";
import { RecentBooksSection } from "@/components/admin/dashboard/RecentBooksSection";

// Skeleton loaders for each section
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

export default function DashboardPage() {
  return (
    <DashboardLayout>
      {/* Section 1: Statistics - Fetches stats only (fast - ~50ms) */}
      <Suspense fallback={<StatisticsSkeleton />}>
        <StatisticsSection />
      </Suspense>

      {/* Section 2: Requests Grid - Renders immediately after stats load */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-10">
        {/* Left column: Borrow + Account Requests (parallel fetch) */}
        <Suspense fallback={<RequestsSkeleton />}>
          <RequestsSection />
        </Suspense>

        {/* Right column: Recent Books (independent fetch) */}
        <Suspense fallback={<RecentBooksSkeleton />}>
          <RecentBooksSection />
        </Suspense>
      </div>
    </DashboardLayout>
  );
}
