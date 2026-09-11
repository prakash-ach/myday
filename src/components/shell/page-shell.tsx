import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function PageShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-4 pb-6 sm:pt-8">
        <div>
          <h1 className="text-[27px] leading-tight font-semibold tracking-[-0.025em] sm:text-[32px]">
            {title}
          </h1>
          {subtitle && <p className="text-ink-muted mt-1 text-[13.5px]">{subtitle}</p>}
        </div>
        {action}
      </header>
      <Card>{children}</Card>
    </>
  );
}
