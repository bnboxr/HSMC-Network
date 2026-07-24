// Local DB client — no external dependency
import type { ToolContext } from "../types";

export async function getMarketPriceTool(ctx: ToolContext, _args: unknown) {
  try {
    const res = await fetch(`/rest/v1/token_metrics?select=price&order=updated_at.desc&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, data: data?.[0] ?? data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
