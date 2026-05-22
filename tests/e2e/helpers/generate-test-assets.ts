import fs from "fs";
import path from "path";

const ASSETS_DIR = path.resolve(__dirname, "../fixtures/test-assets");
const DATA_DIR = path.resolve(__dirname, "../data");

function generateAllAssets(): void {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  let count = 0;

  const existingId = path.join(DATA_DIR, "mock-id.png");
  const destId = path.join(ASSETS_DIR, "valid-id.png");
  if (fs.existsSync(existingId) && !fs.existsSync(destId)) {
    fs.copyFileSync(existingId, destId);
    console.log(`  ✓ copied mock-id.png → valid-id.png`);
    count++;
  }

  const textFiles: Array<{ fileName: string; content: string }> = [
    { fileName: "invalid-file.txt", content: "This is not an image file. It should be rejected by the upload validator." },
    {
      fileName: "invalid-file.pdf",
      content: "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF",
    },
    {
      fileName: "invalid-file.html",
      content: "<!DOCTYPE html><html><body>Not an image file for upload testing</body></html>",
    },
  ];

  for (const { fileName, content } of textFiles) {
    const filePath = path.join(ASSETS_DIR, fileName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`  ✓ ${fileName}`);
      count++;
    }
  }

  console.log(`\n✅ ${count} test assets ready in ${ASSETS_DIR}`);
}

generateAllAssets();

export {};
