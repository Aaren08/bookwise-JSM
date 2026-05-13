import dayjs from "dayjs";

export interface SystemConfig {
  instituteName: string;
  websiteUrl: string;
  supportEmail: string;
  borrowDurationDays: number;
}

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  instituteName: "BookWise",
  websiteUrl: "",
  supportEmail: "",
  borrowDurationDays: 14,
};

export const formatBorrowDuration = (days: number) =>
  `${days} ${days === 1 ? "Day" : "Days"}`;

export const getDueDateFromBorrowDuration = (borrowDurationDays: number) =>
  dayjs().add(borrowDurationDays, "days");
