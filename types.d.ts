interface Book {
  id: string;
  title: string;
  author: string;
  genre: string;
  rating: number;
  totalCopies: number;
  availableCopies: number;
  description: string;
  coverColor: string;
  coverUrl: string;
  videoUrl: string;
  summary: string;
  createdAt: Date | null;
  isLoanedBook?: boolean;
  borrowDate?: Date | string;
  dueDate?: Date | string;
  borrowRecordId?: string;
  borrowStatus?: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
  returnDate?: Date | string | null;
}

interface AuthCredentials {
  fullName: string;
  email: string;
  password: string;
  universityId: string;
  universityCard: string;
}

interface EmailParams {
  to_name?: string;
  from_name?: string;
  user_name?: string;
  user_email?: string;
  message?: string;
  [key: string]: unknown; // Allow additional custom parameters
}

interface BookParams {
  title: string;
  author: string;
  genre: string;
  rating: number;
  totalCopies: number;
  description: string;
  coverColor: string;
  coverUrl: string;
  videoUrl: string;
  summary: string;
}

interface BorrowBookParams {
  bookId: string;
  userId: string;
}

interface BorrowRecord {
  id: string;
  borrowDate: string;
  dueDate: string;
  returnDate: string | null;
  status: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
  bookTitle: string;
  bookCover: string;
  bookGenre: string;
  userFullName: string;
  userEmail: string;
  userAvatar: string;
  createdAt?: string;
}

interface User {
  id: string;
  fullName: string;
  email: string;
  createdAt: string;
  role: "USER" | "ADMIN";
  booksBorrowed: number;
  universityId: string;
  universityCard: string;
}
