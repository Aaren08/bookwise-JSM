import BorrowRequests from "@/components/admin/dashboard/borrow/BorrowRequests";
import AccountRequests from "@/components/admin/dashboard/account/AccountRequests";
import { getDashboardData } from "@/lib/admin/dashboard";

export async function RequestsSection() {
  const dashboardResult = await getDashboardData();
  const data = dashboardResult.data || {
    latestBorrowRequests: [],
    latestAccountRequests: [],
  };

  return (
    <div className="space-y-5">
      <BorrowRequests borrowRecords={data.latestBorrowRequests} />
      <AccountRequests accountRequests={data.latestAccountRequests} />
    </div>
  );
}
