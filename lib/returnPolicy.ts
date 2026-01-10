import dayjs from "dayjs";

export interface BorrowStatus {
  daysLeft: number;
  isOverdue: boolean;
  borrowDate: string;
  dueDate: string;
}

export const calculateBorrowStatus = (
  borrowDate: Date | string,
  dueDate: Date | string
): BorrowStatus => {
  const today = dayjs();
  const due = dayjs(dueDate);
  const borrowed = dayjs(borrowDate);

  const daysLeft = due.diff(today, "day");
  const isOverdue = daysLeft < 0;

  return {
    daysLeft: Math.abs(daysLeft),
    isOverdue,
    borrowDate: borrowed.format("MMM DD"),
    dueDate: due.format("MMM DD"),
  };
};

export const getBorrowStatusColor = (isOverdue: boolean): string => {
  return isOverdue ? "#ef3a4b" : "#e7c9a5";
};

export const getBorrowStatusText = (status: BorrowStatus): string => {
  if (status.isOverdue) {
    return "Overdue Return";
  }
  return `${status.daysLeft} days left to due`;
};
