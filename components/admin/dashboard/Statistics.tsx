"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { loadDashboardStats } from "@/lib/admin/dashboardStatUtil";

const StatCard = ({ title, value, change }: StatCardProps) => {
  const isPositive = change > 0;
  const showChange = change !== 0;

  return (
    <div className="stat-card_container">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="stat-card_title">{title}</h3>
            {showChange && (
              <div className="flex items-center gap-1">
                <Image
                  key={`${title}-${isPositive}`}
                  src={
                    isPositive
                      ? "/icons/admin/caret-up.svg"
                      : "/icons/admin/caret-down.svg"
                  }
                  alt={isPositive ? "increase" : "decrease"}
                  width={16}
                  height={16}
                  className="object-contain"
                  priority
                />
                <span
                  className={`text-xs font-semibold ${
                    isPositive ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {Math.abs(change)}
                </span>
              </div>
            )}
          </div>
          <p className="stat-value">{value}</p>
        </div>
      </div>
    </div>
  );
};

const Statistics = ({
  totalBooks,
  totalUsers,
  borrowedBooks,
}: StatisticsProps) => {
  // Load previous stats from localStorage on mount using lazy initialization
  const [previousStats, setPreviousStats] = useState(() => {
    // Server-side: use current props to avoid hydration mismatch
    if (typeof window === "undefined") {
      return { totalBooks, totalUsers, borrowedBooks };
    }

    // Client-side: load from localStorage with validation
    return loadDashboardStats({ totalBooks, totalUsers, borrowedBooks });
  });

  // Calculate changes (derived state - no setState needed)
  const booksChange = totalBooks - previousStats.totalBooks;
  const usersChange = totalUsers - previousStats.totalUsers;
  const borrowedChange = borrowedBooks - previousStats.borrowedBooks;

  // Update localStorage after displaying changes for 3 seconds
  useEffect(() => {
    if (!booksChange && !usersChange && !borrowedChange) return;

    const timeout = setTimeout(() => {
      const newStats = { totalBooks, totalUsers, borrowedBooks };
      setPreviousStats(newStats);
      localStorage.setItem("dashboardStats", JSON.stringify(newStats));
    }, 3000);

    return () => clearTimeout(timeout);
  }, [
    booksChange,
    usersChange,
    borrowedChange,
    totalBooks,
    totalUsers,
    borrowedBooks,
  ]);

  return (
    <div className="stat-cards">
      <StatCard title="Total Books" value={totalBooks} change={booksChange} />
      <StatCard title="Total Users" value={totalUsers} change={usersChange} />
      <StatCard
        title="Borrowed Books"
        value={borrowedBooks}
        change={borrowedChange}
      />
    </div>
  );
};

export default Statistics;
