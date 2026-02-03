"use client";

interface Props {
  query: string;
  /** label that matches the current table context, e.g. "users", "books" */
  entity?: string;
  /** how many <th> columns the table has — used for the colspan */
  colSpan?: number;
}

const EmptySearch = ({ query, entity = "results", colSpan = 7 }: Props) => (
  <tr>
    <td colSpan={colSpan} className="search-empty-state">
      {/* magnifying-glass illustration */}
      <svg
        className="search-empty-icon"
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* outer ring */}
        <circle
          cx="28"
          cy="28"
          r="27"
          stroke="#E2E8F0"
          strokeWidth="2"
          fill="#F8FAFC"
        />
        {/* magnifying glass circle */}
        <circle
          cx="25"
          cy="24"
          r="8"
          stroke="#94A3B8"
          strokeWidth="2.2"
          fill="none"
        />
        {/* magnifying glass handle */}
        <line
          x1="31.5"
          y1="30.5"
          x2="37"
          y2="36"
          stroke="#94A3B8"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
        {/* tiny "?" inside glass */}
        <text
          x="25"
          y="27.5"
          textAnchor="middle"
          fontSize="9"
          fontWeight="600"
          fill="#CBD5E1"
          fontFamily="sans-serif"
        >
          ?
        </text>
      </svg>

      <p className="search-empty-title">No {entity} found</p>
      <p className="search-empty-subtitle">
        No {entity} match <span className="search-empty-query">{query}</span>.
        Try a different keyword or clear your search.
      </p>
    </td>
  </tr>
);

export default EmptySearch;
