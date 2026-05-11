import { ReactNode } from "react";
import { redirect } from "next/navigation";

import { refreshSetupStateCache } from "@/lib/global/setup-state";

const SystemLayout = async ({ children }: { children: ReactNode }) => {
  const setupState = await refreshSetupStateCache();

  if (setupState.initialized) {
    redirect("/");
  }

  return children;
};

export default SystemLayout;
