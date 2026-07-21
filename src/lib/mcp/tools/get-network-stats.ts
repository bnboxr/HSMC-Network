// Local DB client — no external dependency
import type { ToolContext } from "../types";

export async function getNetworkStatsTool(ctx: ToolContext, _args: unknown) {
  const apiBase = process.env.LOCAL_API_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${apiBase}/rest/v1/network_stats?select=*&order=updated_at.desc&limit=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: true, data: data?.[0] ?? data };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
