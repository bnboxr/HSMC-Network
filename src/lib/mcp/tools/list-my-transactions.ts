import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
// Local DB client — no external dependency
import { z } from "zod";

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
  name: "list_my_transactions",
  title: "List my recent transactions",
  description: "Lists recent HSMC transactions for the signed-in user, most recent first.",
  inputSchema: {
    limit: z.number().int().min(1).max(100).optional().describe("Max rows (default 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await dbForUser(ctx)
      .from("transactions")
      .select("*")
      .eq("user_id", ctx.getUserId())
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { transactions: data ?? [] },
    };
  },
});
