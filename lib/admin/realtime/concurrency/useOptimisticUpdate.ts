"use client";

import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

type Identifiable = {
  id: string;
};

type SetItems<T> = Dispatch<SetStateAction<T[]>>;

export const useOptimisticUpdate = <T extends Identifiable>(
  setItems: SetItems<T>,
) => {
  const updateItem = useCallback(
    (id: string, updater: (item: T) => T) => {
      let previousItem: T | null = null;

      setItems((current) =>
        current.map((item) => {
          if (item.id !== id) return item;
          previousItem = item;
          return updater(item);
        }),
      );

      return previousItem;
    },
    [setItems],
  );

  const removeItem = useCallback(
    (id: string) => {
      let previousItem: T | null = null;

      setItems((current) =>
        current.filter((item) => {
          if (item.id === id) {
            previousItem = item;
            return false;
          }

          return true;
        }),
      );

      return previousItem;
    },
    [setItems],
  );

  const restoreItem = useCallback(
    (item: T, index?: number) => {
      setItems((current) => {
        const next = current.filter((entry) => entry.id !== item.id);

        if (typeof index === "number" && index >= 0 && index <= next.length) {
          next.splice(index, 0, item);
          return next;
        }

        return [...next, item];
      });
    },
    [setItems],
  );

  return {
    updateItem,
    removeItem,
    restoreItem,
  };
};
