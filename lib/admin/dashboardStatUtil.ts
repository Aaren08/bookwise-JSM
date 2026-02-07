interface DashboardStats {
  totalBooks: number;
  totalUsers: number;
  borrowedBooks: number;
}

export const validateDashboardStats = (
  data: unknown,
  fallback: DashboardStats,
): DashboardStats => {
  if (!data || typeof data !== "object") {
    return fallback;
  }

  const parsed = data as Record<string, unknown>;

  if (
    typeof parsed.totalBooks === "number" &&
    typeof parsed.totalUsers === "number" &&
    typeof parsed.borrowedBooks === "number" &&
    !isNaN(parsed.totalBooks) &&
    !isNaN(parsed.totalUsers) &&
    !isNaN(parsed.borrowedBooks)
  ) {
    return {
      totalBooks: parsed.totalBooks,
      totalUsers: parsed.totalUsers,
      borrowedBooks: parsed.borrowedBooks,
    };
  }

  return fallback;
};

export const loadDashboardStats = (
  fallback: DashboardStats,
): DashboardStats => {
  const stored = localStorage.getItem("dashboardStats");
  if (!stored) return fallback;

  try {
    const parsed = JSON.parse(stored);
    return validateDashboardStats(parsed, fallback);
  } catch {
    return fallback;
  }
};
