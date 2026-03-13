import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { Loader2, ShieldAlert, AlertTriangle, Power, DollarSign, Percent, Clock, BarChart3 } from "lucide-react";
import { toast } from "sonner";

function RiskContent() {
  const { data: config, isLoading, refetch } = trpc.risk.config.useQuery(undefined, { refetchInterval: 10000 });
  const { data: categories } = trpc.risk.categoryBreakdown.useQuery(undefined, { refetchInterval: 30000 });
  const updateMutation = trpc.risk.updateConfig.useMutation({
    onSuccess: () => { toast.success("Configuration updated"); refetch(); },
    onError: (err) => toast.error(`Update failed: ${err.message}`),
  });
  const killMutation = trpc.risk.killSwitch.useMutation({
    onSuccess: (data) => {
      toast[data.killSwitch ? "error" : "success"](data.killSwitch ? "KILL SWITCH ACTIVATED" : "Kill switch deactivated");
      refetch();
    },
  });
  const botToggle = trpc.risk.toggleBot.useMutation({
    onSuccess: (data) => {
      toast.success(data.botEnabled ? "Bot enabled" : "Bot disabled");
      refetch();
    },
  });

  const [localConfig, setLocalConfig] = useState<Record<string, string>>({});

  useEffect(() => {
    if (config) {
      setLocalConfig({
        maxTotalCapital: String(config.maxTotalCapital),
        maxPerEvent: String(config.maxPerEvent),
        maxCategoryPercent: String(config.maxCategoryPercent),
        dailyBuyBudget: String(config.dailyBuyBudget),
        minPrice: String(config.minPrice),
        maxPrice: String(config.maxPrice),
        minLiquidity: String(config.minLiquidity),
        minHoursToResolution: String(config.minHoursToResolution),
        minAiScore: String(config.minAiScore),
      });
    }
  }, [config]);

  const saveField = (key: string) => {
    if (localConfig[key] !== undefined) {
      updateMutation.mutate({ key, value: localConfig[key] });
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Risk Controls</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure risk parameters and safety controls</p>
      </div>

      {/* Emergency Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className={`border-2 ${config?.killSwitch ? "border-loss bg-loss/5" : "border-border bg-card"}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${config?.killSwitch ? "bg-loss/20" : "bg-muted"}`}>
                  <AlertTriangle className={`h-6 w-6 ${config?.killSwitch ? "text-loss" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Kill Switch</h3>
                  <p className="text-xs text-muted-foreground">Emergency stop all trading</p>
                </div>
              </div>
              <Switch
                checked={config?.killSwitch || false}
                onCheckedChange={(checked) => {
                  if (!killMutation.isPending) killMutation.mutate({ enabled: checked });
                }}
                disabled={killMutation.isPending}
                className="data-[state=checked]:bg-loss"
              />
            </div>
          </CardContent>
        </Card>

        <Card className={`border-2 ${config?.botEnabled ? "border-profit bg-profit/5" : "border-border bg-card"}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${config?.botEnabled ? "bg-profit/20" : "bg-muted"}`}>
                  <Power className={`h-6 w-6 ${config?.botEnabled ? "text-profit" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground">Bot Status</h3>
                  <p className="text-xs text-muted-foreground">{config?.botEnabled ? "Actively trading" : "Paused"}</p>
                </div>
              </div>
              <Switch
                checked={config?.botEnabled || false}
                onCheckedChange={(checked) => {
                  if (!botToggle.isPending) botToggle.mutate({ enabled: checked });
                }}
                disabled={botToggle.isPending}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Capital Controls */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <DollarSign className="h-4 w-4 text-primary" />
            Capital Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Max Total Capital ($)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={localConfig.maxTotalCapital || ""}
                  onChange={(e) => setLocalConfig({ ...localConfig, maxTotalCapital: e.target.value })}
                  className="bg-input border-border font-mono"
                />
                <Button size="sm" variant="outline" onClick={() => saveField("maxTotalCapital")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Max Per Event ($)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={localConfig.maxPerEvent || ""}
                  onChange={(e) => setLocalConfig({ ...localConfig, maxPerEvent: e.target.value })}
                  className="bg-input border-border font-mono"
                />
                <Button size="sm" variant="outline" onClick={() => saveField("maxPerEvent")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Daily Buy Budget ($)</Label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={localConfig.dailyBuyBudget || ""}
                  onChange={(e) => setLocalConfig({ ...localConfig, dailyBuyBudget: e.target.value })}
                  className="bg-input border-border font-mono"
                />
                <Button size="sm" variant="outline" onClick={() => saveField("dailyBuyBudget")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter Controls */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <BarChart3 className="h-4 w-4 text-primary" />
            Scanner Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Min Price ($)</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.001" value={localConfig.minPrice || ""} onChange={(e) => setLocalConfig({ ...localConfig, minPrice: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("minPrice")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Max Price ($)</Label>
              <div className="flex gap-2">
                <Input type="number" step="0.001" value={localConfig.maxPrice || ""} onChange={(e) => setLocalConfig({ ...localConfig, maxPrice: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("maxPrice")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Min Liquidity ($)</Label>
              <div className="flex gap-2">
                <Input type="number" value={localConfig.minLiquidity || ""} onChange={(e) => setLocalConfig({ ...localConfig, minLiquidity: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("minLiquidity")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Min Hours to Resolution</Label>
              <div className="flex gap-2">
                <Input type="number" value={localConfig.minHoursToResolution || ""} onChange={(e) => setLocalConfig({ ...localConfig, minHoursToResolution: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("minHoursToResolution")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Max Category % Allocation</Label>
              <div className="flex gap-2">
                <Input type="number" value={localConfig.maxCategoryPercent || ""} onChange={(e) => setLocalConfig({ ...localConfig, maxCategoryPercent: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("maxCategoryPercent")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground uppercase tracking-wider">Min AI Score (1-10)</Label>
              <div className="flex gap-2">
                <Input type="number" min="1" max="10" value={localConfig.minAiScore || ""} onChange={(e) => setLocalConfig({ ...localConfig, minAiScore: e.target.value })} className="bg-input border-border font-mono" />
                <Button size="sm" variant="outline" onClick={() => saveField("minAiScore")} disabled={updateMutation.isPending}>Save</Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category Breakdown */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Percent className="h-4 w-4 text-primary" />
            Category Diversification
          </CardTitle>
          <CardDescription>Max {config?.maxCategoryPercent || 30}% in any single category</CardDescription>
        </CardHeader>
        <CardContent>
          {!categories || categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No positions to show category breakdown.</p>
          ) : (
            <div className="space-y-3">
              {categories.map((cat) => (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground capitalize">{cat.category}</span>
                      <Badge variant="secondary" className="text-xs">{cat.count} positions</Badge>
                    </div>
                    <span className={`text-xs font-mono ${cat.percentage > cat.limit ? "text-loss" : "text-muted-foreground"}`}>
                      {cat.percentage.toFixed(1)}% / {cat.limit}%
                    </span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${cat.percentage > cat.limit ? "bg-loss" : "bg-primary"}`}
                      style={{ width: `${Math.min((cat.percentage / cat.limit) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Wallet Status */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <ShieldAlert className="h-4 w-4 text-primary" />
            Trading Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Wallet</p>
              <Badge variant={config?.walletConfigured ? "default" : "secondary"}>
                {config?.walletConfigured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CLOB API</p>
              <Badge variant={config?.clobApiKey ? "default" : "secondary"}>
                {config?.clobApiKey ? "Configured" : "Not Set"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Bot</p>
              <Badge variant={config?.botEnabled ? "default" : "secondary"}>
                {config?.botEnabled ? "Running" : "Stopped"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Kill Switch</p>
              <Badge variant={config?.killSwitch ? "destructive" : "secondary"}>
                {config?.killSwitch ? "ACTIVE" : "Off"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Risk() {
  return (
    <DashboardLayout>
      <RiskContent />
    </DashboardLayout>
  );
}
