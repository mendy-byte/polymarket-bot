import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { Loader2, Briefcase, FileText } from "lucide-react";

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
              <td className="p-3 text-center"><StatusBadge status={pos.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
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

function PortfolioContent() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Portfolio</h1>
        <p className="text-sm text-muted-foreground mt-1">Track all positions and order history</p>
      </div>

      <Tabs defaultValue="positions">
        <TabsList className="bg-muted">
          <TabsTrigger value="positions">Positions</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
        </TabsList>
        <TabsContent value="positions">
          <Card className="bg-card border-border">
            <CardContent className="p-0">
              <PositionsTable />
            </CardContent>
          </Card>
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
