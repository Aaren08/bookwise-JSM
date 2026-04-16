"use client";

/**
 * Borrow table header component
 * Extracted for use with partial skeleton loading
 */
export const BorrowTableHeader = () => (
  <thead className="h-14 bg-blue-50">
    <tr>
      <th className="header-cell">Book</th>
      <th className="header-cell">User Requested</th>
      <th className="header-cell">Status</th>
      <th className="header-cell">Borrowed Date</th>
      <th className="header-cell">Return Date</th>
      <th className="header-cell">Due Date</th>
      <th className="header-cell">Receipt</th>
    </tr>
  </thead>
);
