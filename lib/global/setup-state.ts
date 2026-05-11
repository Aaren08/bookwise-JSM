import { db } from "@/database/drizzle";
import { appSettings } from "@/database/schema";
import { eq } from "drizzle-orm";

import { setCachedSetupState } from "./setup-cache";

export type DatabaseSetupState = {
  initialized: boolean;
  setupCompletedAt: Date | null;
  version: number | null;
};

export async function getSetupStateFromDatabase(): Promise<DatabaseSetupState> {
  const [settings] = await db
    .select({
      initializedAt: appSettings.initializedAt,
      setupCompleted: appSettings.setupCompleted,
      setupCompletedAt: appSettings.setupCompletedAt,
      version: appSettings.version,
    })
    .from(appSettings)
    .where(eq(appSettings.id, true))
    .limit(1);

  if (!settings) {
    return {
      initialized: false,
      setupCompletedAt: null,
      version: null,
    };
  }

  return {
    initialized:
      settings.initializedAt !== null || settings.setupCompleted === true,
    setupCompletedAt: settings.setupCompletedAt,
    version: settings.version,
  };
}

export async function refreshSetupStateCache(): Promise<DatabaseSetupState> {
  const state = await getSetupStateFromDatabase();

  await setCachedSetupState({
    initialized: state.initialized,
    setupCompletedAt: state.setupCompletedAt?.toISOString() ?? null,
    version: state.version,
  });

  return state;
}
