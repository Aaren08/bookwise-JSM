"use client";

import Image from "next/image";
import { Button } from "@/components/ui/button";

const GenerateReceipt = () => {
  const handleGenerate = () => {
    console.log("Generate receipt");
  };

  return (
    <Button onClick={handleGenerate} variant="outline" className="generate-btn">
      <Image
        src="/icons/admin/receipt.svg"
        alt="receipt"
        width={16}
        height={16}
      />
      Generate
    </Button>
  );
};

export default GenerateReceipt;
