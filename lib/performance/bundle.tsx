"use client";

import dynamic from "next/dynamic";

export const LazyFileUpload = dynamic(() => import("@/components/FileUpload"), {
  ssr: false,
  loading: () => (
    <div className="upload-file bg-dark-300 text-light-100">
      <span className="font-normal text-light-100">Loading uploader...</span>
    </div>
  ),
});

export const LazyReceiptModal = dynamic(
  () => import("@/components/ReceiptModal"),
  {
    ssr: false,
  },
);

export const LazyImageCropper = dynamic(
  () => import("@/components/ImageCropper"),
  {
    ssr: false,
    loading: () => (
      <div className="cropper-avatar_circle animate-pulse bg-dark-700" />
    ),
  },
);

export const LazyColorPicker = dynamic(
  () => import("@/components/admin/ColorPicker"),
  {
    ssr: false,
    loading: () => (
      <div className="h-10 w-full rounded-xl border border-slate-200 bg-slate-100" />
    ),
  },
);
