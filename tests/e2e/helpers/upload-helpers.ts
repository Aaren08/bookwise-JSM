import { Page } from "@playwright/test";

export const MOCK_IMAGEKIT_AUTH = {
  signature: "mock_signature_upload",
  expire: Math.floor(Date.now() / 1000) + 3600,
  token: "mock_token_upload",
  publicKey: "mock_public_key_upload",
};

export const MOCK_IMAGEKIT_UPLOAD_RESPONSE = {
  fileId: "mock_file_id_abc123",
  name: "upload-test-image.jpg",
  size: 12345,
  filePath: "/users/test/upload-test-image.jpg",
  url: "/images/auth-illustration.png",
  fileType: "image",
};

export async function waitForUploadToComplete(
  page: Page,
  options?: { timeout?: number },
): Promise<void> {
  const timeout = options?.timeout ?? 30_000;
  await page.waitForResponse(
    (response) =>
      response.url().includes("upload.imagekit.io") && response.status() === 200,
    { timeout },
  );
}

export async function waitForUploadProgressToAppear(
  page: Page,
  timeout = 10_000,
) {
  const progressBar = page.locator(".progress").first();
  await progressBar.waitFor({ state: "attached", timeout });
  return progressBar;
}

export async function waitForPreviewToRender(
  page: Page,
  altText = "Uploaded file",
  timeout = 10_000,
) {
  const preview = page.getByAltText(altText);
  await preview.waitFor({ state: "visible", timeout });
  return preview;
}

export const TEST_ASSET_PATHS = {
  VALID_ID: "tests/e2e/data/mock-id.png",
  INVALID_TEXT: "tests/e2e/fixtures/test-assets/invalid-file.txt",
  INVALID_PDF: "tests/e2e/fixtures/test-assets/invalid-file.pdf",
  INVALID_HTML: "tests/e2e/fixtures/test-assets/invalid-file.html",
};
