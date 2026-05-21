import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LanguageProvider, useT } from "@/i18n/LanguageProvider";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { ThemeBridge } from "@/theme/ThemeBridge";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import { AuthProvider, useAuth } from "@/contexts/auth";
import { NotificationsProvider } from "@/contexts/notifications";
import { CriticalEventsPopup } from "@/components/critical-events-popup";
import { OfflineModal } from "@/components/offline-modal";
import LoginPage from "@/pages/login";
import SetupPage from "@/pages/setup";
import { Monitor } from "lucide-react";

// Pages
import Dashboard from "@/pages/dashboard";
import ChartsStatusPage from "@/pages/charts-status";
import SiteDetail from "@/pages/site-detail";
import Incidents from "@/pages/incidents";
import IncidentDetail from "@/pages/incident-detail";
import AddSite from "@/pages/add-site";
import LogsPage from "@/pages/logs";
import ConsolePage from "@/pages/console";
import DnsResolversPage from "@/pages/dns-resolvers";
import DnsPerformancePage from "@/pages/dns-performance";
import SettingsPage from "@/pages/settings";
import ProfilePage from "@/pages/profile";
import UsersPage from "@/pages/users";
import AuditLogPage from "@/pages/audit-log";
import GatewaysPage from "@/pages/gateways";
import SslPage from "@/pages/ssl";
import ServersPage from "@/pages/servers";
import ConnectivityPage from "@/pages/connectivity";

const queryClient = new QueryClient();

function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function MobileBlockScreen() {
  const { t } = useT();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center gap-6">
      <Monitor className="h-16 w-16 text-primary opacity-80" />
      <div className="space-y-3 max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">{t("mobile.title")}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{t("mobile.desc")}</p>
        <p className="text-xs text-muted-foreground/60 leading-relaxed">{t("mobile.hint")}</p>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading, setupRequired } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    );
  }

  if (setupRequired === true) {
    return <SetupPage />;
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function Router() {
  const { user } = useAuth();
  const isAtLeastOperator = user?.role === "admin" || user?.role === "founder" || user?.role === "operator";

  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/charts-status" component={ChartsStatusPage} />
        <Route path="/sites/:id" component={SiteDetail} />
        <Route path="/incidents" component={Incidents} />
        <Route path="/incidents/:id" component={IncidentDetail} />
        <Route path="/add-site" component={AddSite} />
        <Route path="/logs" component={LogsPage} />
        <Route path="/console" component={ConsolePage} />
        <Route path="/dns-resolvers" component={DnsResolversPage} />
        <Route path="/dns-performance" component={DnsPerformancePage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/users">
          {isAtLeastOperator ? <UsersPage /> : <Redirect to="/" />}
        </Route>
        <Route path="/audit-log">
          {isAtLeastOperator ? <AuditLogPage /> : <Redirect to="/" />}
        </Route>
        <Route path="/gateways" component={GatewaysPage} />
        <Route path="/ssl" component={SslPage} />
        <Route path="/servers" component={ServersPage} />
        <Route path="/connectivity" component={ConnectivityPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AppInner() {
  return (
    <AuthGate>
      <CriticalEventsPopup />
      <OfflineModal />
      <Router />
    </AuthGate>
  );
}

function App() {
  const mobile = isMobileDevice();
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <LanguageProvider>
          {mobile ? (
            <MobileBlockScreen />
          ) : (
            <AuthProvider>
              <TooltipProvider>
                <ThemeBridge />
                <NotificationsProvider>
                  <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                    <AppInner />
                  </WouterRouter>
                </NotificationsProvider>
                <Toaster />
              </TooltipProvider>
            </AuthProvider>
          )}
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
