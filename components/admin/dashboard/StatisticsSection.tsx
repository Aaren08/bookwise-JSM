import Statistics from "@/components/admin/dashboard/Statistics";
import { getDashboardStats } from "@/lib/admin/stats";

export async function StatisticsSection() {
  const statsResult = await getDashboardStats();
  const stats = statsResult.data || {
    totalBooks: 0,
    totalUsers: 0,
    borrowedBooks: 0,
  };

  return (
    <Statistics
      totalBooks={stats.totalBooks}
      totalUsers={stats.totalUsers}
      borrowedBooks={stats.borrowedBooks}
    />
  );
}
