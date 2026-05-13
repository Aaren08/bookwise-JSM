"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  DEFAULT_SYSTEM_CONFIG,
  SystemConfig,
} from "@/lib/global/essentials/system-config";

interface SystemConfigState {
  systemConfig: SystemConfig;
  setSystemConfig: (config: Partial<SystemConfig>) => void;
  resetSystemConfig: () => void;
}

export const useSystemConfigStore = create<SystemConfigState>()(
  persist(
    (set) => ({
      systemConfig: DEFAULT_SYSTEM_CONFIG,
      setSystemConfig: (config) =>
        set((state) => ({
          systemConfig: {
            ...state.systemConfig,
            ...config,
          },
        })),
      resetSystemConfig: () =>
        set({
          systemConfig: DEFAULT_SYSTEM_CONFIG,
        }),
    }),
    {
      name: "bookwise:system-config",
      partialize: (state) => ({ systemConfig: state.systemConfig }),
    },
  ),
);

export const useSystemConfig = () =>
  useSystemConfigStore((state) => state.systemConfig);

export const useBorrowDuration = () =>
  useSystemConfigStore((state) => state.systemConfig.borrowDurationDays);
