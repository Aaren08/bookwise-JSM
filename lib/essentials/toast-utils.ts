import { toast } from "sonner";

export const showSuccessToast = (message: string) => {
  toast.success(message, {
    position: "top-right",
    style: {
      background: "#dcfce7",
      color: "#000000",
      border: "1px solid #86efac",
    },
    className: "!bg-green-200 !text-black",
  });
};

export const showErrorToast = (message: string) => {
  toast.error(message, {
    position: "top-right",
    style: {
      background: "#fee2e2",
      color: "#000000",
      border: "1px solid #fca5a5",
    },
    className: "!bg-red-200 !text-black",
  });
};

export const showFileSuccessToast = (message: string, desc?: string) => {
  toast.success(message, {
    position: "top-right",
    description: desc,
    style: {
      background: "#dcfce7",
      color: "#000000",
      border: "1px solid #86efac",
    },
    className: "!bg-green-200 !text-black",
  });
};

export const showFileWarningToast = (message: string, desc?: string) => {
  toast.warning(message, {
    position: "top-right",
    description: desc || "The upload process was cancelled",
    style: {
      background: "#fee2e2",
      color: "#000000",
      border: "1px solid #fca5a5",
    },
    className: "!bg-orange-100 !text-black",
  });
};

export const showFileInfoToast = (message: string, desc?: string) => {
  toast.info(message, {
    position: "top-right",
    description: desc || "You can upload a new file",
    style: {
      background: "#fee2e2",
      color: "#000000",
      border: "1px solid #fca5a5",
    },
    className: "!bg-orange-100 !text-black",
  });
};

export const showFileErrorToast = (message: string, desc?: string) => {
  toast.error(message, {
    position: "top-right",
    description: desc,
    style: {
      background: "#fee2e2",
      color: "#000000",
      border: "1px solid #fca5a5",
    },
    className: "!bg-red-200 !text-black",
  });
};
