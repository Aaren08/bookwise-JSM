# Admin Dashboard

## Overview

The admin dashboard provides comprehensive management tools for library administrators to oversee all aspects of the BookWise system. It includes user management, book catalog administration, borrowing oversight, and system analytics.

## Dashboard Structure

### Route Organization

Admin routes are organized under `/admin` with role-based protection:

```
admin/
├── layout.tsx          # Admin layout with sidebar
├── page.tsx           # Dashboard home
├── users/             # User management
├── books/             # Book catalog management
├── borrow-records/    # Borrowing oversight
└── account-requests/  # Account approval queue
```

### Layout Components

#### AdminLayout

```tsx
// app/admin/layout.tsx
const Layout = async ({ children }) => {
  // Role verification
  const isAdmin = await verifyAdminRole(session.user.id);

  if (!isAdmin) redirect("/");

  return (
    <main>
      <Sidebar session={session} />
      {children}
    </main>
  );
};
```

#### Sidebar Navigation

```tsx
const adminSideBarLinks = [
  { img: "/icons/admin/home.svg", route: "/admin", text: "Home" },
  { img: "/icons/admin/users.svg", route: "/admin/users", text: "All Users" },
  { img: "/icons/admin/book.svg", route: "/admin/books", text: "All Books" },
  {
    img: "/icons/admin/borrow.svg",
    route: "/admin/borrow-records",
    text: "Borrow Records",
  },
  {
    img: "/icons/admin/request.svg",
    route: "/admin/account-requests",
    text: "Account Requests",
  },
];
```

## Dashboard Home

### Statistics Overview

The main dashboard displays key metrics:

```tsx
<Statistics
  totalBooks={stats.totalBooks}
  totalUsers={stats.totalUsers}
  borrowedBooks={stats.borrowedBooks}
/>
```

**Metrics Tracked:**

- Total books in catalog
- Total registered users
- Currently borrowed books
- Pending account approvals

### Recent Activity

Shows recent system activity:

- New user registrations
- Recent book additions
- Borrow approvals
- Overdue returns

### Quick Actions

Fast access to common tasks:

- Approve pending accounts
- Add new books
- View overdue books
- Generate reports

## User Management

### User List View

Comprehensive user management interface:

```tsx
<UserTable
  users={users}
  onStatusChange={handleStatusChange}
  onRoleChange={handleRoleChange}
  onDelete={handleDelete}
/>
```

**Features:**

- Search and filter users
- Bulk status updates
- Role management (USER ↔ ADMIN)
- Account deletion
- Export user data

### Account Approval

Dedicated interface for account requests:

```tsx
<AccountRequestsTable
  pendingUsers={pendingUsers}
  onApprove={handleApprove}
  onReject={handleReject}
/>
```

**Approval Process:**

1. Review user details and university card
2. Approve or reject account
3. Send notification email
4. Update user status

### User Details Modal

Detailed user information view:

```tsx
<UserDetailsModal
  user={selectedUser}
  borrowHistory={userBorrowHistory}
  onStatusChange={handleStatusChange}
/>
```

## Book Management

### Book Catalog Administration

Full CRUD operations for books:

```tsx
<BookTable
  books={books}
  onEdit={handleEdit}
  onDelete={handleDelete}
  onAdd={handleAdd}
/>
```

### Book Creation Form

Comprehensive book addition form:

```tsx
<BookForm onSubmit={handleCreateBook} initialData={null} />
```

**Required Fields:**

- Title, author, genre
- Copy count and availability
- Cover image and color
- Description and summary
- Video trailer URL

### Book Editing

In-place editing or modal forms:

```tsx
<BookEditModal
  book={selectedBook}
  onSave={handleUpdateBook}
  onCancel={handleCancel}
/>
```

### Bulk Operations

- Bulk delete books
- Bulk update availability
- Import books from CSV

## Borrow Records Management

### Borrow Records Table

Complete borrowing oversight:

```tsx
<BorrowRecordsTable
  records={borrowRecords}
  onStatusChange={handleStatusChange}
  onGenerateReceipt={handleGenerateReceipt}
/>
```

**Features:**

- Filter by status, user, book, date
- Sort by borrow date, due date
- Bulk status updates
- Receipt generation

### Status Management

Update borrow statuses:

