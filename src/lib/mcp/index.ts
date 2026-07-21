import { auth, defineMcp } from "@lovable.dev/mcp-js";
import getMarketPrice from "./tools/get-market-price";
import getNetworkStats from "./tools/get-network-stats";
import listMyWallets from "./tools/list-my-wallets";
import listMyTransactions from "./tools/list-my-transactions";

const projectRef = import.meta.env.VITE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "astra-hsmc-mcp",
  title: "Astra-HSMC MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Astra-HSMC crypto platform. Read HSMC market price and network stats without auth. Signed-in users can list their own wallets and recent transactions. Never exposes seed phrases or private keys.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.hsmc.network/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMarketPrice, getNetworkStats, listMyWallets, listMyTransactions],
});
