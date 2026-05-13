import { eq } from "drizzle-orm";

import { db } from "@/database/drizzle";
import { appSettings } from "@/database/schema";
import {
  DEFAULT_SYSTEM_CONFIG,
  SystemConfig,
} from "@/lib/global/essentials/system-config";

export { DEFAULT_SYSTEM_CONFIG };
export {
  formatBorrowDuration,
  getDueDateFromBorrowDuration,
} from "@/lib/global/essentials/system-config";
export type { SystemConfig };

export const getSystemConfig = async (): Promise<SystemConfig> => {
  try {
    const [settings] = await db
      .select({
        instituteName: appSettings.universityName,
        websiteUrl: appSettings.websiteUrl,
        supportEmail: appSettings.supportEmail,
        borrowDurationDays: appSettings.borrowDurationDays,
      })
      .from(appSettings)
      .where(eq(appSettings.id, true))
      .limit(1);

    if (!settings) {
      return DEFAULT_SYSTEM_CONFIG;
    }

    return settings;
  } catch (error) {
    console.error("[getSystemConfig]", error);
    return DEFAULT_SYSTEM_CONFIG;
  }
};

export const getBorrowDurationDays = async () =>
  (await getSystemConfig()).borrowDurationDays;
