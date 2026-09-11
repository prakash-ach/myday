import type { ReactNode } from "react";

/**
 * Empty screens are an invitation, not a dead end: say what the space is
 * for, then offer the action that fills it.
 */
export function Empty({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      {hint && <p className="text-ink-muted mt-1 max-w-[46ch] text-[13.5px]">{hint}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
