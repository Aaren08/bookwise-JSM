import RecentBooks from "@/components/admin/dashboard/recent/RecentBooks";
import { getDashboardData } from "@/lib/admin/dashboard";

export async function RecentBooksSection() {
  const dashboardResult = await getDashboardData();
  const data = dashboardResult.data || {
    recentBooks: [],
  };

  return <RecentBooks recentBooks={data.recentBooks} />;
}
