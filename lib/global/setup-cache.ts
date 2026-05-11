import { Redis } from "@upstash/redis";

export const SETUP_STATE_KEY = "bookwise:setup:state";

export type SetupState = {
  initialized: boolean;
  setupCompletedAt: string | null;
  version: number | null;
  cachedAt: string;
};

export type SetupCacheStatus = "initialized" | "uninitialized" | "unknown";

let redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

export async function getCachedSetupStatus(): Promise<SetupCacheStatus> {
  const client = getRedis();
  if (!client) return "unknown";

  try {
    const state = await client.get<SetupState>(SETUP_STATE_KEY);
    if (!state) return "unknown";

    return state.initialized ? "initialized" : "uninitialized";
  } catch (error) {
    console.error("Failed to read setup state cache:", error);
    return "unknown";
  }
}

export async function setCachedSetupState(
  state: Omit<SetupState, "cachedAt">,
): Promise<void> {
  const client = getRedis();
  if (!client) return;

  await client.set(SETUP_STATE_KEY, {
    ...state,
    cachedAt: new Date().toISOString(),
  });
}

export async function clearCachedSetupState(): Promise<void> {
  const client = getRedis();
  if (!client) return;

  await client.del(SETUP_STATE_KEY);
}
