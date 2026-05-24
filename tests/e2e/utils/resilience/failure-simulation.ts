import { Page } from "@playwright/test";

export interface RouteInterceptionConfig {
  urlPattern: string | RegExp;
  method?: string;
  status?: number;
  body?: string;
  delay?: number;
  abort?: boolean;
}

export class FailureSimulator {
  constructor(private page: Page) {}

  async simulateNetworkOffline(): Promise<void> {
    await this.page.route("**/*", (route) => {
      if (
        route.request().url().includes("localhost:3000") &&
        !route.request().url().includes("/_next/webpack-hmr")
      ) {
        route.abort("internetdisconnected");
      } else {
        route.continue();
      }
    });
  }

  async restoreNetwork(): Promise<void> {
    await this.page.unroute("**/*");
  }

  async blockRequests(configs: RouteInterceptionConfig[]): Promise<void> {
    for (const config of configs) {
      await this.page.route(config.urlPattern, (route) => {
        if (config.method && route.request().method() !== config.method) {
          return route.continue();
        }
        if (config.abort) {
          return route.abort("connectionrefused");
        }
        if (config.delay) {
          return new Promise<void>((resolve) => {
            setTimeout(() => {
              route.fulfill({
                status: config.status ?? 503,
                body: config.body ?? "Service Unavailable",
              }).then(resolve);
            }, config.delay);
          });
        }
        return route.fulfill({
          status: config.status ?? 503,
          body: config.body ?? "Service Unavailable",
        });
      });
    }
  }

  async failServerAction(endpointPattern: string | RegExp): Promise<void> {
    await this.page.route(endpointPattern, (route) => {
      if (route.request().method() === "POST") {
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated server action failure" }),
        });
      } else {
        route.continue();
      }
    });
  }

  async simulateSlowResponse(
    urlPattern: string | RegExp,
    delayMs: number,
  ): Promise<void> {
    await this.page.route(urlPattern, async (route) => {
      await new Promise((r) => setTimeout(r, delayMs));
      await route.continue();
    });
  }

  async simulateSseInterruption(sseEndpoint: string): Promise<() => Promise<void>> {
    await this.page.route(sseEndpoint, (route) => {
      route.abort("connectionrefused");
    });

    return async () => {
      await this.page.unroute(sseEndpoint);
    };
  }

  async simulateMidNavigationNetworkFailure(
    triggerNavigation: () => Promise<void>,
    disconnectDelay = 500,
  ): Promise<void> {
    setTimeout(async () => {
      await this.simulateNetworkOffline();
    }, disconnectDelay);

    await triggerNavigation();

    await this.page.waitForTimeout(2000);
  }

  async blockEndpointAndRestore(
    urlPattern: string | RegExp,
    durationMs: number,
  ): Promise<void> {
    await this.blockRequests([{ urlPattern, status: 503 }]);
    await this.page.waitForTimeout(durationMs);
    await this.page.unroute(urlPattern);
  }
}

export function createFailureSimulator(page: Page): FailureSimulator {
  return new FailureSimulator(page);
}
