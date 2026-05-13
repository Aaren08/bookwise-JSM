"use client";

import { ReactNode, useEffect } from "react";

import { SystemConfig } from "@/lib/global/essentials/system-config";
import { useSystemConfigStore } from "@/lib/store/system-config-store";

interface SystemConfigProviderProps {
  children: ReactNode;
  config: SystemConfig;
}

const SystemConfigProvider = ({
  children,
  config,
}: SystemConfigProviderProps) => {
  const setSystemConfig = useSystemConfigStore(
    (state) => state.setSystemConfig,
  );

  useEffect(() => {
    setSystemConfig(config);
  }, [config, setSystemConfig]);

  return children;
};

export default SystemConfigProvider;
