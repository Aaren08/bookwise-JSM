import { Page, expect } from "@playwright/test";

export interface ConsoleViolation {
  type: "uncaught_exception" | "unhandled_rejection" | "hydration_error" | "app_error" | "react_error";
  text: string;
  timestamp: number;
}

export interface FailedRequest {
  url: string;
  status: number;
  statusText: string;
  timestamp: number;
}

export class ConsoleMonitor {
  private violations: ConsoleViolation[] = [];
  private failedRequests: FailedRequest[] = [];
  private active = false;

  constructor(private page: Page) {}

  install(): void {
    if (this.active) return;
    this.active = true;

    this.page.on("console", (msg) => {
      const text = msg.text();

      if (msg.type() === "error") {
        if (/uncaught|exception|Uncaught/i.test(text)) {
          this.violations.push({ type: "uncaught_exception", text, timestamp: Date.now() });
        }
        if (/unhandled|rejection|Unhandled/i.test(text)) {
          this.violations.push({ type: "unhandled_rejection", text, timestamp: Date.now() });
        }
        if (/hydration|mismatch|Hydration/i.test(text)) {
          this.violations.push({ type: "hydration_error", text, timestamp: Date.now() });
        }
        if (/Internal Server Error|500|server error|application error/i.test(text)) {
          this.violations.push({ type: "app_error", text, timestamp: Date.now() });
        }
        if (/React|Minified React error|react-dom/i.test(text)) {
          this.violations.push({ type: "react_error", text, timestamp: Date.now() });
        }
      }
    });

    this.page.on("response", (res) => {
      if (res.status() >= 500) {
        this.failedRequests.push({
          url: res.url(),
          status: res.status(),
          statusText: res.statusText(),
          timestamp: Date.now(),
        });
      }
    });

    this.page.on("pageerror", (err) => {
      this.violations.push({ type: "uncaught_exception", text: err.message, timestamp: Date.now() });
    });
  }

  getViolations(): ConsoleViolation[] {
    return [...this.violations];
  }

  getFailedRequests(): FailedRequest[] {
    return [...this.failedRequests];
  }

  getCriticalViolations(filterPatterns: string[] = []): ConsoleViolation[] {
    return this.violations.filter(
      (v) => !filterPatterns.some((p) => v.text.includes(p)),
    );
  }

  getCriticalFailedRequests(filterPatterns: string[] = []): FailedRequest[] {
    return this.failedRequests.filter(
      (r) => !filterPatterns.some((p) => r.url.includes(p)),
    );
  }

  assertNoCriticalViolations(filterPatterns?: string[]): void {
    const critical = this.getCriticalViolations(filterPatterns);
    expect(critical, `Console violations: ${critical.map((v) => `[${v.type}] ${v.text}`).join("; ")}`).toHaveLength(0);
  }

  assertNoServerErrors(filterPatterns?: string[]): void {
    const critical = this.getCriticalFailedRequests(filterPatterns);
    expect(critical, `Server errors: ${critical.map((r) => `${r.status} ${r.url}`).join("; ")}`).toHaveLength(0);
  }

  reset(): void {
    this.violations = [];
    this.failedRequests = [];
  }

  detach(): void {
    this.active = false;
  }
}

export function createConsoleMonitor(page: Page): ConsoleMonitor {
  const monitor = new ConsoleMonitor(page);
  monitor.install();
  return monitor;
}
