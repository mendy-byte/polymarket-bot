import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { useState, useMemo } from "react";
import {
  Bot,
  Play,
  Square,
  RotateCw,
  Clock,
  Zap,
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Loader2,
  Settings2,
  Radar,
  DollarSign,
  BarChart3,
} from "lucide-react";

function formatUsd(val: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTimeUntil(isoString: string): string {
  const diff = new Date(isoString).getTime() - Date.now();
  if (diff <= 0) return "now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `in ${hours}h ${minutes % 60}m`;
}

function BetSizingTable() {
  const rows = [
    { score: "5-6", size: "$5", label: "Low confidence", color: "text-muted-foreground" },
    { score: "7", size: "$8", label: "Moderate", color: "text-foreground" },
    { score: "8", size: "$12", label: "Good signal", color: "text-primary" },
    { score: "9", size: "$18", label: "Strong signal", color: "text-profit" },
    { score: "10", size: "$25", label: "High conviction", color: "text-profit font-semibold" },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          Smart Bet Sizing
        </CardTitle>
        <CardDescription>
          Bet size scales with AI confidence score ($5-$25 per event)
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.score} className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-0">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="font-mono text-xs w-12 justify-center">
                  {row.score}
                </Badge>
                <span className="text-sm text-muted-foreground">{row.label}</span>
              </div>
              <span className={`font-mono text-sm ${row.color}`}>{row.size}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AutopilotContent() {
  const utils = trpc.useUtils();
  const { data: status, isLoading } = trpc.autopilot.status.useQuery(undefined, {
    refetchInterval: 5000,
  });
  const { data: riskConfig } = trpc.risk.config.useQuery();
  const { data: dashStats } = trpc.dashboard.stats.useQuery();

  const startMutation = trpc.autopilot.start.useMutation({
    onSuccess: () => {
      toast.success("Autopilot started");
      utils.autopilot.status.invalidate();
      utils.dashboard.recentLogs.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const stopMutation = trpc.autopilot.stop.useMutation({
    onSuccess: () => {
      toast.success("Autopilot stopped");
      utils.autopilot.status.invalidate();
      utils.dashboard.recentLogs.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const runOnceMutation = trpc.autopilot.runOnce.useMutation({
    onSuccess: (data) => {
      toast.success(`Cycle complete: ${data.ordersPlaced} orders placed, $${data.totalSpent.toFixed(2)} spent`);
      utils.autopilot.status.invalidate();
      utils.dashboard.stats.invalidate();
      utils.dashboard.recentLogs.invalidate();
      utils.portfolio.positions.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const updateConfigMutation = trpc.autopilot.updateConfig.useMutation({
    onSuccess: () => {
      toast.success("Autopilot config updated");
      utils.autopilot.status.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [intervalHours, setIntervalHours] = useState<number>(4);
  const [maxOrders, setMaxOrders] = useState<number>(50);
  const [scanPages, setScanPages] = useState<number>(30);

  // Sync from server
  useMemo(() => {
    if (status) {
      setIntervalHours(status.intervalHours || 4);
      setMaxOrders(status.maxOrdersPerCycle || 50);
      setScanPages(status.scanPages || 30);
    }
  }, [status?.intervalHours, status?.maxOrdersPerCycle, status?.scanPages]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isActive = status?.isRunning || false;
  const autopilotEnabled = status?.autopilotEnabled || false;
  const lastStats = status?.lastRunStats;
  const botEnabled = riskConfig?.botEnabled || false;
  const killSwitch = riskConfig?.killSwitch || false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Autopilot
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Autonomous scan → evaluate → buy loop
          </p>
        </div>
        <div className="flex items-center gap-3">
          {killSwitch && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              Kill Switch
            </Badge>
          )}
          <Badge
            variant={isActive ? "default" : "secondary"}
            className={`gap-1 ${isActive ? "bg-profit text-profit-foreground" : ""}`}
          >
            <Bot className="h-3 w-3" />
            {isActive ? "Running" : "Stopped"}
          </Badge>
        </div>
      </div>

      {/* Prerequisite warnings */}
      {!botEnabled && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="p-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Bot is disabled</p>
              <p className="text-xs text-muted-foreground">
                Enable the bot in Risk Controls before starting autopilot.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Controls */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            Autopilot Controls
          </CardTitle>
          <CardDescription>
            Start the autonomous loop to continuously scan, evaluate, and buy cheap events.
            Each cycle: scans markets → AI evaluates → places orders → checks resolutions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            {!isActive ? (
              <Button
                onClick={() => startMutation.mutate({ intervalHours })}
                disabled={startMutation.isPending || !botEnabled || killSwitch}
                className="bg-profit hover:bg-profit/90 text-white gap-2"
              >
                {startMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Start Autopilot
              </Button>
            ) : (
              <Button
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                variant="destructive"
                className="gap-2"
              >
                {stopMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Stop Autopilot
              </Button>
            )}

            <Button
              onClick={() => runOnceMutation.mutate()}
              disabled={runOnceMutation.isPending || !botEnabled || killSwitch}
              variant="outline"
              className="gap-2"
            >
              {runOnceMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Run Single Cycle
            </Button>
          </div>

          {/* Timing Info */}
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Last Run</p>
              <p className="text-sm font-mono text-foreground">
                {status?.lastRunAt ? formatTimeAgo(status.lastRunAt) : "Never"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Next Run</p>
              <p className="text-sm font-mono text-foreground">
                {isActive && status?.nextRunAt ? formatTimeUntil(status.nextRunAt) : "—"}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Interval</p>
              <p className="text-sm font-mono text-foreground">
                Every {status?.intervalHours || 4}h
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Last Cycle Results */}
      {lastStats && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              Last Cycle Results
            </CardTitle>
            <CardDescription>
              {new Date(lastStats.startedAt).toLocaleString()} — Duration: {formatDuration(new Date(lastStats.completedAt).getTime() - new Date(lastStats.startedAt).getTime())}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <Radar className="h-3.5 w-3.5 text-primary" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Scanned</p>
                </div>
                <p className="text-lg font-mono text-foreground">{lastStats.cheapFound}</p>
                <p className="text-xs text-muted-foreground">{lastStats.newDiscovered} new</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <Zap className="h-3.5 w-3.5 text-warning" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">AI Evaluated</p>
                </div>
                <p className="text-lg font-mono text-foreground">{lastStats.aiEvaluated}</p>
                <p className="text-xs text-muted-foreground">{lastStats.approved} approved</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-3.5 w-3.5 text-profit" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Orders</p>
                </div>
                <p className="text-lg font-mono text-foreground">{lastStats.ordersPlaced}</p>
                <p className="text-xs text-muted-foreground">{formatUsd(lastStats.totalSpent)} spent</p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30 border border-border/50">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">Resolutions</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-mono text-profit">{lastStats.wins}W</span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-lg font-mono text-loss">{lastStats.losses}L</span>
                </div>
                <p className="text-xs text-muted-foreground">{lastStats.resolutionsChecked} checked</p>
              </div>
            </div>

            {/* Errors */}
            {lastStats.errors && lastStats.errors.length > 0 && (
              <div className="mt-4 p-3 rounded-lg bg-loss/5 border border-loss/20">
                <p className="text-xs font-medium text-loss uppercase tracking-wider mb-2">Errors</p>
                <div className="space-y-1">
                  {lastStats.errors.map((err: string, i: number) => (
                    <p key={i} className="text-xs text-muted-foreground font-mono">{err}</p>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Configuration */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-primary" />
              Cycle Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Interval */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-foreground">Scan Interval</label>
                <span className="text-sm font-mono text-primary">{intervalHours}h</span>
              </div>
              <Slider
                value={[intervalHours]}
                onValueChange={([v]) => setIntervalHours(v)}
                min={1}
                max={24}
                step={1}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                How often the autopilot runs a full cycle
              </p>
            </div>

            {/* Max Orders */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-foreground">Max Orders per Cycle</label>
                <span className="text-sm font-mono text-primary">{maxOrders}</span>
              </div>
              <Slider
                value={[maxOrders]}
                onValueChange={([v]) => setMaxOrders(v)}
                min={5}
                max={200}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Maximum number of new positions per cycle
              </p>
            </div>

            {/* Scan Pages */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm text-foreground">Scan Depth (pages)</label>
                <span className="text-sm font-mono text-primary">{scanPages}</span>
              </div>
              <Slider
                value={[scanPages]}
                onValueChange={([v]) => setScanPages(v)}
                min={5}
                max={100}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Pages to scan per cycle (100 markets/page)
              </p>
            </div>

            <Button
              onClick={() =>
                updateConfigMutation.mutate({
                  intervalHours,
                  maxOrdersPerCycle: maxOrders,
                  scanPages,
                })
              }
              disabled={updateConfigMutation.isPending}
              variant="outline"
              className="w-full"
            >
              {updateConfigMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Save Configuration
            </Button>
          </CardContent>
        </Card>

        {/* Smart Bet Sizing */}
        <BetSizingTable />
      </div>

      {/* How It Works */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium text-foreground">
            How Autopilot Works
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
            {[
              { step: "1", title: "Scan", desc: "Fetch cheap outcomes from Polymarket", icon: Radar },
              { step: "2", title: "Filter", desc: "Remove duplicates, low liquidity, expiring", icon: Target },
              { step: "3", title: "AI Evaluate", desc: "LLM scores each event 1-10", icon: Zap },
              { step: "4", title: "Size Bets", desc: "$5-$25 based on AI confidence", icon: DollarSign },
              { step: "5", title: "Place Orders", desc: "Bulk buy with category limits", icon: CheckCircle },
              { step: "6", title: "Track", desc: "Check resolutions, update P&L", icon: TrendingUp },
            ].map((item) => (
              <div key={item.step} className="p-3 rounded-lg bg-muted/20 border border-border/30 text-center">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                  <item.icon className="h-4 w-4 text-primary" />
                </div>
                <p className="text-xs font-medium text-foreground mb-0.5">{item.title}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{item.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Autopilot() {
  return (
    <DashboardLayout>
      <AutopilotContent />
    </DashboardLayout>
  );
}
