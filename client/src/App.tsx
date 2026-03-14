import { Switch, Route, useLocation } from "wouter";
import { useEffect, type ComponentType } from "react";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { CCModeIndicator } from "@/components/CCModeIndicator";
import { Chat } from "@/components/Chat";
import UsagePage from "@/pages/usage";
import GoogleDrivePage from "@/pages/google-drive";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Setup from "@/pages/setup";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import { useAuth } from "@/hooks/useAuth";
import AssistantsDirectoryPage from "@/pages/assistants";
import WorkspacePage from "@/pages/workspace";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { CommandPalette } from "@/components/CommandPalette";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AdminLayout } from "@/components/AdminLayout";
import DashboardPage from "@/pages/settings/DashboardPage";
import SystemPromptsPage from "@/pages/settings/SystemPromptsPage";
import OutputTemplatesPage from "@/pages/settings/OutputTemplatesPage";
import ToolPoliciesPage from "@/pages/settings/ToolPoliciesPage";
import KnowledgeBasePage from "@/pages/settings/KnowledgeBasePage";
import MemoryPage from "@/pages/settings/MemoryPage";
import TemplatesProjectsPage from "@/pages/settings/TemplatesProjectsPage";
import AdminAssistantsPage from "@/pages/settings/AssistantsPage";
import APIAccessPage from "@/pages/settings/APIAccessPage";
import IntegrationsPage from "@/pages/settings/IntegrationsPage";
import SkillsPage from "@/pages/settings/SkillsPage";
import McpServersPage from "@/pages/settings/McpServersPage";
import HeartbeatPage from "@/pages/settings/HeartbeatPage";
import SetupPage from "@/pages/settings/SetupPage";
import MonitoringPage from "@/pages/settings/MonitoringPage";
import TriggerRulesPage from "@/pages/settings/TriggerRulesPage";
import SSHServersPage from "@/pages/settings/SSHServersPage";
import DocsPage from "@/pages/DocsPage";

export interface AdminPageRoute {
  path: string;
  slot: "system";
  Component: ComponentType;
}

export const ADMIN_PAGE_ROUTES: AdminPageRoute[] = [
  { path: "/settings/system-prompts", slot: "system", Component: SystemPromptsPage },
  { path: "/settings/output-templates", slot: "system", Component: OutputTemplatesPage },
  { path: "/settings/tool-policies", slot: "system", Component: ToolPoliciesPage },
  { path: "/settings/knowledge-base", slot: "system", Component: KnowledgeBasePage },
  { path: "/settings/memory", slot: "system", Component: MemoryPage },
  { path: "/settings/templates-projects", slot: "system", Component: TemplatesProjectsPage },
  { path: "/settings/assistants", slot: "system", Component: AdminAssistantsPage },
  { path: "/settings/api-access", slot: "system", Component: APIAccessPage },
  { path: "/settings/integrations", slot: "system", Component: IntegrationsPage },
  { path: "/settings/skills", slot: "system", Component: SkillsPage },
  { path: "/settings/heartbeat", slot: "system", Component: HeartbeatPage },
  { path: "/settings/mcp-servers", slot: "system", Component: McpServersPage },
  { path: "/settings/setup", slot: "system", Component: SetupPage },
  { path: "/settings/monitoring", slot: "system", Component: MonitoringPage },
  { path: "/settings/trigger-rules", slot: "system", Component: TriggerRulesPage },
  { path: "/settings/ssh-servers", slot: "system", Component: SSHServersPage },
];

function UserHomeRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/app");
  }, [setLocation]);

  return null;
}

function SetupRedirect() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    setLocation("/setup");
  }, [setLocation]);

  return null;
}

function useSetupStatus() {
  return useQuery<{ needsSetup: boolean }>({
    queryKey: ["/api/auth/setup-status"],
    queryFn: async () => {
      const res = await fetch("/api/auth/setup-status");
      if (!res.ok) return { needsSetup: false };
      return res.json();
    },
    staleTime: 30000,
  });
}

function Router() {
  const { isAuthenticated, isLoading, error } = useAuth();
  const { data: setupStatus, isLoading: setupLoading } = useSetupStatus();

  // Show loading screen only during initial checks
  if (isLoading || setupLoading) {
    return <LoadingScreen />;
  }

  // First-run: no user exists → show setup wizard
  if (setupStatus?.needsSetup) {
    return (
      <Switch>
        <Route path="/setup" component={Setup} />
        <Route><SetupRedirect /></Route>
      </Switch>
    );
  }

  // User exists but not logged in → show login
  if (!isAuthenticated || error) {
    return (
      <Switch>
        <Route path="/" component={Login} />
        <Route path="/forgot-password" component={ForgotPassword} />
        <Route path="/reset-password" component={ResetPassword} />
        <Route component={Login} />
      </Switch>
    );
  }

  // Show authenticated routes — single user has full access
  return (
    <Switch>
      <Route path="/app" component={Chat} />
      <Route path="/workspace" component={WorkspacePage} />
      <Route path="/usage" component={UsagePage} />
      <Route path="/assistants" component={AssistantsDirectoryPage} />
      <Route path="/google-drive" component={GoogleDrivePage} />

      {/* Settings/Admin Routes */}
      <Route path="/settings">
        <AdminLayout>
          <DashboardPage />
        </AdminLayout>
      </Route>
      {ADMIN_PAGE_ROUTES.map(({ path, Component }) => (
        <Route key={path} path={path}>
          <AdminLayout systemTabContent={<Component />} />
        </Route>
      ))}

      <Route path="/help" component={DocsPage} />
      <Route path="/" component={UserHomeRedirect} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ThemeProvider defaultTheme="light">
            <CCModeIndicator />
            <Toaster />
            <CommandPalette />
            <Router />
          </ThemeProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
