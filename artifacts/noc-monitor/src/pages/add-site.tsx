import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useLocation, Link } from "wouter";
import {
  useCreateSite,
  useBulkAddSites,
  getListSitesQueryKey,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Globe,
  ArrowLeft,
  Loader2,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Server,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/i18n/LanguageProvider";

interface ServerRecord {
  id: number;
  code: string;
  name: string;
  color: string;
}

function useServers() {
  return useQuery<ServerRecord[]>({
    queryKey: ["servers"],
    queryFn: () => fetch("/api/servers", { credentials: "include" }).then((r) => r.json()),
    staleTime: 30000,
  });
}

function normalizeUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

const formSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters."),
  url: z
    .string()
    .min(3, "URL is required")
    .refine(
      (val) => {
        try {
          const u = new URL(normalizeUrl(val));
          return !!u.hostname && u.hostname.includes(".");
        } catch {
          return false;
        }
      },
      { message: "Enter a valid hostname or URL (e.g. google.com)" },
    ),
  serverId: z.number({ required_error: "Server is required" }).int().positive("Server is required"),
});

interface BulkResultEntry {
  line: number;
  value: string;
  reason: string;
}
interface BulkResult {
  totalProcessed: number;
  addedCount: number;
  duplicateCount: number;
  invalidCount: number;
  added: { id: number; name: string; url: string; host: string }[];
  duplicates: BulkResultEntry[];
  invalid: BulkResultEntry[];
  monitoringPaused?: boolean;
}

