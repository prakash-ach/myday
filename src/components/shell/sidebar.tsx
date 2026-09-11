"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { primaryNav, secondaryNav } from "@/lib/nav";
import { ThemeToggle } from "./theme-toggle";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="border-line bg-surface hidden w-60 shrink-0 flex-col border-r lg:flex">
      <div className="px-5 pt-6 pb-5">
        <Link href="/" className="font-serif text-[22px] leading-none tracking-[-0.01em]">
          MYDAY
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {primaryNav.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={pathname === item.href} />
            </li>
          ))}
        </ul>

        <div className="bg-line my-4 h-px" />

        <ul className="space-y-0.5">
          {secondaryNav.map((item) => (
            <li key={item.href}>
              <NavLink item={item} active={pathname.startsWith(item.href)} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-line flex items-center justify-between border-t px-4 py-3">
        <span className="text-ink-muted text-[13px]">Theme</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: (typeof primaryNav)[number]; active: boolean }) {
  const { Icon } = { Icon: item.icon };
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm transition-colors",
        active
          ? "bg-accent-wash text-ink font-medium"
          : "text-ink-muted hover:bg-canvas hover:text-ink",
      )}
    >
      <Icon size={17} strokeWidth={1.9} className={active ? "text-accent" : ""} />
      {item.label}
    </Link>
  );
}
