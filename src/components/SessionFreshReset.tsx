"use client";
import { useEffect } from "react";

/**
 * Clears active uploaded document ids only on a full page reload.
 * Prevents reusing past uploads after refresh, but preserves newly uploaded files during client navigations.
 */
export default function SessionFreshReset() {
  useEffect(() => {
    try {
      const navEntries = (performance as any).getEntriesByType?.("navigation");
      const nav = Array.isArray(navEntries) ? navEntries[0] : undefined;
      // type can be 'reload' in modern API; fallback to deprecated numeric type 1
      const type = nav?.type ?? (performance as any).navigation?.type;
      const isReload = type === "reload" || type === 1;
      if (isReload) {
        fetch("/api/state/active-docs", { method: "DELETE", keepalive: true }).catch(() => {});
      }
    } catch {}
  }, []);
  return null;
}
