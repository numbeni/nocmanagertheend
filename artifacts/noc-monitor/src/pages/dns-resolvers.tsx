import { useState } from "react";
import {
  useListDnsResolvers,
  useAddDnsResolvers,
  useDeleteDnsResolver,
  getListDnsResolversQueryKey,
  type DnsResolverEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Server, Trash2, Lock, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

function ResolverRow({ r, onDelete, deleting }: {
  r: DnsResolverEntry;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 border border-border rounded-md bg-card">
      <div className="flex items-center gap-3 min-w-0">
        {r.builtIn ? (
          <Lock className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Server className="h-4 w-4 text-primary" />
        )}
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{r.name}</div>
          <div className="text-xs font-mono text-muted-foreground">{r.address}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {r.builtIn ? (
          <Badge variant="outline" className="text-[10px] uppercase">Built-in</Badge>
        ) : (
          <>
            <Badge variant="outline" className="text-[10px] uppercase border-primary/40 text-primary">Custom</Badge>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={deleting}
              title="Delete resolver"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function DnsResolversPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [text, setText] = useState("");

  const { data, isLoading } = useListDnsResolvers();
  const addMut = useAddDnsResolvers();
  const delMut = useDeleteDnsResolver();

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListDnsResolversQueryKey() });

  function handleAdd() {
    if (!text.trim()) return;
    addMut.mutate(
      { data: { text } },
      {
        onSuccess: (res) => {
          const addedCount = res.added.length;
          const skippedCount = res.skipped.length;
          toast({
            title: addedCount > 0 ? `Added ${addedCount} resolver(s)` : "Nothing added",
            description: skippedCount > 0
              ? `${skippedCount} entry(ies) skipped: ${res.skipped.map((s) => `${s.value} (${s.reason})`).join(", ")}`
              : undefined,
            variant: addedCount === 0 && skippedCount > 0 ? "destructive" : "default",
          });
          setText("");
          refresh();
        },
        onError: () => {
          toast({ title: "Failed to add resolvers", variant: "destructive" });
        },
      },
    );
  }

  function handleDelete(id: number) {
    delMut.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Resolver removed" });
          refresh();
        },
        onError: () => {
          toast({ title: "Failed to remove resolver", variant: "destructive" });
        },
      },
    );
  }

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Server className="h-8 w-8 text-primary" />
          DNS Resolvers
        </h1>
        <p className="text-muted-foreground mt-1">
          Built-in resolvers always run. Add your own to widen the Gold DNS check.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add custom resolvers</CardTitle>
          <CardDescription>
            One IP per line, or comma separated. Optional <code>name=ip</code> format. Duplicates and built-ins are skipped automatically.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"1.1.1.1\n8.8.8.8\nMyISP=185.1.1.1"}
            className="font-mono min-h-32"
          />
        </CardContent>
        <CardFooter className="justify-end">
          <Button onClick={handleAdd} disabled={addMut.isPending || !text.trim()}>
            {addMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Add resolvers
          </Button>
        </CardFooter>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Custom resolvers
              <Badge variant="outline">{data?.custom.length ?? 0}</Badge>
            </CardTitle>
            <CardDescription>Removable. Used in DNS health checks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
            {data?.custom.length === 0 && (
              <div className="text-sm text-muted-foreground italic">
                No custom resolvers yet. Add some above.
              </div>
            )}
            {data?.custom.map((r) => (
              <ResolverRow
                key={r.id ?? r.address}
                r={r}
                onDelete={() => r.id != null && handleDelete(r.id)}
                deleting={delMut.isPending && delMut.variables?.id === r.id}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Built-in resolvers
              <Badge variant="outline">{data?.builtIn.length ?? 0}</Badge>
            </CardTitle>
            <CardDescription>Always active. Cannot be removed.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data?.builtIn.map((r) => (
              <ResolverRow key={r.address} r={r} />
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
