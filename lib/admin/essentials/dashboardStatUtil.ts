export interface DashboardStats {
  totalBooks: number;
  totalUsers: number;
  borrowedBooks: number;
}

export const DASHBOARD_REALTIME_DELAY_MS = 3000;
export const DASHBOARD_WS_PORT =
  Number(process.env.NEXT_PUBLIC_ADMIN_DASHBOARD_WS_PORT) || 3001;

export const getAdminDashboardSocketUrl = () => {
  if (typeof window === "undefined") return "";

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const hostname = window.location.hostname;

  return `${protocol}://${hostname}:${DASHBOARD_WS_PORT}`;
};

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
  if (typeof window === "undefined") return fallback;

  const stored = localStorage.getItem("dashboardStats");
  if (!stored) return fallback;

  try {
    const parsed = JSON.parse(stored);
    return validateDashboardStats(parsed, fallback);
  } catch {
    return fallback;
  }
};
