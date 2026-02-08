"use client";

import RecentBookCard from "./RecentBookCard";

const RecentBookList = ({ recentBooks }: RecentBookListProps) => {
  // Filter only recent books and take top 8 most recent
  const recentBooksList = recentBooks.slice(0, 8);

  return (
    <div className="space-y-3">
      {recentBooksList.map((recentBook) => (
        <RecentBookCard key={recentBook.id} recentBooks={recentBook} />
      ))}
    </div>
  );
};

export default RecentBookList;
