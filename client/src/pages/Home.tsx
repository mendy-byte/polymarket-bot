import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  ShieldAlert,
  BarChart3,
  Activity,
  Clock,
  Loader2,
  AlertTriangle,
  Bot,
} from "lucide-react";

function formatUsd(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function formatPercent(val: number): string {
  return `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;
}

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  trend?: "up" | "down" | "neutral";
}) {
  return (
    <Card className="bg-card border-border">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {title}
            </p>
            <p
              className={`text-2xl font-semibold font-mono ${
                trend === "up"
                  ? "text-profit"
                  : trend === "down"
                  ? "text-loss"
                  : "text-foreground"
              }`}
            >
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <div
            className={`h-9 w-9 rounded-lg flex items-center justify-center ${
              trend === "up"
                ? "bg-profit/10"
                : trend === "down"
                ? "bg-loss/10"
                : "bg-primary/10"
            }`}
          >
            <Icon
              className={`h-4 w-4 ${
                trend === "up"
                  ? "text-profit"
                  : trend === "down"
                  ? "text-loss"
                  : "text-primary"
              }`}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewContent() {
  const { data: stats, isLoading } = trpc.dashboard.stats.useQuery(undefined, {
    refetchInterval: 15000,
  });
  const { data: logs } = trpc.dashboard.recentLogs.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: autopilotStatus } = trpc.autopilot.status.useQuery(undefined, {
    refetchInterval: 10000,
  });
  const { data: fillStats } = trpc.dashboard.fillStats.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const killSwitchMutation = trpc.risk.killSwitch.useMutation({
    onSuccess: () => {
      window.location.reload();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const s = {
    totalCapitalDeployed: stats?.totalCapitalDeployed ?? 0,
    totalPositions: stats?.totalPositions ?? 0,
    openPositions: stats?.openPositions ?? 0,
    resolvedWins: stats?.resolvedWins ?? 0,
    resolvedLosses: stats?.resolvedLosses ?? 0,
    totalPnl: stats?.totalPnl ?? 0,
    totalPnlPercent: stats?.totalPnlPercent ?? 0,
    unrealizedPnl: stats?.unrealizedPnl ?? 0,
    bestWin: stats?.bestWin ?? 0,
    worstLoss: stats?.worstLoss ?? 0,
    winRate: stats?.winRate ?? 0,
    expectedValue: stats?.expectedValue ?? 0,
    categoriesUsed: stats?.categoriesUsed ?? 0,
    dailySpent: stats?.dailySpent ?? 0,
    remainingBudget: stats?.remainingBudget ?? 0,
    maxCapital: stats?.maxCapital ?? 1200,
    killSwitch: stats?.killSwitch ?? false,
    botEnabled: stats?.botEnabled ?? false,
    categoryBreakdown: (stats as any)?.categoryBreakdown ?? [],
  };

  const drawdownPercent = Math.abs(s.totalPnlPercent);
  const drawdownMax = 40; // maxDrawdownPercent
  const drawdownRatio = Math.min(drawdownPercent / drawdownMax, 1);
  const isDrawdownDanger = drawdownPercent >= 30;
  const isDrawdownCritical = drawdownPercent >= 35;

  return (
    <div className="space-y-6">
      {/* Risk Gauge */}
      <Card className={`border-2 ${
        isDrawdownCritical ? "border-red-500 bg-red-500/10" :
        isDrawdownDanger ? "border-orange-500 bg-orange-500/10" :
        "border-border bg-card"
      }`}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                isDrawdownCritical ? "bg-red-500/20" :
                isDrawdownDanger ? "bg-orange-500/20" :
                "bg-muted"
              }`}>
                <ShieldAlert className={`h-6 w-6 ${
                  isDrawdownCritical ? "text-red-500" :
                  isDrawdownDanger ? "text-orange-500" :
                  "text-muted-foreground"
                }`} />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Drawdown Risk</p>
                <p className={`text-3xl font-bold font-mono ${
                  isDrawdownCritical ? "text-red-500" :
                  isDrawdownDanger ? "text-orange-500" :
                  s.totalPnlPercent < 0 ? "text-loss" : "text-profit"
                }`}>
                  {formatPercent(s.totalPnlPercent)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Auto-pause at -{drawdownMax}% | {formatUsd(s.totalCapitalDeployed)} deployed
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={s.killSwitch || killSwitchMutation.isPending}
                onClick={() => killSwitchMutation.mutate({ enabled: true })}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                {s.killSwitch ? "BOT PAUSED" : "PAUSE BOT"}
              </Button>
              {s.killSwitch && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  disabled={killSwitchMutation.isPending}
                  onClick={() => killSwitchMutation.mutate({ enabled: false })}
                >
                  Resume Bot
                </Button>
              )}
            </div>
          </div>
          {/* Drawdown progress bar */}
          <div className="mt-3 h-2.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isDrawdownCritical ? "bg-red-500" :
                isDrawdownDanger ? "bg-orange-500" :
                drawdownPercent > 15 ? "bg-yellow-500" :
                "bg-green-500"
              }`}
              style={{ width: `${drawdownRatio * 100}%` }}
            />
          </div>
          <div className="flex justify-between mt-1 text-[10px] text-muted-foreground font-mono">
            <span>0%</span>
            <span>-10%</span>
            <span>-20%</span>
            <span>-30%</span>
            <span className="text-red-500 font-bold">-40% STOP</span>
          </div>
        </CardContent>
      </Card>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tail-risk prediction market bot overview
          </p>
        </div>
        <div className="flex items-center gap-3">
          {s.killSwitch && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Kill Switch Active
            </Badge>
          )}
          {autopilotStatus?.isRunning && (
            <Badge variant="default" className="gap-1 bg-profit text-white">
              <Bot className="h-3 w-3" />
              Autopilot Active
            </Badge>
          )}
          <Badge
            variant={s.botEnabled ? "default" : "secondary"}
            className="gap-1"
          >
            <Activity className="h-3 w-3" />
            {s.botEnabled ? "Bot Enabled" : "Bot Disabled"}
          </Badge>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Capital Deployed"
          value={formatUsd(s.totalCapitalDeployed)}
          subtitle={`of ${formatUsd(s.maxCapital)} max`}
          icon={DollarSign}
        />
        <StatCard
          title="Total P&L"
          value={formatUsd(s.totalPnl)}
          subtitle={formatPercent(s.totalPnlPercent)}
          icon={s.totalPnl >= 0 ? TrendingUp : TrendingDown}
          trend={s.totalPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          title="Open Positions"
          value={String(s.openPositions)}
          subtitle={`${s.totalPositions} total`}
          icon={Target}
        />
        <StatCard
          title="Win Rate"
          value={`${s.winRate.toFixed(0)}%`}
          subtitle={`${s.resolvedWins}W / ${s.resolvedLosses}L`}
          icon={BarChart3}
          trend={s.winRate > 0 ? "up" : "neutral"}
        />
      </div>

      {/* Secondary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Unrealized P&L"
          value={formatUsd(s.unrealizedPnl)}
          icon={Activity}
          trend={s.unrealizedPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          title="Best Win"
          value={formatUsd(s.bestWin)}
          icon={Zap}
          trend="up"
        />
        <StatCard
          title="Daily Budget Left"
          value={formatUsd(s.remainingBudget)}
          subtitle={`${formatUsd(s.dailySpent)} spent today`}
          icon={Clock}
        />
        <StatCard
          title="Categories"
          value={String(s.categoriesUsed)}
          subtitle="diversification"
          icon={ShieldAlert}
        />
      </div>

      {/* Expected Value Calculator */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-foreground">
            Expected Value Model
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Avg Entry Price
              </p>
              <p className="text-lg font-mono text-foreground">
                {s.totalPositions > 0
                  ? `$${(s.totalCapitalDeployed / s.totalPositions / (s.totalCapitalDeployed / s.totalPositions / 0.02)).toFixed(3)}`
                  : "$0.020"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Payoff per Winner
              </p>
              <p className="text-lg font-mono text-profit">
                ~{formatUsd(s.totalPositions > 0 ? s.totalCapitalDeployed / s.totalPositions / 0.02 : 250)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Break-even Wins
              </p>
              <p className="text-lg font-mono text-warning">
                {s.totalPositions > 0
                  ? Math.ceil(s.totalCapitalDeployed / (s.totalCapitalDeployed / s.totalPositions / 0.02))
                  : "4"}{" "}
                of {s.totalPositions || 200}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                Required Hit Rate
              </p>
              <p className="text-lg font-mono text-foreground">
                {s.totalPositions > 0
                  ? `${((Math.ceil(s.totalCapitalDeployed / (s.totalCapitalDeployed / s.totalPositions / 0.02)) / s.totalPositions) * 100).toFixed(1)}%`
                  : "2.0%"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Order Fill Rate */}
      {fillStats && fillStats.total > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-foreground">
              Order Fill Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Orders</p>
                <p className="text-lg font-mono text-foreground">{fillStats.total}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Filled</p>
                <p className="text-lg font-mono text-profit">{fillStats.filled}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Pending/Placed</p>
                <p className="text-lg font-mono text-warning">{fillStats.pending + fillStats.placed}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Partial</p>
                <p className="text-lg font-mono text-primary">{fillStats.partial}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Cancelled</p>
                <p className="text-lg font-mono text-muted-foreground">{fillStats.cancelled}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Fill Rate</p>
                <p className={`text-lg font-mono ${fillStats.filled / fillStats.total > 0.5 ? "text-profit" : "text-warning"}`}>
                  {((fillStats.filled / fillStats.total) * 100).toFixed(0)}%
                </p>
              </div>
            </div>
            {/* Fill rate bar */}
            <div className="mt-4 h-3 bg-muted rounded-full overflow-hidden flex">
              <div className="bg-profit h-full transition-all" style={{ width: `${(fillStats.filled / fillStats.total) * 100}%` }} />
              <div className="bg-primary h-full transition-all" style={{ width: `${(fillStats.partial / fillStats.total) * 100}%` }} />
              <div className="bg-warning h-full transition-all" style={{ width: `${((fillStats.pending + fillStats.placed) / fillStats.total) * 100}%` }} />
              <div className="bg-muted-foreground/30 h-full transition-all" style={{ width: `${((fillStats.cancelled + fillStats.failed) / fillStats.total) * 100}%` }} />
            </div>
            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-profit" />Filled</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-primary" />Partial</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" />Pending</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/30" />Cancelled/Failed</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown + Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-foreground">
              Category Allocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(s.categoryBreakdown || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No positions yet. Run the scanner and place orders to see category breakdown.
              </p>
            ) : (
              <div className="space-y-3">
                {(s.categoryBreakdown || []).map((cat: any) => (
                  <div key={cat.category}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-foreground capitalize">
                        {cat.category}
                      </span>
                      <span className="text-xs font-mono text-muted-foreground">
                        {cat.percentage.toFixed(1)}% / 15% max
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          cat.percentage > 15 ? "bg-loss" : cat.percentage > 10 ? "bg-warning" : "bg-primary"
                        }`}
                        style={{ width: `${Math.min(cat.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-foreground">
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!logs || logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No activity yet. Start by running the event scanner.
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {logs.slice(0, 10).map((log: any) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0"
                  >
                    <div
                      className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                        log.action === "scan"
                          ? "bg-primary"
                          : log.action === "evaluate"
                          ? "bg-warning"
                          : log.action === "kill_switch"
                          ? "bg-loss"
                          : "bg-muted-foreground"
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">
                        {log.details || log.action}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(log.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <DashboardLayout>
      <OverviewContent />
    </DashboardLayout>
  );
}
