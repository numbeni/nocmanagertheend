import { AlertCircle, AlertTriangle, CheckCircle2, Clock, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { OverallStatus } from "@workspace/api-client-react";
import { useT } from "@/i18n/LanguageProvider";

export function StatusBadge({ status }: { status: OverallStatus }) {
  const { t } = useT();
  switch (status) {
    case "up":
      return (
        <Badge className="bg-success text-success-foreground hover:bg-success/90">
          <CheckCircle2 className="w-3 h-3 mr-1" /> {t("status.up")}
        </Badge>
      );
    case "slow":
      return (
        <Badge className="bg-warning text-warning-foreground hover:bg-warning/90">
          <Clock className="w-3 h-3 mr-1" /> {t("status.slow")}
        </Badge>
      );
    case "down":
      return (
        <Badge variant="destructive">
          <AlertCircle className="w-3 h-3 mr-1" /> {t("status.down")}
        </Badge>
      );
    case "degraded":
      return (
        <Badge className="bg-orange-500 text-white hover:bg-orange-600">
          <AlertTriangle className="w-3 h-3 mr-1" /> {t("status.degraded")}
        </Badge>
      );
    case "blocked":
      return (
        <Badge className="bg-slate-500 text-white hover:bg-slate-600">
          <ShieldAlert className="w-3 h-3 mr-1" /> {t("status.blocked")}
        </Badge>
      );
    case "not_stable":
      return (
        <Badge className="bg-amber-500 text-white hover:bg-amber-600">
          <AlertTriangle className="w-3 h-3 mr-1" /> {t("status.notStable")}
        </Badge>
      );
    default:
      return <Badge variant="secondary">{t("status.unknown")}</Badge>;
  }
}
