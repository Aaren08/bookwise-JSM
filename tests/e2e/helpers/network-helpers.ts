import { Page } from "@playwright/test";

export interface InterceptedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
}

export interface InterceptedResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: unknown;
  timestamp: number;
}

export interface ImageKitAuthRequest {
  signature: string;
  expire: number;
  token: string;
  publicKey: string;
}

export interface ImageKitUploadRequest {
  file?: string;
  fileName?: string;
  folder?: string;
  publicKey?: string;
  signature?: string;
  expire?: string;
  token?: string;
}

export interface AvatarApiRequest {
  imageUrl?: string;
  fileId?: string;
  image?: string;
}

export class NetworkInterceptor {
  private authRequests: InterceptedRequest[] = [];
  private uploadRequests: InterceptedRequest[] = [];
  private avatarApiRequests: InterceptedRequest[] = [];
  private authResponses: InterceptedResponse[] = [];
  private uploadResponses: InterceptedResponse[] = [];
  private avatarApiResponses: InterceptedResponse[] = [];
  private consoleErrors: string[] = [];
  private failedRequests: InterceptedResponse[] = [];
  private corsFailures: string[] = [];
  private brokenImages: string[] = [];
  private routeUnfulfilled: boolean;

  constructor(private page: Page) {
    this.routeUnfulfilled = false;
  }

  async install(): Promise<void> {
    this.page.on("console", (msg) => {
      if (msg.type() === "error") {
        this.consoleErrors.push(msg.text());
      }
    });

    this.page.on("response", (response) => {
      const url = response.url();

      if (response.status() >= 400) {
        this.failedRequests.push({
          url,
          status: response.status(),
          statusText: response.statusText(),
          headers: response.headers(),
          timestamp: Date.now(),
        });
      }

      const contentType = response.headers()["content-type"] || "";
      if (
        url.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i) &&
        (response.status() >= 400 || !contentType.startsWith("image/"))
      ) {
        this.brokenImages.push(url);
      }
    });

