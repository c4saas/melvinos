"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

interface NavItem {
  href: string;
  label: string;
  description?: string;
}

const SETTINGS_LINKS: NavItem[] = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/account", label: "Account" },
  { href: "/settings/integrations", label: "Integrations" },
  {
    href: "/settings/voice",
    label: "Voice",
    description: "Configure OpenAI voice preferences.",
  },
];

export function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Settings navigation" className="space-y-1 text-sm">
      {SETTINGS_LINKS.map((item) => {
        const isActive =
          pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={clsx(
              "flex flex-col rounded-lg border border-transparent px-3 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-primary",
              isActive
                ? "bg-primary/10 text-foreground ring-1 ring-primary/40"
                : "text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <span className="font-medium">{item.label}</span>
            {item.description ? (
              <span className="text-xs">{item.description}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
