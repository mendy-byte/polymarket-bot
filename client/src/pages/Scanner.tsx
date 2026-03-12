import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { useState, useMemo } from "react";
import { Loader2, Radar, Brain, ShoppingCart, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

function formatPrice(price: string | number): string {
  const p = typeof price === "string" ? parseFloat(price) : price;
  return `$${p.toFixed(4)}`;
}

function formatLiquidity(liq: string | number): string {
  const l = typeof liq === "string" ? parseFloat(liq) : liq;
  if (l >= 1000000) return `$${(l / 1000000).toFixed(1)}M`;
  if (l >= 1000) return `$${(l / 1000).toFixed(0)}K`;
  return `$${l.toFixed(0)}`;
}

function AiScoreBadge({ score }: { score: number | null }) {
  if (score === null || score === undefined) {
    return <Badge variant="secondary" className="font-mono text-xs">--</Badge>;
  }
  const s = typeof score === "string" ? parseFloat(score) : score;
  if (s >= 7) return <Badge className="bg-profit/20 text-profit border-profit/30 font-mono text-xs">{s.toFixed(0)}</Badge>;
  if (s >= 5) return <Badge className="bg-warning/20 text-warning border-warning/30 font-mono text-xs">{s.toFixed(0)}</Badge>;
  return <Badge className="bg-loss/20 text-loss border-loss/30 font-mono text-xs">{s.toFixed(0)}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    discovered: "bg-primary/20 text-primary border-primary/30",
    evaluated: "bg-warning/20 text-warning border-warning/30",
    approved: "bg-profit/20 text-profit border-profit/30",
    rejected: "bg-loss/20 text-loss border-loss/30",
    ordered: "bg-profit/20 text-profit border-profit/30",
  };
  return (
    <Badge className={`${colors[status] || "bg-muted text-muted-foreground"} text-xs`}>
      {status}
    </Badge>
  );
}

