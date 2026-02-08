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
  userAvatar?: string;
  createdAt?: string;
}

interface User {
  id: string;
  fullName: string;
  email: string;
  userAvatar?: string;
  createdAt: string;
  role: "USER" | "ADMIN";
  booksBorrowed: number;
  universityId: string;
  universityCard: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

interface PendingUser {
  id: string;
  fullName: string;
  email: string;
  userAvatar?: string;
  createdAt: Date;
  universityId: string;
  universityCard: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
}

interface SearchPageProps {
  searchParams: Promise<{
    query?: string;
    filter?: string;
    page?: string;
  }>;
}

interface FileUploadProps {
  onUploadComplete?: (url: string) => void;
  onUploadError?: (error: string) => void;
  onChange?: (url: string) => void;
  value?: string;
  type?: "image" | "video";
  variant?: "dark" | "light";
  placeholder?: string;
  folder?: string;
  accept?: string;
}

interface ReceiptButtonProps {
  borrowRecordId?: string;
  borrowStatus: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
  showOverdueWarning: boolean;
  userRole?: "USER" | "ADMIN";
}

interface BorrowedBookCardProps extends Book {
  borrowDate: Date | string;
  dueDate: Date | string;
  borrowRecordId?: string;
  borrowStatus?: "PENDING" | "BORROWED" | "RETURNED" | "LATE_RETURN";
  returnDate?: Date | string | null;
}

interface UserProfileProps {
  id: string;
  fullName: string;
  email: string;
  universityId: string;
  universityCard: string;
  userAvatar: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
}

interface StatCardProps {
  title: string;
  value: number;
  change: number;
}

interface StatisticsProps {
  totalBooks: number;
  totalUsers: number;
  borrowedBooks: number;
}

interface AccountRequestsProps {
  accountRequests: {
    id: string;
    userAvatar: string | null;
    fullName: string;
    email: string;
  }[];
}

interface AccountRequestCardsProps {
  requests: {
    id: string;
    userAvatar: string | null;
    fullName: string;
    email: string;
  }[];
}

interface BorrowRequestsProps {
  borrowRecords?: Array<{
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    userFullName: string;
    userAvatar: string | null;
    borrowDate: string;
    status: string;
  }>;
}

interface BorrowRequestCardProps {
  record: {
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    userFullName: string;
    userAvatar: string | null;
    borrowDate: string;
    status: string;
  };
}

interface BorrowRequestListProps {
  records: Array<{
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    userFullName: string;
    userAvatar: string | null;
    borrowDate: string;
    status: string;
  }>;
}

interface RecentBooksProps {
  recentBooks: Array<{
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    createdAt: string;
  }>;
}

interface RecentBookCardProps {
  recentBooks: {
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    createdAt: string;
  };
}

interface RecentBookListProps {
  recentBooks: Array<{
    id: string;
    bookTitle: string;
    bookCover: string | null;
    bookGenre: string;
    bookAuthor: string;
    coverColor: string;
    createdAt: string;
  }>;
}

interface UserCellProps {
  fullName: string;
  email: string;
  image?: string | null;
}
