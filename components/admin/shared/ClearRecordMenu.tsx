"use client";

import { useState, useRef, useEffect } from "react";
import { Trash2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { clearBorrowRecords } from "@/lib/admin/actions/borrow";

const ClearRecordMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [clearReturned, setClearReturned] = useState(false);
  const [clearLateReturned, setClearLateReturned] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleClear = async () => {
    if (!clearReturned && !clearLateReturned) {
      return;
    }

    setIsClearing(true);
    try {
      const result = await clearBorrowRecords({
        clearReturned,
        clearLateReturned,
      });

      if (!result.success) {
        console.error(result.message || "Failed to clear borrow records");
      }
    } catch (error) {
      console.error("Failed to clear borrow records", error);
    } finally {
      setIsClearing(false);
    }

    setClearReturned(false);
    setClearLateReturned(false);
    setIsOpen(false);
  };

  const handleCancel = () => {
    setClearReturned(false);
    setClearLateReturned(false);
    setIsOpen(false);
  };

  const hasSelection = clearReturned || clearLateReturned;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="clear-btn"
        disabled={isClearing}
      >
        {isOpen ? <X className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
        <span>Clear</span>
      </button>

      {isOpen && (
        <div className="clear-menu">
          <div className="clear-menu-content">
            <div
              className="clear-menu-option"
              onClick={() => setClearReturned(!clearReturned)}
            >
              <Checkbox
                id="clear-returned"
                checked={clearReturned}
                onCheckedChange={(value) => setClearReturned(!!value)}
                className="clear-menu-checkbox"
              />
              <label htmlFor="clear-returned" className="clear-menu-label">
                Clear returned records
              </label>
            </div>

            <div
              className="clear-menu-option"
              onClick={() => setClearLateReturned(!clearLateReturned)}
            >
              <Checkbox
                id="clear-late-returned"
                checked={clearLateReturned}
                onCheckedChange={(value) => setClearLateReturned(!!value)}
                className="clear-menu-checkbox"
              />
              <label htmlFor="clear-late-returned" className="clear-menu-label">
                Clear late returned records
              </label>
            </div>

            <div className="clear-menu-actions">
              <button
                onClick={handleCancel}
                className="clear-menu-cancel-btn"
                disabled={isClearing}
              >
                Cancel
              </button>
              <button
                onClick={handleClear}
                className="clear-menu-confirm-btn"
                disabled={!hasSelection || isClearing}
              >
                {isClearing ? "Clearing..." : "Clear"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClearRecordMenu;