    this.page.on("response", (response) => {
      const corsHeader = response.headers()["access-control-allow-origin"];
      if (!corsHeader && response.url().includes("imagekit")) {
        if (!this.corsFailures.includes(response.url())) {
          this.corsFailures.push(response.url());
        }
      }
    });
  }

  async interceptImageKitAuth(): Promise<void> {
    await this.page.route("**/api/auth/imagekit", async (route) => {
      const request: InterceptedRequest = {
        url: route.request().url(),
        method: route.request().method(),
        headers: await route.request().allHeaders(),
        timestamp: Date.now(),
      };
      this.authRequests.push(request);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          signature: `test_sig_${Date.now()}`,
          expire: Math.floor(Date.now() / 1000) + 3600,
          token: `test_token_${Date.now()}`,
          publicKey: "test_public_key",
        }),
      });
    });
  }

  async interceptImageKitUpload(
    responseOverrides?: Partial<{
      status: number;
      body: Record<string, unknown>;
      delay: number;
    }>,
  ): Promise<void> {
    await this.page.route("https://upload.imagekit.io/**", async (route) => {
      const postBody = route.request().postData();
      const request: InterceptedRequest = {
        url: route.request().url(),
        method: route.request().method(),
        headers: await route.request().allHeaders(),
        body: postBody,
        timestamp: Date.now(),
      };
      this.uploadRequests.push(request);

      const status = responseOverrides?.status ?? 200;
      const body = responseOverrides?.body ?? {
        fileId: `test_file_${Date.now()}`,
        name: "test-upload.jpg",
        size: 45678,
        filePath: "/users/test/test-upload.jpg",
        url: "/images/auth-illustration.png",
        fileType: "image",
      };

      if (responseOverrides?.delay) {
        await new Promise((r) => setTimeout(r, responseOverrides.delay));
      }

      const response: InterceptedResponse = {
        url: route.request().url(),
        status,
        statusText: status === 200 ? "OK" : "Error",
        headers: { "content-type": "application/json" },
        body,
        timestamp: Date.now(),
      };
      this.uploadResponses.push(response);

      await route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
  }

  async interceptAvatarApi(): Promise<void> {
    await this.page.route("**/api/avatar", async (route) => {
      const method = route.request().method();
      if (method === "POST" || method === "PUT") {
        let body: unknown = undefined;
        const postData = route.request().postData();
        if (postData) {
          try {
            body = JSON.parse(postData);
          } catch {
            body = postData;
          }
        }
        const request: InterceptedRequest = {
          url: route.request().url(),
          method,
          headers: await route.request().allHeaders(),
          body,
          timestamp: Date.now(),
        };

        if (method === "POST") {
          this.avatarApiRequests.push(request);
          const hasUrl =
            body &&
            typeof body === "object" &&
            "imageUrl" in (body as Record<string, unknown>);
          if (!hasUrl) {
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({
                error: "Image URL and File ID are required",
              }),
            });
            return;
          }
        }

        if (method === "PUT") {
          this.avatarApiRequests.push(request);
          const hasImage =
            body &&
            typeof body === "object" &&
            "image" in (body as Record<string, unknown>);
          if (!hasImage) {
            await route.fulfill({
              status: 400,
              contentType: "application/json",
              body: JSON.stringify({ error: "Image is required" }),
            });
            return;
          }
        }

        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ success: true }),
        });
      } else {
        await route.continue();
      }
    });
  }

  async interceptAvatarApiWithError(
    status: number,
    errorMessage: string,
  ): Promise<void> {
    await this.page.route("**/api/avatar", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify({ error: errorMessage }),
        });
      } else {
        await route.continue();
      }
    });
  }

  async interceptSessionUpdate(): Promise<void> {
    await this.page.route("**/api/auth/session", async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        const response = await route.fetch();
        const body = await response.json();
        if (body?.user?.image) {
          body.user.image = "/images/auth-illustration.png";
        }
        await route.fulfill({
          status: response.status(),
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({}), // next-auth session update returns empty
        });
        this.routeUnfulfilled = true;
      }
    });
  }

  async setImageKitAuthFailure(): Promise<void> {
    await this.page.route("**/api/auth/imagekit", (route) => {
      route.fulfill({ status: 500, body: "Internal Server Error" });
    });
  }

  async setImageKitUploadFailure(status = 500, body?: string): Promise<void> {
    await this.page.route("https://upload.imagekit.io/**", (route) => {
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({
          error: body || "Upload failed",
          message: "Mock upload failure",
        }),
      });
    });
  }

  async setImageKitAuthExpired(): Promise<void> {
    await this.page.route("**/api/auth/imagekit", (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          signature: "expired_sig",
          expire: Math.floor(Date.now() / 1000) - 3600,
          token: "expired_token",
          publicKey: "test_public_key",
        }),
      });
    });
  }

  async setUploadNetworkDelay(delayMs: number): Promise<void> {
    await this.page.route("https://upload.imagekit.io/**", async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          fileId: `test_file_${Date.now()}`,
          name: "delayed-upload.jpg",
          size: 45678,
          filePath: "/users/test/delayed-upload.jpg",
          url: "/images/auth-illustration.png",
          fileType: "image",
        }),
      });
    });
  }

  getAuthRequests(): InterceptedRequest[] {
    return [...this.authRequests];
  }

  getUploadRequests(): InterceptedRequest[] {
    return [...this.uploadRequests];
  }

  getAvatarApiRequests(): InterceptedRequest[] {
    return [...this.avatarApiRequests];
  }

  getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  getFailedRequests(): InterceptedResponse[] {
    return [...this.failedRequests];
  }

  getBrokenImages(): string[] {
    return [...this.brokenImages];
  }

  getCorsFailures(): string[] {
    return [...this.corsFailures];
  }

  async dispose(): Promise<void> {
    await this.page.unroute("**/api/auth/imagekit");
    await this.page.unroute("https://upload.imagekit.io/**");
    await this.page.unroute("**/api/avatar");
    await this.page.unroute("**/api/auth/session");
  }
}
