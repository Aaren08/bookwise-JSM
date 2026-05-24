import { vi, afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