function ScannerContent() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [scanPages, setScanPages] = useState(10);

  const { data: events, isLoading, refetch } = trpc.scanner.events.useQuery(
    { status: statusFilter === "all" ? undefined : statusFilter, limit: 200 },
    { refetchInterval: 30000 }
  );

  const scanMutation = trpc.scanner.scan.useMutation({
    onSuccess: (data) => {
      toast.success(`Scan complete: ${data.total} cheap outcomes found, ${data.newOrUpdated} new/updated`);
      refetch();
    },
    onError: (err) => toast.error(`Scan failed: ${err.message}`),
  });

  const evaluateMutation = trpc.scanner.evaluate.useMutation({
    onSuccess: (data) => {
      toast.success(`AI evaluated ${data.evaluated} events`);
      refetch();
    },
    onError: (err) => toast.error(`Evaluation failed: ${err.message}`),
  });

  const orderMutation = trpc.portfolio.placeOrder.useMutation({
    onSuccess: (data) => {
      toast.success(`Order ${data.status}: ${data.shares.toFixed(0)} shares at ${formatPrice(data.price)}`);
      refetch();
    },
    onError: (err) => toast.error(`Order failed: ${err.message}`),
  });

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    let filtered = [...events];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.question.toLowerCase().includes(q) ||
          (e.category || "").toLowerCase().includes(q) ||
          e.outcome.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [events, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Event Scanner</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Scan Polymarket for mispriced tail-risk events
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => evaluateMutation.mutate({ autoEvaluate: true })}
            disabled={evaluateMutation.isPending}
            variant="outline"
            size="sm"
          >
            {evaluateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Brain className="h-4 w-4 mr-1" />
            )}
            AI Evaluate
          </Button>
          <Button
            onClick={() => scanMutation.mutate({ maxPages: scanPages })}
            disabled={scanMutation.isPending}
            size="sm"
          >
            {scanMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <Radar className="h-4 w-4 mr-1" />
            )}
            Scan Markets
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="bg-card border-border">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs bg-input border-border"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 bg-input border-border">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="discovered">Discovered</SelectItem>
                <SelectItem value="evaluated">Evaluated</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="ordered">Ordered</SelectItem>
              </SelectContent>
            </Select>
            <Select value={String(scanPages)} onValueChange={(v) => setScanPages(Number(v))}>
              <SelectTrigger className="w-32 bg-input border-border">
                <SelectValue placeholder="Pages" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5 pages</SelectItem>
                <SelectItem value="10">10 pages</SelectItem>
                <SelectItem value="20">20 pages</SelectItem>
                <SelectItem value="50">50 pages</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-sm text-muted-foreground ml-auto">
              {filteredEvents.length} events
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Events Table */}
      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Radar className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No events found. Run a scan to discover cheap outcomes.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Event</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Outcome</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Price</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Liquidity</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Hours</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">AI</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvents.map((event) => (
                    <EventRow
                      key={event.id}
                      event={event}
                      expanded={expandedId === event.id}
                      onToggle={() => setExpandedId(expandedId === event.id ? null : event.id)}
                      onOrder={(amount) => orderMutation.mutate({ scannedEventId: event.id, amountUsd: amount })}
                      onEvaluate={() => evaluateMutation.mutate({ eventIds: [event.id] })}
                      orderPending={orderMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EventRow({
  event,
  expanded,
  onToggle,
  onOrder,
  onEvaluate,
  orderPending,
}: {
  event: any;
  expanded: boolean;
  onToggle: () => void;
  onOrder: (amount: number) => void;
  onEvaluate: () => void;
  orderPending: boolean;
}) {
  const aiScore = event.aiScore ? parseFloat(event.aiScore) : null;

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
        onClick={onToggle}
      >
        <td className="p-3 max-w-xs">
          <div className="flex items-center gap-2">
            {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
            <span className="truncate text-foreground">{event.question}</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize ml-5">{event.category || "other"}</span>
        </td>
        <td className="p-3">
          <Badge variant="outline" className="text-xs">{event.outcome}</Badge>
        </td>
        <td className="p-3 text-right font-mono text-foreground">{formatPrice(event.price)}</td>
        <td className="p-3 text-right font-mono text-muted-foreground">{formatLiquidity(event.liquidity || "0")}</td>
        <td className="p-3 text-right font-mono text-muted-foreground">{event.hoursToResolution || "--"}</td>
        <td className="p-3 text-center"><AiScoreBadge score={aiScore} /></td>
        <td className="p-3 text-center"><StatusBadge status={event.status} /></td>
        <td className="p-3 text-right">
          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
            {event.status !== "ordered" && event.status !== "rejected" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => onOrder(5)}
                disabled={orderPending}
              >
                <ShoppingCart className="h-3 w-3" />
              </Button>
            )}
            {event.slug && (
              <a
                href={`https://polymarket.com/event/${event.eventSlug || event.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent transition-colors"
              >
                <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-muted/10">
          <td colSpan={8} className="p-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">Event Details</h4>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>Market ID: <span className="font-mono">{event.marketId}</span></p>
                  <p>End Date: {event.endDate ? new Date(event.endDate).toLocaleString() : "N/A"}</p>
                  <p>Tick Size: {event.tickSize}</p>
                  <p>Min Order: {event.minOrderSize} shares</p>
                  <p>Tags: {Array.isArray(event.tags) ? event.tags.map((t: any) => t.label || t).join(", ") : "N/A"}</p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2">AI Assessment</h4>
                {event.aiReasoning ? (
                  <p className="text-xs text-muted-foreground">{event.aiReasoning}</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-muted-foreground">Not evaluated yet.</p>
                    <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onEvaluate}>
                      <Brain className="h-3 w-3 mr-1" />
                      Evaluate
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" variant="default" className="text-xs" onClick={() => onOrder(1)} disabled={orderPending}>
                Buy $1
              </Button>
              <Button size="sm" variant="default" className="text-xs" onClick={() => onOrder(3)} disabled={orderPending}>
                Buy $3
              </Button>
              <Button size="sm" variant="default" className="text-xs" onClick={() => onOrder(5)} disabled={orderPending}>
                Buy $5
              </Button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Scanner() {
  return (
    <DashboardLayout>
      <ScannerContent />
    </DashboardLayout>
  );
}
