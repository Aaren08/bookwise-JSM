import DashboardLayout from "@/components/admin/dashboard/DashboardLayout";
import Statistics from "@/components/admin/dashboard/Statistics";
import BorrowRequests from "@/components/admin/dashboard/borrow/BorrowRequests";
import AccountRequests from "@/components/admin/dashboard/account/AccountRequests";
import RecentBooks from "@/components/admin/dashboard/recent/RecentBooks";
import { getDashboardStats } from "@/lib/admin/stats";
import { getDashboardData } from "@/lib/admin/dashboard";

export default async function DashboardPage() {
  // Fetch dashboard statistics
  const statsResult = await getDashboardStats();
  const stats = statsResult.data;

  // Fetch dashboard data
  const dataResult = await getDashboardData();
  const data = dataResult.data;

  return (
    <DashboardLayout>
      {/* Statistics Cards */}
      <Statistics
        totalBooks={stats.totalBooks}
        totalUsers={stats.totalUsers}
        borrowedBooks={stats.borrowedBooks}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-10">
        {/* Left Column */}
        <div className="space-y-5">
          <BorrowRequests borrowRecords={data.latestBorrowRequests} />
          <AccountRequests accountRequests={data.latestAccountRequests} />
        </div>

        {/* Right Column */}
        <div>
          <RecentBooks recentBooks={data.recentBooks} />
        </div>
      </div>
    </DashboardLayout>
  );
}
