import { useEffect, useMemo, type ComponentType } from 'react';
import { useLocation } from 'wouter';
import {
  Settings,
  Package,
  Bot,
  Key,
  Users as UsersIcon,
  FileText,
  Loader2,
  Building2,
  CreditCard,
  Brain,
  LifeBuoy,
  Network,
  Globe,
  Zap,
  Search,
  Plug,
  Wrench,
  Monitor,
  Rocket,
  LayoutDashboard,
  BookOpen,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { usePermissions } from '@/hooks/use-permissions';
import { PERMISSIONS } from '@shared/constants';
import type { Permission } from '@shared/constants';
import {
  getDashboardRoutes,
  getRouteDashboardCard,
  type AdminIconName,
  type AdminRouteId,
} from '@shared/adminRoutes';
import { useAdminLayout } from '@/components/AdminLayout';
import type { AdminAssistantMetricsResponse } from './types';
import { AdminCard, type AdminCardProps } from '@/components/admin';

export interface SystemCardDefinition {
  id: AdminRouteId;
  props: AdminCardProps;
  requiredPermission: Permission;
}

const iconComponents: Partial<Record<AdminIconName, ComponentType<{ className?: string }>>> = {
  Settings,
  Package,
  Bot,
  Key,
  Users: UsersIcon,
  FileText,
  Building2,
  CreditCard,
  Brain,
  LifeBuoy,
  Network,
  Globe,
  Zap,
  Search,
  Plug,
  Wrench,
  Monitor,
  Rocket,
  LayoutDashboard,
  BookOpen,
  Activity,
};

export const getSystemQuickCards = (hasPermission: (permission: Permission) => boolean) =>
  getDashboardRoutes('system')
    .map<SystemCardDefinition | null>((route) => {
      if (!hasPermission(route.requiredPermission)) {
        return null;
      }

      const cardMeta = getRouteDashboardCard(route, 'system');
      if (!cardMeta) {
        return null;
      }

      const Icon = iconComponents[cardMeta.icon] ?? undefined;
      if (!Icon) {
        return null;
      }

      const normalizedRouteId = route.id as AdminRouteId;

      return {
        id: normalizedRouteId,
        props: {
          title: cardMeta.title,
          description: cardMeta.description,
          icon: Icon,
          action: {
            label: cardMeta.actionLabel,
            scope: 'system',
            routeKey: normalizedRouteId,
            testId: `primary-${normalizedRouteId}`,
          },
        },
        requiredPermission: route.requiredPermission,
      };
    })
    .filter((card): card is SystemCardDefinition => Boolean(card));

export default function DashboardPage() {
  const { user, isAdmin, isLoading: isAuthLoading } = useAuth();
  const { hasPermission } = usePermissions();
  const [, setLocation] = useLocation();
  const { setHeader, resetHeader } = useAdminLayout();

  useEffect(() => {
    if (!isAuthLoading && !isAdmin) {
      setLocation('/');
    }
  }, [isAdmin, isAuthLoading, setLocation]);

  const headerDescription = useMemo(() => {
    const displayName = user?.name || user?.email || 'Admin';
    return `Welcome back, ${displayName}. Manage your platform settings and configurations.`;
  }, [user?.name, user?.email]);

  useEffect(() => {
    setHeader({ title: 'Dashboard', description: headerDescription });
    return () => resetHeader();
  }, [setHeader, resetHeader, headerDescription]);

  if (isAuthLoading || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const systemQuickCards = getSystemQuickCards(hasPermission);

  return (
    <div className="space-y-6">
      <section>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {systemQuickCards.map((card) => (
            <AdminCard key={card.id} {...card.props} />
          ))}
          {systemQuickCards.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>No system controls available</CardTitle>
                <CardDescription>
                  You do not have permission to manage platform-level settings.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </div>
      </section>

      {user.role === 'admin' && (
        <Card className="border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20">
          <CardHeader>
            <CardTitle>Admin Access Notice</CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-200">
              As an Admin, you can manage most platform settings. However, System Prompts and Tool
              Policies are view-only and require Super Admin privileges to edit.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
