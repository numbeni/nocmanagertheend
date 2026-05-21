import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WifiOff, Loader2, RefreshCw, X, Wifi } from "lucide-react";
import { useT } from "@/i18n/LanguageProvider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";

interface ConnStatus {
  status: "online" | "offline" | "checking" | "unknown";
  isChecking: boolean;
  lastOnlineAt: string | null;
}

export function OfflineModal() {
  const { t, dir } = useT();
  const locale = dir === "rtl" ? faIR : undefined;
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [justRestored, setJustRestored] = useState(false);
  const prevStatusRef = useRef<string | null>(null);

  const { data: status, refetch } = useQuery<ConnStatus>({
    queryKey: ["conn-offline-modal"],
    queryFn: () =>
      fetch("/api/connectivity/status", { credentials: "include" }).then((r) =>
        r.ok ? r.json() : { status: "unknown", isChecking: false, lastOnlineAt: null },
      ),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const { data: settings } = useQuery<{ connectivityOfflinePopupEnabled?: boolean }>({
    queryKey: ["conn-popup-settings"],
    queryFn: () =>
      fetch("/api/settings", { credentials: "include" }).then((r) => (r.ok ? r.json() : {})),
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const checkNow = useMutation({
    mutationFn: () =>
      fetch("/api/connectivity/check", { method: "POST", credentials: "include" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => {
      refetch();
    },
  });

  useEffect(() => {
    const curr = status?.status ?? null;
    const prev = prevStatusRef.current;

    if (curr === "offline" && settings?.connectivityOfflinePopupEnabled !== false) {
      setVisible(true);
      setDismissed(false);
    }

    if (prev === "offline" && curr === "online") {
      setJustRestored(true);
      setTimeout(() => {
        setVisible(false);
        setJustRestored(false);
        setDismissed(false);
      }, 2500);
    }

    prevStatusRef.current = curr;
  }, [status?.status, settings?.connectivityOfflinePopupEnabled]);

  const show = visible && !dismissed;
  if (!show) return null;

  const isOffline = status?.status === "offline";
  const isChecking = status?.isChecking || checkNow.isPending;

  return (
    <div className="fixed inset-0 z-[9999] flex items-end justify-end p-6 pointer-events-none">
      <div
        className={cn(
          "pointer-events-auto relative bg-card border rounded-2xl shadow-2xl p-6 w-full max-w-sm space-y-4 transition-all duration-300",
          justRestored
            ? "border-green-500/50 bg-green-950/20"
            : "border-red-500/40 bg-background",
        )}
        style={{ boxShadow: "0 8px 40px rgba(0,0,0,0.4)" }}
      >
        <button
          className="absolute top-3 end-3 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        {justRestored ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="flex items-center justify-center h-14 w-14 rounded-full bg-green-500/15 border-2 border-green-500/40">
              <Wifi className="h-7 w-7 text-green-400" />
            </div>
            <p className="font-semibold text-green-400 text-center">
              {t("connectivity.offlineModal.restored")}
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="relative flex-shrink-0">
                <div className="flex items-center justify-center h-11 w-11 rounded-full bg-red-500/10 border border-red-500/30">
                  <WifiOff className="h-5 w-5 text-red-500" />
                </div>
                <span className="absolute -top-0.5 -end-0.5 flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">
                  {t("connectivity.offlineModal.title")}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  {t("connectivity.offlineModal.desc")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 py-2 px-3 rounded-lg bg-muted/40 border border-border">
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />
              <span className="text-xs text-muted-foreground">
                {t("connectivity.offlineModal.waiting")}
              </span>
            </div>

            {status?.lastOnlineAt && (
              <p className="text-xs text-muted-foreground/70 text-center">
                {t("connectivity.offlineModal.lastOnline")}:{" "}
                {formatDistanceToNow(new Date(status.lastOnlineAt), {
                  addSuffix: true,
                  locale,
                })}
              </p>
            )}

            <Button
              className="w-full gap-2"
              variant="outline"
              size="sm"
              onClick={() => checkNow.mutate()}
              disabled={isChecking}
            >
              {isChecking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("connectivity.offlineModal.checkNow")}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
