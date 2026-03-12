import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Loader2, Activity } from "lucide-react";

function LogsContent() {
  const { data: logs, isLoading } = trpc.dashboard.recentLogs.useQuery(undefined, { refetchInterval: 10000 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Activity Log</h1>
        <p className="text-sm text-muted-foreground mt-1">Recent bot activity and system events</p>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
              <Activity className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No activity logged yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Time</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Action</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Details</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Scanned</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Found</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">New</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => {
                    const actionColors: Record<string, string> = {
                      scan: "bg-primary/20 text-primary border-primary/30",
                      evaluate: "bg-warning/20 text-warning border-warning/30",
                      kill_switch: "bg-loss/20 text-loss border-loss/30",
                      bot_toggle: "bg-profit/20 text-profit border-profit/30",
                      wallet_config: "bg-primary/20 text-primary border-primary/30",
                    };
                    return (
                      <tr key={log.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
                        <td className="p-3">
                          <Badge className={`${actionColors[log.action] || "bg-muted text-muted-foreground"} text-xs`}>
                            {log.action}
                          </Badge>
                        </td>
                        <td className="p-3 text-foreground max-w-md truncate">{log.details || "--"}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{log.marketsScanned || "--"}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{log.cheapFound || "--"}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{log.newDiscovered || "--"}</td>
                        <td className="p-3 text-right font-mono text-muted-foreground">{log.duration ? `${(log.duration / 1000).toFixed(1)}s` : "--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Logs() {
  return (
    <DashboardLayout>
      <LogsContent />
    </DashboardLayout>
  );
}
