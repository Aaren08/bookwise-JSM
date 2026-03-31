"use client";

import Statistics from "@/components/admin/dashboard/Statistics";
import AccountRequests from "@/components/admin/dashboard/account/AccountRequests";
import BorrowRequests from "@/components/admin/dashboard/borrow/BorrowRequests";
import RecentBooks from "@/components/admin/dashboard/recent/RecentBooks";
import { useAdminDashboardRealtime } from "@/lib/admin/realtime/useAdminDashboardRealtime";

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
