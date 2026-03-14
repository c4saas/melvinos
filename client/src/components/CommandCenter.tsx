/**
 * Command Center Layout
 *
 * The primary shell for the agent — a single-user autonomous agent interface.
 * Layout: [nav-rail 56px] | [sidebar 260px collapsible] | [main content flex-1]
 */

import { type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  MessageSquare,
  FolderOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Circle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";

interface CommandCenterProps {
  children: ReactNode;
  sidebar?: ReactNode;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

const NAV_ITEMS = [
  { href: "/app",        icon: MessageSquare, label: "Chat",      shortcut: "C" },
  { href: "/workspace",  icon: FolderOpen,    label: "Workspace",  shortcut: "W" },
  { href: "/settings",   icon: Settings,      label: "Settings",   shortcut: "S" },
];

function HealthDots() {
  const { data } = useQuery<{ servers: { connected: boolean }[] }>({
    queryKey: ['mcp-servers'],
    queryFn: async () => {
      const res = await fetch('/api/admin/mcp/servers');
      if (!res.ok) return { servers: [] };
      return res.json();
    },
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const servers = data?.servers ?? [];
  const connectedCount = servers.filter(s => s.connected).length;
  const hasServers = servers.length > 0;

  if (!hasServers) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center justify-center gap-1 py-1">
          <Circle
            className={cn(
              "w-2 h-2",
              connectedCount === servers.length
                ? "fill-emerald-500 text-emerald-500"
                : connectedCount > 0
                  ? "fill-amber-500 text-amber-500"
                  : "fill-red-500 text-red-500"
            )}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {connectedCount}/{servers.length} MCP server{servers.length !== 1 ? 's' : ''} connected
      </TooltipContent>
    </Tooltip>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center justify-center w-full h-14 border-b border-border/50">
      <div className="relative flex items-center justify-center w-8 h-8">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-lg bg-blue-500/10 border border-blue-500/30" />
        {/* Logo SVG */}
        <svg viewBox="0 0 24 24" fill="none" className="relative w-5 h-5" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="9" stroke="url(#cc-grad)" strokeWidth="1.5" />
          <circle cx="12" cy="12" r="3.5" fill="url(#cc-grad)" />
          <line x1="12" y1="3" x2="12" y2="21" stroke="url(#cc-grad)" strokeWidth="0.75" opacity="0.4" />
          <line x1="3" y1="12" x2="21" y2="12" stroke="url(#cc-grad)" strokeWidth="0.75" opacity="0.4" />
          <defs>
            <linearGradient id="cc-grad" x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
              <stop stopColor="#60a5fa" />
              <stop offset="1" stopColor="#818cf8" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

function useActiveCheck() {
  const [location] = useLocation();
  return (href: string) => {
    if (href === "/app") return location === "/app" || location.startsWith("/app");
    return location.startsWith(href.split("?")[0]);
  };
}

function NavRail({ onToggleSidebar, sidebarOpen }: {
  onToggleSidebar?: () => void;
  sidebarOpen?: boolean;
}) {
  const isActive = useActiveCheck();

  return (
    <nav
      className={cn(
        "flex flex-col items-center w-14 min-w-[3.5rem] h-full",
        "bg-sidebar border-r border-sidebar-border",
        "py-0 gap-0"
      )}
      aria-label="Primary navigation"
    >
      {/* Brand mark */}
      <BrandMark />

      {/* Sidebar toggle */}
      <div className="flex flex-col items-center w-full pt-3 pb-2 gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onToggleSidebar}
              className="os-nav-icon-btn w-9 h-8 text-muted-foreground/60 hover:text-foreground hover:bg-accent/60"
              aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            >
              {sidebarOpen
                ? <ChevronLeft className="w-3.5 h-3.5" />
                : <ChevronRight className="w-3.5 h-3.5" />
              }
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs">
            {sidebarOpen ? "Collapse panel" : "Expand panel"}
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Primary nav */}
      <div className="flex flex-col items-center w-full px-2 gap-1 flex-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Tooltip key={href}>
              <TooltipTrigger asChild>
                <Link href={href}>
                  <div
                    className={cn(
                      "os-nav-icon-btn w-10 h-10",
                      active && "active"
                    )}
                    aria-label={label}
                    aria-current={active ? "page" : undefined}
                  >
                    <div className="os-active-bar" />
                    <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                  </div>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Health indicators */}
      <div className="flex flex-col items-center w-full pb-3 gap-1">
        <HealthDots />
      </div>

    </nav>
  );
}

/** Bottom tab bar shown on mobile in place of the side NavRail. */
function MobileBottomNav() {
  const isActive = useActiveCheck();

  return (
    <nav
      className="flex items-stretch h-16 bg-sidebar border-t border-sidebar-border safe-area-inset-bottom"
      aria-label="Primary navigation"
    >
      {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
        const active = isActive(href);
        return (
          <Link key={href} href={href} className="flex-1">
            <div
              className={cn(
                "relative flex flex-col items-center justify-center gap-1 h-full w-full transition-colors",
                active
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
              )}
              <Icon className="w-5 h-5" />
              <span className={cn("text-[10px] font-medium leading-none", active && "font-semibold")}>
                {label}
              </span>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

export function CommandCenter({
  children,
  sidebar,
  sidebarOpen = true,
  onToggleSidebar,
}: CommandCenterProps) {
  return (
    <div className="flex flex-col h-dvh max-h-dvh w-full overflow-hidden bg-background">
      {/* Horizontal slice: nav-rail + sidebar + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Nav rail — hidden on mobile, visible on md+ */}
        <div className="hidden md:flex">
          <NavRail onToggleSidebar={onToggleSidebar} sidebarOpen={sidebarOpen} />
        </div>

        {/* Collapsible sidebar panel */}
        {sidebar && (
          <div
            className={cn(
              "transition-all duration-250 ease-in-out overflow-hidden",
              "border-r border-sidebar-border",
              "h-full bg-sidebar",
              // Mobile: fixed overlay from left edge; Desktop: static in flow
              "fixed lg:relative left-0 md:left-14 lg:left-auto top-0 z-40 lg:z-auto",
              sidebarOpen ? "w-[260px]" : "w-0"
            )}
          >
            <div className="w-[260px] h-full">
              {sidebar}
            </div>
          </div>
        )}

        {/* Mobile sidebar backdrop */}
        {sidebarOpen && sidebar && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={onToggleSidebar}
          />
        )}

        {/* Main content */}
        <div className="flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
          {children}
        </div>
      </div>

    </div>
  );
}