```typescript
const updateBorrowStatus = async (
  recordId: string,
  newStatus: BorrowStatus,
) => {
  // Update record status
  await db
    .update(borrowRecords)
    .set({ borrowStatus: newStatus })
    .where(eq(borrowRecords.id, recordId));

  // Update book availability if needed
  if (newStatus === "BORROWED") {
    await db
      .update(books)
      .set({ availableCopies: sql`${books.availableCopies} - 1` })
      .where(eq(books.id, bookId));
  }
};
```

### Receipt Generation

Generate and download receipts:

```tsx
<GenerateReceipt borrowRecordId={record.id} status={record.borrowStatus} />
```

## Analytics and Reporting

### Dashboard Statistics

Real-time metrics with change indicators:

```tsx
const Statistics = ({ totalBooks, totalUsers, borrowedBooks }) => {
  // Calculate changes from previous values
  const booksChange = totalBooks - previousStats.totalBooks;
  // Display with trend indicators
};
```

### Usage Reports

- Monthly borrowing trends
- Popular books analytics
- User activity reports
- System performance metrics

## Search and Filtering

### Global Search

Search across all entities:

```tsx
<AdminSearch onSearch={handleSearch} searchType={searchType} />
```

**Search Types:**

- Users (by name, email, university ID)
- Books (by title, author, genre)
- Borrow records (by user, book, status)

### Advanced Filtering

Filter tables by multiple criteria:

```tsx
<FilterData
  filters={activeFilters}
  onFilterChange={handleFilterChange}
  availableFilters={filterOptions}
/>
```

## Data Export

### Export Functionality

Export data in various formats:

```typescript
const exportUsers = async (format: "csv" | "json") => {
  const users = await getAllUsers();
  if (format === "csv") {
    return generateCSV(users);
  }
  return JSON.stringify(users);
};
```

### Supported Formats

- CSV for spreadsheet analysis
- JSON for API integration
- PDF reports for printing

## Security and Permissions

### Role-Based Access

Strict admin role verification:

```typescript
const verifyAdminAccess = async (userId: string) => {
  const user = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user[0]?.role === "ADMIN";
};
```

### Audit Logging

All admin actions are logged:

```typescript
const logAdminAction = async (
  adminId: string,
  action: string,
  targetId: string,
  details: object,
) => {
  await db.insert(adminLogs).values({
    adminId,
    action,
    targetId,
    details: JSON.stringify(details),
    timestamp: new Date(),
  });
};
```

## Performance Optimizations

### Data Pagination

Large datasets are paginated:

```typescript
const getUsersPaginated = async (
  page: number,
  limit: number,
  filters: UserFilters,
) => {
  const offset = (page - 1) * limit;
  return await db
    .select()
    .from(users)
    .where(buildWhereClause(filters))
    .limit(limit)
    .offset(offset);
};
```

### Caching Strategy

- API responses cached with revalidation
- Static dashboard data cached
- Real-time updates for critical metrics

## Mobile Responsiveness

Admin dashboard is fully responsive:

- Collapsible sidebar for mobile
- Touch-friendly interface
- Optimized table layouts
- Mobile-specific navigation

## Related Components

- `AdminSearch.tsx` - Global search component
- `BookOverview.tsx` - Book management interface
- `UserApprovalModal.tsx` - Account approval modal
- `FilterData.tsx` - Filtering controls
- `GenerateReceipt.tsx` - Receipt generation
- `DashboardLayout.tsx` - Dashboard layout wrapper
- `Statistics.tsx` - Metrics display component

## API Endpoints

### Dashboard Data

```typescript
// Get dashboard statistics
GET / admin / api / dashboard / stats;

// Get recent activity
GET / admin / api / dashboard / activity;
```

### User Management

```typescript
// Get users with pagination
GET /admin/api/users?page=1&limit=20

// Update user status
PUT /admin/api/users/[id]/status

// Delete user
DELETE /admin/api/users/[id]
```

### Book Management

```typescript
// Get books with pagination
GET /admin/api/books?page=1&limit=20

// Create book
POST /admin/api/books

// Update book
PUT /admin/api/books/[id]

// Delete book
DELETE /admin/api/books/[id]
```

### Borrow Management

````typescript
// Get borrow records
GET /admin/api/borrow-records

// Update borrow status
PUT /admin/api/borrow-records/[id]/status

// Generate receipt
POST /admin/api/receipts/generate
```</content>
<parameter name="filePath">d:\Full Stack\Next.js\bookwise\documentation\Admin_Dashboard.md
````
