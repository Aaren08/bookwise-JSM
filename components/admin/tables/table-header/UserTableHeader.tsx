"use client";

/**
 * User table header component
 * Extracted for use with partial skeleton loading
 */

export const UserTableHeader = () => (
  <thead className="h-14 bg-blue-50">
    <tr>
      <th className="header-cell">Name</th>
      <th className="header-cell">Date Joined</th>
      <th className="header-cell">Role</th>
      <th className="header-cell">Books Borrowed</th>
      <th className="header-cell">University ID No</th>
      <th className="header-cell">University ID Card</th>
      <th className="header-cell">Action</th>
    </tr>
  </thead>
);
