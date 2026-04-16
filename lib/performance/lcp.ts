export const AUTH_ILLUSTRATION_SIZES = "(max-width: 639px) 0px, 50vw";

const BOOK_COVER_SIZES = {
  extraSmall: "29px",
  small: "55px",
  medium: "144px",
  regular: "(max-width: 480px) 114px, 174px",
  wide: "(max-width: 480px) 256px, 296px",
} as const;

export type BookCoverSizeVariant = keyof typeof BOOK_COVER_SIZES;

export const getBookCoverSizes = (variant: BookCoverSizeVariant) =>
  BOOK_COVER_SIZES[variant];
