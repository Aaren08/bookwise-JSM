"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Input } from "./ui/input";

interface SearchFormProps {
  initialQuery?: string;
}

const SearchForm = ({ initialQuery = "" }: SearchFormProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (query.trim()) {
      const params = new URLSearchParams(searchParams);
      params.set("query", query.trim());
      params.delete("page"); // Reset to page 1 on new search
      router.push(`/search?${params.toString()}`);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };

  return (
    <form onSubmit={handleSubmit} className="search">
      <Image
        src="/icons/search-fill.svg"
        alt="search"
        width={24}
        height={24}
        className="ml-2"
      />
      <Input
        type="text"
        placeholder="Search for books, authors, genres..."
        value={query}
        onChange={handleInputChange}
        className="search-input"
      />
    </form>
  );
};

export default SearchForm;
