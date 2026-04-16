"use client";

import dynamic from "next/dynamic";
import Statistics from "@/components/admin/dashboard/Statistics";
import { useAdminDashboardRealtime } from "@/lib/admin/realtime/useAdminDashboardRealtime";

// Lazy load non-critical dashboard sections
const AccountRequests = dynamic(
  () => import("@/components/admin/dashboard/account/AccountRequests"),
  {
    loading: () => (
      <div className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
    ),
  },
);

const BorrowRequests = dynamic(
  () => import("@/components/admin/dashboard/borrow/BorrowRequests"),
  {
    loading: () => (
      <div className="h-56 rounded-2xl bg-slate-200 animate-pulse" />
    ),
  },
);

const RecentBooks = dynamic(
  () => import("@/components/admin/dashboard/recent/RecentBooks"),
  {
    loading: () => (
      <div className="h-[470px] rounded-2xl bg-slate-200 animate-pulse" />
    ),
  },
);

const AdminDashboardRealtime = ({
  initialSnapshot,
}: {
  initialSnapshot: AdminDashboardSnapshot;
}) => {
  const snapshot = useAdminDashboardRealtime(initialSnapshot);

  return (
    <>
      <Statistics
        totalBooks={snapshot.stats.totalBooks}
        totalUsers={snapshot.stats.totalUsers}
        borrowedBooks={snapshot.stats.borrowedBooks}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-10">
        <div className="space-y-5">
          <BorrowRequests borrowRecords={snapshot.latestBorrowRequests} />
          <AccountRequests accountRequests={snapshot.latestAccountRequests} />
        </div>

        <div>
          <RecentBooks recentBooks={snapshot.recentBooks} />
        </div>
      </div>
    </>
  );
};

export default AdminDashboardRealtime;
