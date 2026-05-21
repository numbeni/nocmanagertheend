import { Bell } from "lucide-react";
import { useState } from "react";
import { useNotifications } from "@/contexts/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/i18n/LanguageProvider";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const SEVERITY_CLASS: Record<string, string> = {
  critical: "text-destructive",
  warning: "text-yellow-500",
  info: "text-blue-500",
};

export function NotificationButton() {
  const { t, dir } = useT();
  const { unreadCount, recentNotifications, markAllRead, permission } = useNotifications();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);

  const handleOpen = (v: boolean) => {
    setOpen(v);
    if (v) markAllRead();
  };

  const recent = recentNotifications.slice(0, 8);

  return (
    <DropdownMenu open={open} onOpenChange={handleOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
              aria-label={t("notif.tooltip")}
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground leading-none">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("notif.tooltip")}</TooltipContent>
      </Tooltip>

      <DropdownMenuContent
        align={dir === "rtl" ? "start" : "end"}
        className="w-80 max-h-[420px] overflow-y-auto"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm font-semibold">
            {t("notif.title")}
          </DropdownMenuLabel>
          {permission !== "granted" && permission !== "unsupported" && (
            <span className="text-[10px] text-muted-foreground">{t("notif.permissionNeeded")}</span>
          )}
        </div>
        <DropdownMenuSeparator />

        {recent.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t("notif.empty")}
          </div>
        ) : (
          <>
            {recent.map((n) => (
              <button
                key={n.id}
                type="button"
                className="w-full text-start px-3 py-2.5 hover:bg-muted/60 transition-colors cursor-pointer flex flex-col gap-0.5 border-b border-border/30 last:border-0"
                onClick={() => {
                  setOpen(false);
                  navigate(`/incidents/${n.id}`);
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "text-[10px] uppercase font-bold tracking-wide flex-shrink-0",
                      SEVERITY_CLASS[n.severity] ?? "text-muted-foreground",
                    )}
                  >
                    {n.severity}
                  </span>
                  <span className="text-xs font-medium text-foreground truncate">{n.siteName}</span>
                </div>
                <span className="text-xs text-muted-foreground truncate">{n.title}</span>
                <span className="text-[10px] text-muted-foreground/70">
                  {formatDistanceToNow(new Date(n.startedAt), { addSuffix: true })}
                </span>
              </button>
            ))}
            <DropdownMenuSeparator />
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOpen(false);
                navigate("/incidents");
              }}
            >
              {t("notif.viewAll")}
            </Button>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
