import type { ReactNode } from "react";

/**
 * A plain responsive grid for now. Phase 7 replaces this with a draggable,
 * resizable layout saved per user; keeping the seam here means widgets
 * don't need to change when that lands.
 */
export function WidgetGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}
