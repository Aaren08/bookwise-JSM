import Image from "next/image";
import Link from "next/link";
import AccountRequestCards from "./AccountRequestCards";

const AccountRequests = ({ accountRequests = [] }: AccountRequestsProps) => {
  return (
    <div className="account-requests-container">
      {/* Header with View all button */}
      <div className="account-requests-header">
        <h2 className="account-requests-title">Account Requests</h2>
        <Link href="/admin/account-requests" className="view-btn">
          View all
        </Link>
      </div>

      {/* Requests List or Empty State */}
      {accountRequests.length > 0 ? (
        <div className="box-body-scroll-wrapper">
          <div className="box-body-scroll-container">
            <AccountRequestCards requests={accountRequests} />
          </div>
        </div>
      ) : (
        <div className="account-requests-empty-state">
          <Image
            src="/icons/admin/no-account-req.svg"
            alt="No Account Requests"
            width={150}
            height={150}
            className="mb-4"
          />
          <h3 className="account-requests-empty-title">
            No Pending Account Requests
          </h3>
          <p className="account-requests-empty-description">
            There are currently no account requests awaiting approval.
          </p>
        </div>
      )}
    </div>
  );
};

export default AccountRequests;
