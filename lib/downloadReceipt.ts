export type Receipt = {
  receiptId: string;
  issuedAt: string;
  title: string;
  author: string;
  genre: string;
  borrowedOn: string;
  dueDate: string;
  duration: string;
  userName?: string;
  userEmail?: string;
};

export const downloadReceiptAsPDF = async (
  receipt: Receipt,
): Promise<boolean> => {
  try {
    // Dynamically import libraries
    const { default: jsPDF } = await import("jspdf");
    const { domToPng } = await import("modern-screenshot");

    // Get the entire receipt container
    const receiptContainer = document.querySelector(
      ".receipt-container",
    ) as HTMLElement;

    if (!receiptContainer) {
      console.error("Receipt container not found");
      return false;
    }

    // Create a wrapper div to clone the receipt without buttons
    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-9999px";
    wrapper.style.top = "0";
    wrapper.style.width = receiptContainer.offsetWidth + "px";

    // Clone the receipt container
    const clonedReceipt = receiptContainer.cloneNode(true) as HTMLElement;

    // Remove buttons from the clone
    const closeBtn = clonedReceipt.querySelector(".modal-close-btn");
    const downloadBtns = clonedReceipt.querySelectorAll("button");

    // Remove close button
    if (closeBtn) closeBtn.remove();

    // Remove all buttons (including download button)
    downloadBtns.forEach((btn) => {
      // Check if it's the download button by looking for the Download icon or the classes
      if (
        btn.classList.contains("absolute") ||
        btn.querySelector("svg") ||
        btn !== closeBtn
      ) {
        btn.remove();
      }
    });

    // Append clone to wrapper and wrapper to body
    wrapper.appendChild(clonedReceipt);
    document.body.appendChild(wrapper);

    // Wait for styles to apply
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Capture the cloned receipt
    const dataUrl = await domToPng(clonedReceipt, {
      scale: 3,
      backgroundColor: null,
    });

    // Remove the wrapper
    document.body.removeChild(wrapper);

    // Create image to get actual dimensions
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataUrl;
    });

    // Create PDF with image dimensions
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "px",
      format: [img.width, img.height],
    });

    pdf.addImage(dataUrl, "PNG", 0, 0, img.width, img.height);
    pdf.save(`receipt-${receipt.receiptId}.pdf`);

    return true;
  } catch (error) {
    console.error("Error generating PDF:", error);
    return false;
  }
};
