import { useState, useCallback, type ComponentType } from 'react';
import { useLocation } from 'wouter';
import { ChevronDown, Bot, Brain, Key, Settings, Network, Wrench, Monitor, Rocket, LayoutDashboard, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/hooks/use-permissions';
import { ADMIN_NAV_GROUPS, type AdminIconName } from '@shared/adminRoutes';

const groupIcons: Partial<Record<AdminIconName, ComponentType<{ className?: string }>>> = {
  Bot,
  Brain,
  Key,
  Settings,
  Network,
  Wrench,
  Monitor,
  Rocket,
  LayoutDashboard,
  BookOpen,
};

export function AdminSidebar() {
  const [location, setLocation] = useLocation();
  const { hasPermission } = usePermissions();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  }, []);

  return (
    <aside className="hidden lg:flex w-56 shrink-0 flex-col border-r border-border/60 bg-card/40">
      <div className="px-4 py-5">
        <button
          type="button"
          onClick={() => setLocation('/settings')}
          className={cn(
            'flex items-center gap-2 text-sm font-semibold tracking-tight text-foreground transition-colors hover:text-primary',
            location === '/settings' && 'text-primary',
          )}
        >
          <LayoutDashboard className="h-4 w-4" />
          Overview
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-6 space-y-1">
        {ADMIN_NAV_GROUPS.map((group) => {
          if (!hasPermission(group.requiredPermission)) return null;

          const Icon = groupIcons[group.icon];
          const isCollapsed = collapsed[group.id] === true;
          const visibleItems = group.items.filter((item) => hasPermission(item.requiredPermission));
          if (visibleItems.length === 0) return null;

          return (
            <div key={group.id}>
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                <span className="flex-1 text-left">{group.label}</span>
                <ChevronDown
                  className={cn(
                    'h-3.5 w-3.5 transition-transform duration-200',
                    isCollapsed && '-rotate-90',
                  )}
                />
              </button>

              {!isCollapsed && (
                <div className="ml-1 space-y-0.5">
                  {visibleItems.map((item) => {
                    const isActive = location === item.path;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setLocation(item.path)}
                        className={cn(
                          'flex w-full items-center rounded-md pl-5 pr-3 py-1 text-[13px] transition-colors',
                          isActive
                            ? 'bg-primary/10 font-medium text-primary'
                            : 'text-muted-foreground/70 hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
