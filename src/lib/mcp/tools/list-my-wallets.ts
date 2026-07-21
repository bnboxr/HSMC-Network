import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
// Local DB client — no external dependency

function dbForUser(ctx: ToolContext) {
  return createClient(
    process.env.LOCAL_API_URL!,
    "local-key",
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "list_my_wallets",
  title: "List my wallets",
  description: "Lists the signed-in user's HSMC wallets (address, label, balance). Never returns seed phrases or private keys.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await dbForUser(ctx)
      .from("wallets")
      .select("id, address, label, balance, created_at")
      .eq("user_id", ctx.getUserId());
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { wallets: data ?? [] },
    };
  },
});
