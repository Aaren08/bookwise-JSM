"use client";

import { LoaderPinwheel } from "lucide-react";
import type { AdminRowLock } from "@/lib/admin/realtime/concurrency/adminRealtimeEvents";

interface RowLockIndicatorProps {
  lock: AdminRowLock | null;
}

const RowLockIndicator = ({ lock }: RowLockIndicatorProps) => {
  if (!lock) return null;

  return (
    <div className="row-lock_container">
      <div className="row-lock_badge">
        <span className="row-lock_icon-wrapper">
          <LoaderPinwheel className="size-3.5 animate-spin" />
        </span>
        <div className="row-lock_tooltip">
          Currently being edited by {lock.adminName}
        </div>
      </div>
    </div>
  );
};

export default RowLockIndicator;
