import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Loader2, Wallet, Key, Shield, ExternalLink, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

function SettingsContent() {
  const { data: walletStatus, isLoading, refetch } = trpc.wallet.status.useQuery();
  const configureMutation = trpc.wallet.configure.useMutation({
    onSuccess: () => {
      toast.success("Wallet configuration saved");
      refetch();
      setPrivateKey("");
      setClobKey("");
      setClobSecret("");
      setClobPassphrase("");
    },
    onError: (err) => toast.error(`Configuration failed: ${err.message}`),
  });

  const [privateKey, setPrivateKey] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [clobKey, setClobKey] = useState("");
  const [clobSecret, setClobSecret] = useState("");
  const [clobPassphrase, setClobPassphrase] = useState("");

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure wallet and API credentials for CLOB trading</p>
      </div>

      {/* Wallet Status */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Wallet className="h-4 w-4 text-primary" />
            Wallet Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Wallet</p>
              <Badge variant={walletStatus?.configured ? "default" : "secondary"}>
                {walletStatus?.configured ? "Connected" : "Not Configured"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Address</p>
              <p className="text-sm font-mono text-foreground truncate">{walletStatus?.address || "Not set"}</p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CLOB API Key</p>
              <Badge variant={walletStatus?.clobApiKey ? "default" : "secondary"}>
                {walletStatus?.clobApiKey || "Not Set"}
              </Badge>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">CLOB Secret</p>
              <Badge variant={walletStatus?.clobApiSecret ? "default" : "secondary"}>
                {walletStatus?.clobApiSecret || "Not Set"}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Warning */}
      <Card className="bg-warning/5 border-warning/30">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-foreground">Security Notice</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Your private key and API credentials are stored encrypted in the database. Never share these with anyone.
                For production use, consider using a dedicated trading wallet with limited funds.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Polygon Wallet */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Key className="h-4 w-4 text-primary" />
            Polygon Wallet
          </CardTitle>
          <CardDescription>
            Required for CLOB trading. Your wallet needs USDC on Polygon network.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Wallet Address</Label>
            <Input
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              className="bg-input border-border font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Private Key</Label>
            <Input
              type="password"
              placeholder="Enter your Polygon wallet private key"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              className="bg-input border-border font-mono"
            />
            <p className="text-xs text-muted-foreground">Used to sign CLOB orders. Never leaves this server.</p>
          </div>
        </CardContent>
      </Card>

      {/* CLOB API Credentials */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium flex items-center gap-2 text-foreground">
            <Shield className="h-4 w-4 text-primary" />
            CLOB API Credentials
          </CardTitle>
          <CardDescription>
            Generate API credentials from the{" "}
            <a href="https://docs.polymarket.com/#create-api-key" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
              Polymarket CLOB docs <ExternalLink className="h-3 w-3" />
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">API Key</Label>
            <Input
              type="password"
              placeholder="CLOB API Key"
              value={clobKey}
              onChange={(e) => setClobKey(e.target.value)}
              className="bg-input border-border font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">API Secret</Label>
            <Input
              type="password"
              placeholder="CLOB API Secret"
              value={clobSecret}
              onChange={(e) => setClobSecret(e.target.value)}
              className="bg-input border-border font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground uppercase tracking-wider">Passphrase</Label>
            <Input
              type="password"
              placeholder="CLOB API Passphrase"
              value={clobPassphrase}
              onChange={(e) => setClobPassphrase(e.target.value)}
              className="bg-input border-border font-mono"
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={() => {
            const updates: Record<string, string> = {};
            if (privateKey) updates.privateKey = privateKey;
            if (walletAddress) updates.walletAddress = walletAddress;
            if (clobKey) updates.clobApiKey = clobKey;
            if (clobSecret) updates.clobApiSecret = clobSecret;
            if (clobPassphrase) updates.clobPassphrase = clobPassphrase;
            if (Object.keys(updates).length === 0) {
              toast.error("No changes to save");
              return;
            }
            configureMutation.mutate(updates);
          }}
          disabled={configureMutation.isPending}
          size="lg"
        >
          {configureMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          Save Configuration
        </Button>
      </div>

      {/* Setup Guide */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-base font-medium text-foreground">Setup Guide</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">1</span>
              <div>
                <p className="text-foreground font-medium">Create a Polygon wallet</p>
                <p className="text-xs mt-1">Use MetaMask or any Ethereum-compatible wallet. Export the private key.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">2</span>
              <div>
                <p className="text-foreground font-medium">Fund with USDC on Polygon</p>
                <p className="text-xs mt-1">Bridge USDC to Polygon network. Start with $100-200 for testing.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">3</span>
              <div>
                <p className="text-foreground font-medium">Generate CLOB API credentials</p>
                <p className="text-xs mt-1">
                  Use the py-clob-client to derive API credentials from your wallet.{" "}
                  <a href="https://github.com/Polymarket/py-clob-client" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    See documentation
                  </a>
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">4</span>
              <div>
                <p className="text-foreground font-medium">Approve USDC for Polymarket CTF Exchange</p>
                <p className="text-xs mt-1">The CLOB requires token approval before placing orders.</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-6 w-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-medium shrink-0">5</span>
              <div>
                <p className="text-foreground font-medium">Enable bot and start scanning</p>
                <p className="text-xs mt-1">Go to Risk Controls, enable the bot, then use the Event Scanner to find and buy cheap outcomes.</p>
              </div>
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
