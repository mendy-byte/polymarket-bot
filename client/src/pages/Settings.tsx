import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Loader2, Wallet, Key, Shield, Zap, AlertTriangle, CheckCircle2, XCircle, Radio, Power } from "lucide-react";
import { toast } from "sonner";

function SettingsContent() {
  const utils = trpc.useUtils();
  const { data: walletStatus, isLoading, refetch } = trpc.wallet.status.useQuery();
  const configureMutation = trpc.wallet.configure.useMutation({
    onSuccess: () => {
      toast.success("Wallet configuration saved");
      refetch();
      setPrivateKey("");
      setWalletAddress("");
    },
    onError: (err) => toast.error(`Configuration failed: ${err.message}`),
  });

  const deriveMutation = trpc.wallet.deriveCreds.useMutation({
    onSuccess: (data) => {
      toast.success("CLOB credentials derived successfully! Trading is now live.");
      refetch();
    },
    onError: (err) => toast.error(`Credential derivation failed: ${err.message}`),
  });

  const disconnectMutation = trpc.wallet.disconnect.useMutation({
    onSuccess: () => {
      toast.success("CLOB client disconnected");
      refetch();
    },
  });

  const cancelAllMutation = trpc.wallet.cancelAll.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("All open orders cancelled");
      } else {
        toast.error("Failed to cancel orders");
      }
    },
  });

  const [privateKey, setPrivateKey] = useState("");
  const [walletAddress, setWalletAddress] = useState("");

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  const isWalletConfigured = walletStatus?.configured;
  const isClobLive = walletStatus?.clobInitialized;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure wallet and CLOB trading credentials</p>
      </div>

      {/* Connection Status Overview */}
      <Card className="bg-card border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Radio className="h-4 w-4 text-primary" />
            Connection Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Wallet</p>
              <Badge variant={isWalletConfigured ? "default" : "secondary"} className="gap-1">
                {isWalletConfigured ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {isWalletConfigured ? "Connected" : "Not Set"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Address</p>
              <p className="text-xs font-mono text-foreground truncate">
                {walletStatus?.address
                  ? `${walletStatus.address.slice(0, 6)}...${walletStatus.address.slice(-4)}`
                  : "—"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CLOB API</p>
              <Badge variant={walletStatus?.clobApiKey ? "default" : "secondary"} className="gap-1">
                {walletStatus?.clobApiKey ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {walletStatus?.clobApiKey || "Not Set"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CLOB Client</p>
              <Badge variant={isClobLive ? "default" : "secondary"} className="gap-1">
                {isClobLive ? <Zap className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                {isClobLive ? "Live" : "Offline"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Heartbeat</p>
              <Badge variant={walletStatus?.heartbeatActive ? "default" : "secondary"} className="gap-1">
                {walletStatus?.heartbeatActive
                  ? <><span className="h-2 w-2 rounded-full bg-green-400 animate-pulse" /> Active</>
                  : "Inactive"}
              </Badge>
            </div>
          </div>

          {walletStatus?.clobError && (
            <div className="mt-3 p-2 rounded bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive font-mono">{walletStatus.clobError}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      {isWalletConfigured && (
        <div className="flex flex-wrap gap-3">
          {!isClobLive ? (
            <Button
              onClick={() => deriveMutation.mutate()}
              disabled={deriveMutation.isPending}
              className="gap-2"
            >
              {deriveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Initialize CLOB & Derive Credentials
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} className="gap-2">
                <Power className="h-4 w-4" />
                Disconnect CLOB
              </Button>
              <Button variant="outline" onClick={() => cancelAllMutation.mutate()} disabled={cancelAllMutation.isPending} className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10">
                <XCircle className="h-4 w-4" />
                Cancel All Orders
              </Button>
            </>
          )}
        </div>
      )}

      {/* Security Warning */}
      <Card className="bg-warning/5 border-warning/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-foreground">Security Notice</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Your private key is used server-side to sign CLOB orders. It never leaves this server.
                Use a dedicated trading wallet with limited funds. Never use your main wallet.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Wallet Configuration */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Key className="h-4 w-4 text-primary" />
            Polygon Wallet
          </CardTitle>
          <CardDescription>
            Enter your MetaMask private key. CLOB API credentials will be derived automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Wallet Address</Label>
            <Input
              placeholder="0x... (auto-derived from private key if left blank)"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="bg-input border-border font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Private Key</Label>
            <Input
              type="password"
              placeholder="Enter your MetaMask private key"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              className="bg-input border-border font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              MetaMask → Three dots → Account Details → Show Private Key
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => {
                if (!privateKey) {
                  toast.error("Private key is required");
                  return;
                }
                const updates: Record<string, string> = { privateKey };
                if (walletAddress) updates.walletAddress = walletAddress;
                configureMutation.mutate(updates);
              }}
              disabled={configureMutation.isPending || !privateKey}
            >
              {configureMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Wallet
            </Button>
            {privateKey && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (!privateKey) return;
                  const updates: Record<string, string> = { privateKey };
                  if (walletAddress) updates.walletAddress = walletAddress;
                  configureMutation.mutate(updates, {
                    onSuccess: () => {
                      // After saving, immediately derive CLOB creds
                      deriveMutation.mutate();
                    },
                  });
                }}
                disabled={configureMutation.isPending || deriveMutation.isPending}
                className="gap-2"
              >
                {(configureMutation.isPending || deriveMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                <Zap className="h-4 w-4" />
                Save & Connect CLOB
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Setup Guide */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">Quick Setup Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${isWalletConfigured ? "bg-green-500/20 text-green-400" : "bg-primary/20 text-primary"}`}>
                {isWalletConfigured ? "✓" : "1"}
              </span>
              <div>
                <p className="text-foreground font-medium">Paste your MetaMask private key above</p>
                <p className="text-xs mt-1">MetaMask → ⋮ → Account Details → Show Private Key</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium shrink-0 ${walletStatus?.clobApiKey ? "bg-green-500/20 text-green-400" : "bg-primary/20 text-primary"}`}>
                {walletStatus?.clobApiKey ? "✓" : "2"}
              </span>
              <div>
                <p className="text-foreground font-medium">Click "Save & Connect CLOB" or "Initialize CLOB"</p>
                <p className="text-xs mt-1">This derives your CLOB API credentials automatically from your wallet. No Python scripts needed.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">3</span>
              <div>
                <p className="text-foreground font-medium">Fund wallet with USDC.e + POL on Polygon</p>
                <p className="text-xs mt-1">
                  USDC.e (bridged) for trading capital. ~$2 of POL for gas fees. Send to your wallet address shown above.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">4</span>
              <div>
                <p className="text-foreground font-medium">Enable bot in Risk Controls → Start Autopilot</p>
                <p className="text-xs mt-1">The bot will automatically scan, evaluate, and place orders on cheap events.</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Token Info */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            Required Tokens
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium text-foreground">USDC.e (Bridged USDC)</p>
                <p className="text-xs text-muted-foreground font-mono">0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174</p>
              </div>
              <Badge>Trading Capital</Badge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
              <div>
                <p className="text-sm font-medium text-foreground">POL (Polygon Gas Token)</p>
                <p className="text-xs text-muted-foreground">~$2 worth for thousands of transactions</p>
              </div>
              <Badge variant="secondary">Gas Fees</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  return (
    <DashboardLayout>
      <SettingsContent />
    </DashboardLayout>
  );
}
