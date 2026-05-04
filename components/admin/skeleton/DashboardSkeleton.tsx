import Link from "next/link";
import Image from "next/image";

/**
 * StatisticsSkeleton
 * Mirrors the real <Statistics> layout exactly.
 * - Heading is intentionally omitted (stat cards have no heading row)
 * - 3 skeleton cards match .stat-card_container dimensions
 */
export const StatisticsSkeleton = () => (
  <div className="stat-cards">
    {Array.from({ length: 3 }).map((_, i) => (
      <div key={i} className="stat-card_container">
        {/* title row */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-4 w-24 rounded bg-skeleton" />
            </div>
            {/* big value */}
            <div className="h-9 w-16 rounded bg-skeleton mt-1" />
          </div>
        </div>
      </div>
    ))}
  </div>
);

/**
 * BorrowRequestsSkeleton
 * Keeps the real header (title + "View all" link) visible.
 * Renders 3 skeleton cards matching .borrow-request-card layout.
 */
const BorrowRequestsSkeleton = () => (
  <div className="borrow-requests-container">
    <div className="borrow-requests-header">
      <h2 className="borrow-requests-title">Borrow Requests</h2>
      <Link href="/admin/borrow-records" className="view-btn">
        View all
      </Link>
    </div>

    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="borrow-request-card">
          {/* book cover */}
          <div className="dashboard-book-info">
            <div className="h-16 w-12 rounded-md bg-skeleton flex-shrink-0" />

            <div className="dashboard-book-details">
              {/* title */}
              <div className="h-4 w-36 rounded bg-skeleton mb-2" />
              {/* author • genre */}
              <div className="h-3 w-48 rounded bg-skeleton mb-2" />
              {/* user row */}
              <div className="flex items-center gap-2">
                <div className="size-5 rounded-full bg-skeleton" />
                <div className="h-3 w-24 rounded bg-skeleton" />
                <div className="h-3 w-16 rounded bg-skeleton" />
              </div>
            </div>
          </div>

          {/* eye button */}
          <div className="h-8 w-8 rounded-lg bg-skeleton flex-shrink-0" />
        </div>
      ))}
    </div>
  </div>
);

/**
 * AccountRequestsSkeleton
 * Keeps the real header (title + "View all" link) visible.
 * Renders 3 skeleton cards matching .account-request-card layout
 * (grid of avatar + name + email).
 */
const AccountRequestsSkeleton = () => (
  <div className="account-requests-container">
    <div className="account-requests-header">
      <h2 className="account-requests-title">Account Requests</h2>
      <Link href="/admin/account-requests" className="view-btn">
        View all
      </Link>
    </div>

    <div className="account-requests-grid">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="account-request-card">
          <div className="account-request-card_upper">
            {/* avatar */}
            <div className="size-16 rounded-full bg-skeleton" />
            <div className="account-request-card_info w-full">
              {/* name */}
              <div className="h-4 w-28 rounded bg-skeleton mb-2 mx-auto" />
              {/* email */}
              <div className="h-3 w-36 rounded bg-skeleton mx-auto" />
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/**
 * RequestsSkeleton
 * Drop-in Suspense fallback for <RequestsSection />.
 */
export const RequestsSkeleton = () => (
  <div className="space-y-5">
    <BorrowRequestsSkeleton />
    <AccountRequestsSkeleton />
  </div>
);

/**
 * RecentBooksSkeleton
 * Drop-in Suspense fallback for <RecentBooksSection />.
 *
 * Rules:
 * - Heading ("Recently Added Books") and "View all" link are real — not skeletonized.
 * - "Add New Book" button is real — it's always actionable.
 * - Only the 3 book cards are skeleton.
 */
export const RecentBooksSkeleton = () => (
  <div className="recent-books-container">
    {/* Real header */}
    <div className="recent-books-header">
      <h2 className="recent-books-title">Recently Added Books</h2>
      <Link href="/admin/books" className="view-btn">
        View all
      </Link>
    </div>

    {/* Real Add New Book button */}
    <Link href="/admin/books/new" className="add-new-book_btn">
      <div>
        <Image
          src="/icons/admin/plus.svg"
          alt="Add New Book"
          width={20}
          height={20}
        />
      </div>
      <p>Add New Book</p>
    </Link>

    {/* 3 skeleton book cards */}
    <div className="mt-7 space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="recent-book-card">
          <div className="dashboard-book-info">
            {/* book cover */}
            <div className="h-16 w-12 rounded-md bg-skeleton flex-shrink-0" />

            <div className="dashboard-book-details">
              {/* title */}
              <div className="h-4 w-40 rounded bg-skeleton mb-2" />
              {/* author • genre */}
              <div className="h-3 w-52 rounded bg-skeleton mb-2" />
              {/* date row */}
              <div className="flex items-center gap-1.5">
                <div className="h-3.5 w-3.5 rounded bg-skeleton" />
                <div className="h-3 w-16 rounded bg-skeleton" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);
