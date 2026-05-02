"use client";

import { useSessionInvalidation } from "@/lib/admin/realtime/session/useSessionInvalidation";

const SessionGuard = () => {
  useSessionInvalidation();
  return null; // renders nothing, just runs the hook
};

export default SessionGuard;
