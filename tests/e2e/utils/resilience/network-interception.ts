import { Page } from "@playwright/test";

export type InterceptionHandler = (route: ReturnType<Page["route"] extends (p: string, h: infer H) => void ? H : never>) => void | Promise<void>;

export interface BlockRule {
  urlPattern: string | RegExp;
  method?: string;
  statusCode?: number;
  contentType?: string;
  responseBody?: string;
  abortReason?: string;
}

export class NetworkInterceptor {
  private rules: BlockRule[] = [];

  constructor(private page: Page) {}

  async blockApiRequests(): Promise<void> {
    await this.page.route("**/api/**", (route) => {
      route.abort("connectionrefused");
    });
  }

  async restoreApiRequests(): Promise<void> {
    await this.page.unroute("**/api/**");
  }

  async blockEndpoint(pattern: string | RegExp): Promise<void> {
    await this.page.route(pattern, (route) => {
      route.abort("connectionrefused");
    });
  }

  async unblockEndpoint(pattern: string | RegExp): Promise<void> {
    await this.page.unroute(pattern);
  }

  async setEndpointResponse(
    pattern: string | RegExp,
    status: number,
    body?: string,
  ): Promise<void> {
    await this.page.route(pattern, (route) => {
      route.fulfill({ status, body: body ?? "" });
    });
  }

  async applyRules(rules: BlockRule[]): Promise<void> {
    for (const rule of rules) {
      await this.page.route(rule.urlPattern, (route) => {
        if (rule.method && route.request().method() !== rule.method) {
          return route.continue();
        }
        if (rule.abortReason) {
          return route.abort(rule.abortReason as Parameters<typeof route.abort>[0]);
        }
        return route.fulfill({
          status: rule.statusCode ?? 503,
          contentType: rule.contentType ?? "text/plain",
          body: rule.responseBody ?? "Service Unavailable",
        });
      });
    }
  }

  async clearAllRules(): Promise<void> {
    await this.page.unroute("**/*");
  }

  async interceptNavigation(
    urlPattern: string | RegExp,
    responseBody: string,
  ): Promise<void> {
    await this.page.route(urlPattern, (route) => {
      if (route.request().method() === "GET" || route.request().method() === "POST") {
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: responseBody,
        });
      } else {
        route.continue();
      }
    });
  }
}

export function createNetworkInterceptor(page: Page): NetworkInterceptor {
  return new NetworkInterceptor(page);
}
