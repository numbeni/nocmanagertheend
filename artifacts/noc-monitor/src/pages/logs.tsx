import { useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { faIR } from "date-fns/locale";
import {
  useListLogs,
  getListLogsQueryKey,
  type LogEntry,
} from "@workspace/api-client-react";
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Info,
  RefreshCw,
  ScrollText,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useT } from "@/i18n/LanguageProvider";

const LEVELS = ["all", "error", "warn", "info", "debug"] as const;
const CATEGORIES = ["all", "system", "monitor", "incident", "api", "dns"] as const;

function LevelBadge({ level }: { level: string }) {
  const map: Record<string, { cls: string; icon: typeof Info }> = {
    error: { cls: "bg-destructive/15 text-destructive border-destructive/30", icon: AlertCircle },
    warn: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30", icon: AlertTriangle },
    info: { cls: "bg-primary/15 text-primary border-primary/30", icon: Info },
    debug: { cls: "bg-muted text-muted-foreground border-border", icon: Info },
  };
  const { cls, icon: Icon } = map[level] ?? map.info!;
  return (
    <Badge variant="outline" className={`${cls} gap-1 font-mono text-[10px] uppercase`}>
      <Icon className="h-3 w-3" />
      {level}
    </Badge>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="font-mono text-[10px] uppercase text-muted-foreground">
      {category}
    </Badge>
  );
}

export default function LogsPage() {
  const { t, dir } = useT();
  const [level, setLevel] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");

  const params: Record<string, string | number> = { limit: 300 };
  if (level !== "all") params.level = level;
  if (category !== "all") params.category = category;

  const { data: logs, isLoading, refetch, isFetching } = useListLogs(params as any, {
    query: {
      queryKey: getListLogsQueryKey(params as any),
      refetchInterval: 5000,
    },
  });

  const handleDownload = () => {
    const qs = new URLSearchParams();
    if (level !== "all") qs.set("level", level);
    if (category !== "all") qs.set("category", category);
    qs.set("limit", "10000");
    const url = `/api/logs/export?${qs.toString()}`;
    window.open(url, "_blank");
  };

  const counts = (logs ?? []).reduce(
    (acc: Record<string, number>, l: LogEntry) => {
      acc[l.level] = (acc[l.level] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const locale = dir === "rtl" ? faIR : undefined;

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <ScrollText className="h-8 w-8 text-primary" />
            {t("logs.title")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("logs.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 me-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("logs.refresh")}
          </Button>
          <Button size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 me-2" />
            {t("logs.download")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("logs.totalShown")}</CardDescription>
            <CardTitle className="text-2xl">{logs?.length ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("logs.errors")}</CardDescription>
            <CardTitle className="text-2xl text-destructive">{counts.error ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("logs.warnings")}</CardDescription>
            <CardTitle className="text-2xl text-amber-400">{counts.warn ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("logs.info")}</CardDescription>
            <CardTitle className="text-2xl text-primary">{counts.info ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle>{t("logs.activityStream")}</CardTitle>
              <CardDescription>{t("logs.newestFirst")}</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select value={level} onValueChange={setLevel}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l === "all" ? t("logs.levelAll") : l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c === "all" ? t("logs.categoryAll") : c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">{t("logs.col.time")}</TableHead>
                  <TableHead className="w-24">{t("logs.col.level")}</TableHead>
                  <TableHead className="w-28">{t("logs.col.category")}</TableHead>
                  <TableHead>{t("logs.col.message")}</TableHead>
                  <TableHead className="w-20 text-right">{t("logs.col.site")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : logs && logs.length > 0 ? (
                  logs.map((log: LogEntry) => (
                    <TableRow key={log.id} className="font-mono text-xs">
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        <div dir="ltr">{format(new Date(log.timestamp), "HH:mm:ss")}</div>
                        <div className="text-[10px] opacity-70">
                          {formatDistanceToNow(new Date(log.timestamp), { addSuffix: true, locale })}
                        </div>
                      </TableCell>
                      <TableCell><LevelBadge level={log.level} /></TableCell>
                      <TableCell><CategoryBadge category={log.category} /></TableCell>
                      <TableCell className="font-sans">
                        <div className="text-sm">{log.message}</div>
                        {log.details && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-2xl">
                            {log.details}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {log.siteId ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                      <ScrollText className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      {t("logs.empty")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
