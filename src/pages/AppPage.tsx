/**
 * App Page — authenticated dashboard with all features
 * Separate from landing page for clean UX
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Dashboard from '@/components/Dashboard';
import StakingDashboard from '@/components/StakingDashboard';
import TokenomicsSection from '@/components/TokenomicsSection';
import PrivacySection from '@/components/PrivacySection';
import NetworkSection from '@/components/NetworkSection';
import Explorer from '@/components/Explorer';
import Mempool from '@/components/Mempool';
import GovernanceSection from '@/components/GovernanceSection';
import SmartContractsExplorer from '@/components/SmartContractsExplorer';
import WalletSection from '@/components/WalletSection';
import SwapPanel from '@/components/SwapPanel';
import LiquidityPoolPanel from '@/components/LiquidityPoolPanel';
import MerchantPanel from '@/components/MerchantPanel';
import MiningDashboard from '@/components/MiningDashboard';
import MiningRPCClient from '@/components/MiningRPCClient';
import Terminal from '@/components/Terminal';
import Documentation from '@/components/Documentation';
import Footer from '@/components/Footer';
import HSMCCopilot from '@/components/HSMCCopilot';
import { useAutoBackup } from '@/hooks/useAutoBackup';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { useAuth } from '@/hooks/useAuth';
import { useNetworkPresence } from '@/hooks/useNetworkPresence';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export const AppPage = () => {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useAutoBackup();
  usePushNotifications();
  useNetworkPresence();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate('/onboarding', { replace: true });
      return;
    }
    // Check if user has a wallet — if not, redirect back to onboarding step 3
    import("@/utils/db-retry").then(({ withRetry }) => {
      import("@/integrations/db/client").then(({ supabase }) => {
        withRetry(() => supabase.from("wallets").select("id").eq("user_id", user.id).limit(1).maybeSingle())
          .then(({ data, error }) => {
            if (!error && !data) navigate("/onboarding", { replace: true });
          });
      });
    });
  }, [user, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <ErrorBoundary name="Dashboard"><Dashboard /></ErrorBoundary>
      <ErrorBoundary name="Staking"><StakingDashboard onOpenAuth={() => navigate('/onboarding')} /></ErrorBoundary>
      <ErrorBoundary name="Tokenomics"><TokenomicsSection /></ErrorBoundary>
      <ErrorBoundary name="Privacy"><PrivacySection /></ErrorBoundary>
      <ErrorBoundary name="Network"><NetworkSection /></ErrorBoundary>
      <ErrorBoundary name="Explorer"><Explorer /></ErrorBoundary>
      <ErrorBoundary name="Mempool"><Mempool /></ErrorBoundary>
      <ErrorBoundary name="Governance"><GovernanceSection /></ErrorBoundary>
      <ErrorBoundary name="Smart Contracts"><SmartContractsExplorer /></ErrorBoundary>
      <ErrorBoundary name="Wallet"><WalletSection /></ErrorBoundary>
      <ErrorBoundary name="Swap"><SwapPanel /></ErrorBoundary>
      <section id="liquidity" className="container mx-auto px-4 py-12">
        <h2 className="text-2xl font-bold mb-2">Liquidity Pools</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Real AMM (constant product x·y=k). Price is derived from on-chain reserves only — nothing simulated.
          Configure Stripe keys in <a href="/app/settings" className="text-primary underline">Settings</a> to enable real-money pools.
        </p>
        <ErrorBoundary name="Liquidity"><LiquidityPoolPanel /></ErrorBoundary>
      </section>
      <ErrorBoundary name="Merchant"><MerchantPanel /></ErrorBoundary>
      <ErrorBoundary name="Mining Dashboard"><MiningDashboard /></ErrorBoundary>
      <ErrorBoundary name="Mining RPC"><MiningRPCClient /></ErrorBoundary>
      <ErrorBoundary name="Terminal"><Terminal /></ErrorBoundary>
      <ErrorBoundary name="Documentation"><Documentation /></ErrorBoundary>
      <Footer />
      <HSMCCopilot />
    </div>
  );
};

export default AppPage;
