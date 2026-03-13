import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Loader2, Briefcase, FileText, Clock, Trophy, XCircle, TrendingUp, TrendingDown, BarChart3, Target, RefreshCw } from "lucide-react";
import { toast } from "sonner";

function formatUsd(val: number | string): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function PnlDisplay({ pnl, pnlPercent }: { pnl: string | null; pnlPercent: string | null }) {
  const n = parseFloat(pnl || "0");
  const p = parseFloat(pnlPercent || "0");
  return (
    <span className={`font-mono text-sm ${n >= 0 ? "text-profit" : "text-loss"}`}>
      {n >= 0 ? "+" : ""}{formatUsd(n)} ({p >= 0 ? "+" : ""}{p.toFixed(1)}%)
    </span>
  );
}

function formatTimeUntil(dateStr: string | null | undefined): { text: string; urgency: "soon" | "medium" | "far" | "expired" | "unknown" } {
  if (!dateStr) return { text: "--", urgency: "unknown" };
  const now = Date.now();
  const end = new Date(dateStr).getTime();
  if (isNaN(end)) return { text: "--", urgency: "unknown" };
  const diff = end - now;
  if (diff < 0) return { text: "Expired", urgency: "expired" };
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days === 0) return { text: `${hours}h`, urgency: "soon" };
  if (days < 7) return { text: `${days}d ${hours}h`, urgency: "soon" };
  if (days < 30) return { text: `${days}d`, urgency: "medium" };
  if (days < 365) return { text: `${Math.floor(days / 30)}mo ${days % 30}d`, urgency: "far" };
  return { text: `${(days / 365).toFixed(1)}yr`, urgency: "far" };
}

function ExpiryDisplay({ endDate }: { endDate: string | Date | null | undefined }) {
  const dateStr = endDate instanceof Date ? endDate.toISOString() : endDate;
  const { text, urgency } = formatTimeUntil(dateStr);
  const colorMap = {
    soon: "text-warning",
    medium: "text-primary",
    far: "text-muted-foreground",
    expired: "text-loss",
    unknown: "text-muted-foreground",
  };
  const dateLabel = endDate ? new Date(endDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <div className="text-right">
      <span className={`font-mono text-sm ${colorMap[urgency]}`}>{text}</span>
      {dateLabel && <p className="text-xs text-muted-foreground">{dateLabel}</p>}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: "bg-primary/20 text-primary border-primary/30",
    resolved_win: "bg-profit/20 text-profit border-profit/30",
    resolved_loss: "bg-loss/20 text-loss border-loss/30",
    sold: "bg-muted text-muted-foreground",
    pending: "bg-warning/20 text-warning border-warning/30",
    placed: "bg-primary/20 text-primary border-primary/30",
    filled: "bg-profit/20 text-profit border-profit/30",
    cancelled: "bg-muted text-muted-foreground",
    failed: "bg-loss/20 text-loss border-loss/30",
  };
  return <Badge className={`${colors[status] || "bg-muted text-muted-foreground"} text-xs`}>{status.replace("_", " ")}</Badge>;
}

