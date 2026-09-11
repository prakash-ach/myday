import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * One card style, used everywhere. Radius and shadow are uniform here and
 * varied by level elsewhere: the hero uses no card at all, widgets use this,
 * dialogs use --shadow-lift.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "bg-surface rounded-[var(--radius-card)] shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  count,
  action,
}: {
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
        {count !== undefined && (
          <span className="tnum text-ink-faint text-[13px]">{count}</span>
        )}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-1 pb-5", className)} {...props} />;
}
