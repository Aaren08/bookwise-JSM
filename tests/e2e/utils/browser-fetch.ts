import { Page } from "@playwright/test";

export type BrowserFetchResult<T = unknown> = {
  status: number;
  headers: Record<string, string>;
  data: T;
};

export async function browserPost<T = unknown>(
  page: Page,
  url: string,
  body: unknown,
): Promise<BrowserFetchResult<T>> {
  return page.evaluate(
    async ({ url, body }: { url: string; body: unknown }) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return {
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        data: (await res.json()) as T,
      };
    },
    { url, body },
  );
}

export async function browserPostConcurrent<T = unknown>(
  page: Page,
  url: string,
  body: unknown,
  count: number,
): Promise<BrowserFetchResult<T>[]> {
  return page.evaluate(
    async ({
      url,
      body,
      count,
    }: {
      url: string;
      body: unknown;
      count: number;
    }) => {
      const results = await Promise.all(
        Array.from({ length: count }, () =>
          fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).then(async (r) => ({
            status: r.status,
            headers: Object.fromEntries(r.headers.entries()),
            data: (await r.json()) as T,
          })),
        ),
      );
      return results;
    },
    { url, body, count },
  );
}

export async function browserPostSequential<T = unknown>(
  page: Page,
  url: string,
  body: unknown,
  count: number,
): Promise<BrowserFetchResult<T>[]> {
  return page.evaluate(
    async ({
      url,
      body,
      count,
    }: {
      url: string;
      body: unknown;
      count: number;
    }) => {
      const results: { status: number; headers: Record<string, string>; data: T }[] = [];
      for (let i = 0; i < count; i++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        results.push({
          status: res.status,
          headers: Object.fromEntries(res.headers.entries()),
          data: (await res.json()) as T,
        });
      }
      return results;
    },
    { url, body, count },
  );
}

