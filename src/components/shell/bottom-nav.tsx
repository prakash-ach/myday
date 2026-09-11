"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { mobileNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

export function BottomNav() {
  const pathname = usePathname();
  const [left, right] = [mobileNav.slice(0, 2), mobileNav.slice(2)];

  return (
    <nav className="border-line bg-surface/90 fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <ul className="mx-auto flex max-w-md items-center justify-between px-2">
        {left.map((item) => (
          <li key={item.href} className="flex-1">
            <Tab item={item} active={pathname === item.href} />
          </li>
        ))}

        <li className="flex-1">
          <button
            type="button"
            aria-label="Add something"
            className="bg-accent text-accent-ink mx-auto -mt-5 flex h-13 w-13 items-center justify-center rounded-full shadow-[var(--shadow-lift)]"
            style={{ height: 52, width: 52 }}
          >
            <Plus size={24} strokeWidth={2.2} />
          </button>
        </li>

        {right.map((item) => (
          <li key={item.href} className="flex-1">
            <Tab item={item} active={pathname === item.href} />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Tab({ item, active }: { item: (typeof mobileNav)[number]; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex flex-col items-center gap-1 py-2.5 text-[11px]",
        active ? "text-accent" : "text-ink-faint",
      )}
    >
      <Icon size={21} strokeWidth={1.9} />
      {item.label}
    </Link>
  );
}
