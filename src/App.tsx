import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import OnboardingPage from "./pages/Onboarding";
import AppPage from "./pages/AppPage";
import ForgotPasswordPage from "./pages/ForgotPassword";
import ResetPasswordPage from "./pages/ResetPassword";
import PayPage from "./pages/PayPage";
import ProfilePage from "./pages/ProfilePage";
import LandingPage from "./pages/LandingPage";
import BlockchainNodePage from "./pages/BlockchainNode";
import WhitepaperPage from "./pages/WhitepaperPage";
import MainnetHub from "./pages/MainnetHub";
import MainnetReadiness from "./pages/MainnetReadiness";
import RustNodePage from "./pages/RustNodePage";
import InvestorsPage from "./pages/InvestorsPage";
import ListingKitPage from "./pages/ListingKitPage";
import SettingsPage from "./pages/SettingsPage";
import WalletAuthPage from "./pages/WalletAuth";
import OAuthConsent from "./pages/OAuthConsent";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <main>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/landing" element={<LandingPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route path="/app" element={<AppPage />} />
            <Route path="/app/profile" element={<ProfilePage />} />
            <Route path="/node" element={<BlockchainNodePage />} />
            <Route path="/whitepaper" element={<WhitepaperPage />} />
            <Route path="/mainnet" element={<MainnetHub />} />
            <Route path="/mainnet/readiness" element={<MainnetReadiness />} />
            <Route path="/rust-node" element={<RustNodePage />} />
            <Route path="/investors" element={<InvestorsPage />} />
            <Route path="/listing-kit" element={<ListingKitPage />} />
            <Route path="/app/settings" element={<SettingsPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/wallet-auth" element={<WalletAuthPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/pay/:slug" element={<PayPage />} />
            <Route path="/.lovable/oauth/consent" element={<OAuthConsent />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </BrowserRouter>

    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
