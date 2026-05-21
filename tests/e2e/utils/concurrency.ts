import { APIRequestContext, APIResponse } from "@playwright/test";

export async function fireConcurrentRequests(
  apiContext: APIRequestContext,
  url: string,
  count: number,
  options?: {
    method?: string;
    data?: unknown;
    headers?: Record<string, string>;
  },
): Promise<APIResponse[]> {
  const { method = "POST", data, headers } = options ?? {};

  const requests = Array.from({ length: count }, () =>
    apiContext.fetch(url, { method, data, headers }),
  );

  return Promise.all(requests);
}

export async function batchConcurrentRequests(
  apiContext: APIRequestContext,
  url: string,
  total: number,
  batchSize: number,
  options?: {
    method?: string;
    data?: unknown;
    headers?: Record<string, string>;
  },
): Promise<APIResponse[]> {
  const results: APIResponse[] = [];
  const { method = "POST", data, headers } = options ?? {};

  for (let offset = 0; offset < total; offset += batchSize) {
    const currentBatchSize = Math.min(batchSize, total - offset);
    const batch = Array.from({ length: currentBatchSize }, () =>
      apiContext.fetch(url, { method, data, headers }),
    );
    const batchResults = await Promise.all(batch);
    results.push(...batchResults);
  }

  return results;
}

export type RateLimitAnalysis = {
  total: number;
  rateLimited: number;
  successful: number;
  errors: number;
  rateLimitedResponses: APIResponse[];
  successfulResponses: APIResponse[];
  errorResponses: APIResponse[];
};

export async function analyzeRateLimitResponses(
  responses: APIResponse[],
): Promise<RateLimitAnalysis> {
  const rateLimitedResponses: APIResponse[] = [];
  const successfulResponses: APIResponse[] = [];
  const errorResponses: APIResponse[] = [];

  for (const response of responses) {
    const status = response.status();
    if (status === 429) {
      rateLimitedResponses.push(response);
    } else if (status >= 200 && status < 300) {
      successfulResponses.push(response);
    } else {
      errorResponses.push(response);
    }
  }

  return {
    total: responses.length,
    rateLimited: rateLimitedResponses.length,
    successful: successfulResponses.length,
    errors: errorResponses.length,
    rateLimitedResponses,
    successfulResponses,
    errorResponses,
  };
}

export async function collectResponseStatuses(
  responses: APIResponse[],
): Promise<{ status: number; headers: Record<string, string>; body: string }[]> {
  return Promise.all(
    responses.map(async (r) => ({
      status: r.status(),
      headers: r.headers(),
      body: await r.text(),
    })),
  );
}