function SingleAddForm() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const createSite = useCreateSite();
  const { data: servers = [] } = useServers();

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", url: "", serverId: undefined as unknown as number },
  });

  function onSubmit(values: z.infer<typeof formSchema>) {
    const payload = { ...values, url: normalizeUrl(values.url) };
    createSite.mutate(
      { data: payload as Parameters<typeof createSite.mutate>[0]["data"] },
      {
        onSuccess: (newSite) => {
          toast({ title: t("add.success.title"), description: `${(newSite as { name: string }).name} ${t("add.success.desc")}` });
          queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          setLocation(`/sites/${(newSite as { id: number }).id}`);
        },
        onError: () => {
          toast({ title: t("add.error.title"), description: t("add.error.desc"), variant: "destructive" });
        },
      },
    );
  }

  return (
    <Card className="border-border shadow-md">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4 text-primary">
          <Globe className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">{t("add.title")}</CardTitle>
        <CardDescription>{t("add.subtitle")}</CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("add.name")}</FormLabel>
                  <FormControl>
                    <Input placeholder="Acme Corp API" {...field} />
                  </FormControl>
                  <FormDescription>{t("add.nameDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="url"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("add.url")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="google.com"
                      dir="ltr"
                      {...field}
                      onBlur={(e) => {
                        const normalized = normalizeUrl(e.target.value);
                        field.onChange(normalized);
                        if (!form.getValues("name") && normalized) {
                          try {
                            const hostname = new URL(normalized).hostname.replace(/^www\./i, "");
                            const parts = hostname.split(".");
                            if (parts.length >= 2) {
                              const slug = parts[parts.length - 2];
                              form.setValue("name", slug.charAt(0).toUpperCase() + slug.slice(1), { shouldValidate: false });
                            }
                          } catch { /* ignore */ }
                        }
                        field.onBlur();
                      }}
                    />
                  </FormControl>
                  <FormDescription>{t("add.urlDesc")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="serverId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5" />
                      {t("addSite.server")} <span className="text-destructive">*</span>
                    </span>
                  </FormLabel>
                  {servers.length === 0 ? (
                    <div className="flex items-center gap-2 text-sm text-amber-500 border border-amber-500/30 bg-amber-950/20 rounded-md px-3 py-2">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      <span>{t("addSite.noServers")}</span>
                      <Link href="/servers" className="underline ml-auto flex-shrink-0">Create</Link>
                    </div>
                  ) : (
                    <Select
                      value={field.value ? String(field.value) : ""}
                      onValueChange={(v) => field.onChange(parseInt(v))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={t("addSite.serverPlaceholder")} />
                      </SelectTrigger>
                      <SelectContent>
                        {servers.map((s) => (
                          <SelectItem key={s.id} value={String(s.id)}>
                            <span className="flex items-center gap-2">
                              <span
                                className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                                style={{ backgroundColor: s.color }}
                              />
                              <span className="font-medium">{s.code}</span>
                              <span className="text-muted-foreground">— {s.name}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button
              type="submit"
              className="w-full"
              disabled={createSite.isPending || servers.length === 0}
            >
              {createSite.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("add.start")}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}

function BulkAddForm() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useT();
  const bulkAdd = useBulkAddSites();
  const { data: servers = [] } = useServers();

  const [text, setText] = useState("");
  const [serverId, setServerId] = useState<string>("");
  const [result, setResult] = useState<BulkResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const txt = await file.text();
    setText((prev) => (prev ? `${prev}\n${txt}` : txt));
  };

  const handleSubmit = () => {
    if (!text.trim()) {
      toast({ title: t("bulk.empty.error"), variant: "destructive" });
      return;
    }
    if (!serverId) {
      toast({ title: t("addSite.serverRequired"), variant: "destructive" });
      return;
    }
    bulkAdd.mutate(
      { data: { text, serverId: parseInt(serverId) } as Parameters<typeof bulkAdd.mutate>[0]["data"] },
      {
        onSuccess: (data) => {
          const r = data as BulkResult;
          setResult(r);
          if (r.addedCount > 0) {
            queryClient.invalidateQueries({ queryKey: getListSitesQueryKey() });
          }
          if (r.monitoringPaused) {
            toast({
              title: t("bulk.pausedWarning"),
              variant: "destructive",
              duration: 8000,
            });
          }
        },
        onError: () => {
          toast({
            title: t("bulk.error.title"),
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <Card className="border-border shadow-md">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-4 text-primary">
          <FileText className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">{t("bulk.title")}</CardTitle>
        <CardDescription>{t("bulk.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Server selection (required for bulk) */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <Server className="h-3.5 w-3.5" />
            {t("addSite.bulkServer")} <span className="text-destructive">*</span>
          </label>
          {servers.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-amber-500 border border-amber-500/30 bg-amber-950/20 rounded-md px-3 py-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              <span>{t("addSite.noServers")}</span>
              <Link href="/servers" className="underline ml-auto flex-shrink-0">Create</Link>
            </div>
          ) : (
            <Select value={serverId} onValueChange={setServerId}>
              <SelectTrigger>
                <SelectValue placeholder={t("addSite.serverPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {servers.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="font-medium">{s.code}</span>
                      <span className="text-muted-foreground">— {s.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">{t("addSite.bulkServerHint")}</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("bulk.textareaLabel")}</label>
          <Textarea
            placeholder={t("bulk.placeholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            dir="ltr"
            className="font-mono text-sm resize-none"
          />
          <p className="text-xs text-muted-foreground">{t("bulk.subtitle")}</p>
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4 mr-2" />
            {t("bulk.uploadFile")}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>

        {/* Results */}
        {result && (
          <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/30">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{t("bulk.summary.added")}: <strong>{result.addedCount}</strong></span>
              </div>
              {result.duplicateCount > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-yellow-500" />
                  <span>{t("bulk.summary.duplicates")}: <strong>{result.duplicateCount}</strong></span>
                </div>
              )}
              {result.invalidCount > 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span>{t("bulk.summary.invalid")}: <strong>{result.invalidCount}</strong></span>
                </div>
              )}
            </div>
            {result.addedCount > 0 && (
              <Button size="sm" onClick={() => setLocation("/")} variant="outline" className="w-full">
                {t("bulk.summary.viewDash")}
              </Button>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          onClick={handleSubmit}
          disabled={bulkAdd.isPending || !text.trim() || !serverId || servers.length === 0}
        >
          {bulkAdd.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("bulk.import")}
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function AddSite() {
  const { t } = useT();
  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            {t("common.back")}
          </Button>
        </Link>
      </div>
      <Tabs defaultValue="single">
        <TabsList className="w-full">
          <TabsTrigger value="single" className="flex-1">{t("add.title")}</TabsTrigger>
          <TabsTrigger value="bulk" className="flex-1">{t("bulk.title")}</TabsTrigger>
        </TabsList>
        <TabsContent value="single" className="mt-4">
          <SingleAddForm />
        </TabsContent>
        <TabsContent value="bulk" className="mt-4">
          <BulkAddForm />
        </TabsContent>
      </Tabs>
    </div>
  );
}
