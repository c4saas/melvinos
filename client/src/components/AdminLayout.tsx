import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AdminHeader } from '@/components/admin/AdminHeader';
import type { AdminBreadcrumb } from '@/components/admin/AdminHeader';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useLastAreaPreference } from '@/hooks/useLastAreaPreference';

type AdminTabValue = 'system' | 'user';

const ADMIN_INVENTORY_REPORT_URL = '/settings/_reports/admin-inventory.json';

interface AdminInventorySummary {
  totalMissing: number;
  missingByRoute: Record<string, number>;
}

const isDevelopmentEnvironment = () => {
  if (typeof import.meta !== 'undefined' && import.meta.env && typeof import.meta.env.DEV === 'boolean') {
    return import.meta.env.DEV;
  }

  if (typeof process !== 'undefined' && process.env && typeof process.env.NODE_ENV === 'string') {
    return process.env.NODE_ENV !== 'production';
  }

  return true;
};

const getRouteIdentifier = (value: Record<string, unknown>): string | undefined => {
  const candidateKeys: Array<keyof typeof value> = ['routeId', 'route', 'path'];
  for (const key of candidateKeys) {
    const raw = value[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw;
    }
  }
  return undefined;
};

const summarizeAdminInventoryReport = (data: unknown): AdminInventorySummary => {
  const missingByRoute = new Map<string, number>();

  const visit = (node: unknown, currentRoute?: string) => {
    if (Array.isArray(node)) {
      for (const entry of node) {
        visit(entry, currentRoute);
      }
      return;
    }

    if (!node || typeof node !== 'object') {
      return;
    }

    const record = node as Record<string, unknown>;
    const explicitRoute = getRouteIdentifier(record);
    const routeForChildren = explicitRoute ?? currentRoute;

    const status = record.status;
    if (typeof status === 'string' && status.toUpperCase() === 'MISSING') {
      const routeKey = explicitRoute ?? currentRoute ?? 'unknown';
      const previous = missingByRoute.get(routeKey) ?? 0;
      missingByRoute.set(routeKey, previous + 1);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        visit(value, routeForChildren);
      }
    }
  };

  visit(data);

  const sortedEntries = [...missingByRoute.entries()].sort(([a], [b]) => a.localeCompare(b));
  const summaryMap: Record<string, number> = {};
  let totalMissing = 0;

  for (const [route, count] of sortedEntries) {
    summaryMap[route] = count;
    totalMissing += count;
  }

  return { totalMissing, missingByRoute: summaryMap };
};

export const useAdminInventoryDiagnostics = (isAdmin: boolean) => {
  const isDev = isDevelopmentEnvironment();

  useEffect(() => {
    if (!isAdmin) {
      return;
    }

    let cancelled = false;

    const runDiagnostics = async () => {
      try {
        const response = await fetch(ADMIN_INVENTORY_REPORT_URL, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        const summary = summarizeAdminInventoryReport(payload);

        if (!isDev) {
          return;
        }

        const logPayload = {
          missingByRoute: summary.missingByRoute,
          totalMissing: summary.totalMissing,
        };

        if (summary.totalMissing > 0) {
          console.warn('[admin-inventory] Missing admin inventory items detected.', logPayload);
        } else {
          console.info('[admin-inventory] No missing admin inventory items detected.', logPayload);
        }
      } catch (error) {
        if (cancelled || !isDev) {
          return;
        }

        console.warn('[admin-inventory] Failed to load admin inventory report.', error);
      }
    };

    void runDiagnostics();

    return () => {
      cancelled = true;
    };
  }, [isAdmin, isDev]);
};

export interface AdminHeaderConfig {
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
}

interface AdminLayoutContextValue {
  breadcrumbs: AdminBreadcrumb[];
  setHeader: (config: AdminHeaderConfig) => void;
  resetHeader: () => void;
  activeTab: AdminTabValue;
  setActiveTab: (value: AdminTabValue) => void;
}

const AdminLayoutContext = createContext<AdminLayoutContextValue | null>(null);

const areHeaderConfigsEqual = (a: AdminHeaderConfig, b: AdminHeaderConfig) =>
  a.title === b.title &&
  a.description === b.description &&
  a.actions === b.actions &&
  a.tabs === b.tabs;

const DEFAULT_HEADER: AdminHeaderConfig = { title: 'Settings' };

interface AdminLayoutProps {
  children?: ReactNode;
  systemTabContent?: ReactNode;
  userTabContent?: ReactNode;
  initialTab?: AdminTabValue;
}

export function AdminLayout({ children, systemTabContent }: AdminLayoutProps = {}) {
  const [activeTab, setActiveTabState] = useState<AdminTabValue>('system');
  const { isAdmin } = useAuth();

  useLastAreaPreference('admin');

  useAdminInventoryDiagnostics(isAdmin);

  const [headerConfig, setHeaderConfig] = useState<AdminHeaderConfig>(DEFAULT_HEADER);

  const breadcrumbs = useMemo<AdminBreadcrumb[]>(
    () => [{ label: 'Settings', href: '/settings' }],
    [],
  );

  const setActiveTab = useCallback((value: AdminTabValue) => {
    setActiveTabState(value);
  }, []);

  const setHeader = useCallback((config: AdminHeaderConfig) => {
    setHeaderConfig((previous) => (areHeaderConfigsEqual(previous, config) ? previous : config));
  }, []);

  const resetHeader = useCallback(() => {
    setHeaderConfig(DEFAULT_HEADER);
  }, []);

  const contextValue = useMemo<AdminLayoutContextValue>(
    () => ({
      breadcrumbs,
      setHeader,
      resetHeader,
      activeTab,
      setActiveTab,
    }),
    [activeTab, breadcrumbs, resetHeader, setActiveTab, setHeader],
  );

  const content = children || systemTabContent || null;

  return (
    <AdminLayoutContext.Provider value={contextValue}>
      <div className="flex min-h-screen flex-col bg-background">
        <AdminHeader
          title={headerConfig.title}
          description={headerConfig.description}
          breadcrumbs={breadcrumbs}
          actions={headerConfig.actions}
        />
        <div className="flex flex-1 overflow-hidden">
          <AdminSidebar />
          <main className="flex-1 overflow-auto px-6 py-10">
            {content}
          </main>
        </div>
      </div>
    </AdminLayoutContext.Provider>
  );
}

export const useAdminLayout = () => {
  const context = useContext(AdminLayoutContext);
  if (!context) {
    throw new Error('useAdminLayout must be used within an AdminLayout');
  }
  return context;
};