function PositionsTable() {
  const { data: positions, isLoading } = trpc.portfolio.positions.useQuery({}, { refetchInterval: 15000 });
  const utils = trpc.useUtils();
  const refreshPrices = trpc.portfolio.refreshPrices.useMutation({
    onSuccess: (result) => {
      utils.portfolio.positions.invalidate();
      toast.success(`Prices refreshed: ${result.updated}/${result.total} positions updated`);
    },
    onError: (err) => {
      toast.error(`Refresh failed: ${err.message}`);
    },
  });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!positions || positions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <Briefcase className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No positions yet. Place orders from the Event Scanner.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="text-sm text-muted-foreground">{positions.length} positions</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refreshPrices.mutate()}
          disabled={refreshPrices.isPending}
          className="gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshPrices.isPending ? "animate-spin" : ""}`} />
          {refreshPrices.isPending ? "Refreshing..." : "Refresh Prices"}
        </Button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Event</th>
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Outcome</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Entry</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Shares</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Current</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">P&L</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Expires</th>
            <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((pos) => (
            <tr key={pos.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="p-3 max-w-xs">
                <span className="truncate block text-foreground">{pos.question}</span>
                <span className="text-xs text-muted-foreground capitalize">{pos.category || "other"}</span>
              </td>
              <td className="p-3"><Badge variant="outline" className="text-xs">{pos.outcome}</Badge></td>
              <td className="p-3 text-right font-mono text-foreground">${parseFloat(pos.entryPrice).toFixed(4)}</td>
              <td className="p-3 text-right font-mono text-muted-foreground">{parseFloat(pos.shares).toFixed(0)}</td>
              <td className="p-3 text-right font-mono text-foreground">{formatUsd(pos.costBasis)}</td>
              <td className="p-3 text-right font-mono text-foreground">{pos.currentPrice ? `$${parseFloat(pos.currentPrice).toFixed(4)}` : "--"}</td>
              <td className="p-3 text-right"><PnlDisplay pnl={pos.pnl} pnlPercent={pos.pnlPercent} /></td>
              <td className="p-3"><ExpiryDisplay endDate={pos.endDate} /></td>
              <td className="p-3 text-center"><StatusBadge status={pos.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function OrdersTable() {
  const { data: orders, isLoading } = trpc.portfolio.orders.useQuery({}, { refetchInterval: 15000 });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!orders || orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
        <FileText className="h-8 w-8 mb-2 opacity-50" />
        <p className="text-sm">No orders yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Market</th>
            <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Side</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Price</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Size</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
            <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
            <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
              <td className="p-3 font-mono text-xs text-foreground">{order.marketId.slice(0, 12)}...</td>
              <td className="p-3 text-center"><Badge className="bg-profit/20 text-profit border-profit/30 text-xs">{order.side}</Badge></td>
              <td className="p-3 text-right font-mono text-foreground">${parseFloat(order.price).toFixed(4)}</td>
              <td className="p-3 text-right font-mono text-muted-foreground">{parseFloat(order.size).toFixed(0)}</td>
              <td className="p-3 text-right font-mono text-foreground">{formatUsd(order.amountUsd)}</td>
              <td className="p-3 text-center"><StatusBadge status={order.status} /></td>
              <td className="p-3 text-right text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResolvedSummary() {
  const { data: summary, isLoading } = trpc.portfolio.resolvedSummary.useQuery(undefined, { refetchInterval: 30000 });

  if (isLoading) return <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  if (!summary || summary.totalResolved === 0) {
    return (
      <div className="space-y-6">
        {/* Empty state with context */}
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Target className="h-12 w-12 mb-4 opacity-30" />
          <h3 className="text-lg font-medium text-foreground mb-2">No Resolved Positions Yet</h3>
          <p className="text-sm text-center max-w-md">
            Positions will appear here once markets resolve. Short-dated events (days/weeks) will resolve first.
            The bot needs ~2.7% hit rate to break even on tail-risk bets.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-4 text-center">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-2xl font-mono font-semibold text-foreground">{summary?.openPositionsCount ?? 0}</p>
              <p className="text-xs text-muted-foreground mt-1">Open Positions</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-2xl font-mono font-semibold text-foreground">{summary?.totalOpenCost ? formatUsd(summary.totalOpenCost) : "$0.00"}</p>
              <p className="text-xs text-muted-foreground mt-1">Capital at Risk</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Resolved</p>
                <p className="text-2xl font-mono font-semibold text-foreground mt-1">{summary.totalResolved}</p>
                <p className="text-xs text-muted-foreground">{summary.openPositionsCount} still open</p>
              </div>
              <BarChart3 className="h-5 w-5 text-primary opacity-70" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Win Rate</p>
                <p className={`text-2xl font-mono font-semibold mt-1 ${summary.winRate >= 2.7 ? "text-profit" : "text-warning"}`}>
                  {summary.winRate.toFixed(1)}%
                </p>
                <p className="text-xs text-muted-foreground">{summary.totalWins}W / {summary.totalLosses}L</p>
              </div>
              <Trophy className="h-5 w-5 text-profit opacity-70" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Net P&L</p>
                <p className={`text-2xl font-mono font-semibold mt-1 ${summary.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                  {summary.totalPnl >= 0 ? "+" : ""}{formatUsd(summary.totalPnl)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {summary.totalPnlPercent >= 0 ? "+" : ""}{summary.totalPnlPercent.toFixed(1)}% ROI
                </p>
              </div>
              {summary.totalPnl >= 0 ? <TrendingUp className="h-5 w-5 text-profit opacity-70" /> : <TrendingDown className="h-5 w-5 text-loss opacity-70" />}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider">Total Payout</p>
                <p className="text-2xl font-mono font-semibold text-foreground mt-1">{formatUsd(summary.totalPayout)}</p>
                <p className="text-xs text-muted-foreground">from {formatUsd(summary.totalCostResolved)} invested</p>
              </div>
              <Target className="h-5 w-5 text-primary opacity-70" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Win/Loss Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Trophy className="h-4 w-4 text-profit" /> Wins Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Win P&L</span>
              <span className="font-mono text-sm text-profit">+{formatUsd(summary.winPnl)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg Win</span>
              <span className="font-mono text-sm text-profit">+{formatUsd(summary.avgWinPnl)}</span>
            </div>
            {summary.bestWin && (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground mb-1">Best Win</p>
                <p className="text-sm text-foreground truncate">{summary.bestWin.question}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{summary.bestWin.outcome}</Badge>
                  <span className="font-mono text-xs text-profit">+{formatUsd(parseFloat(summary.bestWin.pnl || "0"))}</span>
                  <span className="text-xs text-muted-foreground capitalize">{summary.bestWin.category}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4 text-loss" /> Losses Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Total Loss P&L</span>
              <span className="font-mono text-sm text-loss">{formatUsd(summary.lossPnl)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Avg Loss</span>
              <span className="font-mono text-sm text-loss">{formatUsd(summary.avgLossPnl)}</span>
            </div>
            {summary.worstLoss && (
              <div className="border-t border-border pt-3">
                <p className="text-xs text-muted-foreground mb-1">Worst Loss</p>
                <p className="text-sm text-foreground truncate">{summary.worstLoss.question}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="outline" className="text-xs">{summary.worstLoss.outcome}</Badge>
                  <span className="font-mono text-xs text-loss">{formatUsd(parseFloat(summary.worstLoss.pnl || "0"))}</span>
                  <span className="text-xs text-muted-foreground capitalize">{summary.worstLoss.category}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category P&L Breakdown */}
      {summary.categoryBreakdown.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">P&L by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Category</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">W/L</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Win Rate</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Invested</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Payout</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">P&L</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.categoryBreakdown.map((cat) => (
                    <tr key={cat.category} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="p-3 capitalize text-foreground font-medium">{cat.category}</td>
                      <td className="p-3 text-center">
                        <span className="text-profit">{cat.wins}</span>
                        <span className="text-muted-foreground mx-1">/</span>
                        <span className="text-loss">{cat.losses}</span>
                      </td>
                      <td className="p-3 text-right font-mono">
                        <span className={cat.winRate > 0 ? "text-profit" : "text-muted-foreground"}>{cat.winRate.toFixed(1)}%</span>
                      </td>
                      <td className="p-3 text-right font-mono text-muted-foreground">{formatUsd(cat.costBasis)}</td>
                      <td className="p-3 text-right font-mono text-foreground">{formatUsd(cat.payout)}</td>
                      <td className="p-3 text-right font-mono">
                        <span className={cat.pnl >= 0 ? "text-profit" : "text-loss"}>
                          {cat.pnl >= 0 ? "+" : ""}{formatUsd(cat.pnl)}
                        </span>
                      </td>
                      <td className="p-3 text-right font-mono">
                        <span className={cat.roi >= 0 ? "text-profit" : "text-loss"}>
                          {cat.roi >= 0 ? "+" : ""}{cat.roi.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Timeline */}
      {summary.monthlyBreakdown.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-foreground">Monthly Resolution Timeline</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Month</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Resolved</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">W/L</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Win Rate</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">P&L</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    let cumPnl = 0;
                    return summary.monthlyBreakdown.map((m) => {
                      cumPnl += m.pnl;
                      return (
                        <tr key={m.month} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                          <td className="p-3 text-foreground font-medium">{m.month}</td>
                          <td className="p-3 text-center text-muted-foreground">{m.wins + m.losses}</td>
                          <td className="p-3 text-center">
                            <span className="text-profit">{m.wins}</span>
                            <span className="text-muted-foreground mx-1">/</span>
                            <span className="text-loss">{m.losses}</span>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <span className={m.winRate > 0 ? "text-profit" : "text-muted-foreground"}>{m.winRate.toFixed(1)}%</span>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <span className={m.pnl >= 0 ? "text-profit" : "text-loss"}>
                              {m.pnl >= 0 ? "+" : ""}{formatUsd(m.pnl)}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono">
                            <span className={cumPnl >= 0 ? "text-profit" : "text-loss"}>
                              {cumPnl >= 0 ? "+" : ""}{formatUsd(cumPnl)}
                            </span>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Resolution History Table */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">Resolution History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Event</th>
                  <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Outcome</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Entry</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Cost</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Payout</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">P&L</th>
                  <th className="text-center p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Result</th>
                  <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Resolved</th>
                </tr>
              </thead>
              <tbody>
                {summary.resolvedPositions.map((pos) => (
                  <tr key={pos.id} className={`border-b border-border/50 hover:bg-muted/20 transition-colors ${pos.status === "resolved_win" ? "bg-profit/5" : ""}`}>
                    <td className="p-3 max-w-xs">
                      <span className="truncate block text-foreground">{pos.question}</span>
                      <span className="text-xs text-muted-foreground capitalize">{pos.category || "other"}</span>
                    </td>
                    <td className="p-3"><Badge variant="outline" className="text-xs">{pos.outcome}</Badge></td>
                    <td className="p-3 text-right font-mono text-foreground">${parseFloat(pos.entryPrice).toFixed(4)}</td>
                    <td className="p-3 text-right font-mono text-muted-foreground">{formatUsd(pos.costBasis)}</td>
                    <td className="p-3 text-right font-mono text-foreground">{formatUsd(parseFloat(pos.resolutionPayout || "0"))}</td>
                    <td className="p-3 text-right">
                      <PnlDisplay pnl={pos.pnl} pnlPercent={pos.pnlPercent} />
                    </td>
                    <td className="p-3 text-center"><StatusBadge status={pos.status} /></td>
                    <td className="p-3 text-right text-xs text-muted-foreground">
                      {pos.resolvedAt ? new Date(pos.resolvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "--"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PortfolioContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Portfolio</h1>
        <p className="text-sm text-muted-foreground mt-1">Track all positions, order history, and resolution results</p>
      </div>

      <Tabs defaultValue="positions">
        <TabsList className="bg-muted">
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="resolved">Resolved</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              <PositionsTable />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="resolved">
          <ResolvedSummary />
        </TabsContent>
        <TabsContent value="orders">
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              <OrdersTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function Portfolio() {
  return (
    <DashboardLayout>
      <PortfolioContent />
    </DashboardLayout>
  );
}
