"use client";

/**
 * Book table header component
 * Extracted for use with PartialTableWrapper
 */

export const BookTableHeader = () => (
  <thead className="h-14 bg-blue-50">
    <tr>
      <th className="header-cell">Book Title</th>
      <th className="header-cell">Author</th>
      <th className="header-cell">Genre</th>
      <th className="header-cell">Date Created</th>
      <th className="header-cell">Action</th>
    </tr>
  </thead>
);
