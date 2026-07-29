/**
 * Local DB Client — thin wrapper around the API server.
 *
 * Talks to the local API server via Vite proxy on /rest/v1/:table.
 * Returns data in DB-compatible shape: { data, error }.
 *
 * Import: import { localDb } from '@/integrations/local-db/client';
 *
 * NOTE: Auth is handled by the API server (JWT). There is NO local auth mock.
 * Features not backed by the API server (realtime channels, storage, edge functions)
 * throw clear errors rather than silently succeeding with fake data.
 */

const API_BASE = "/rest/v1";

// ── Helpers ──────────────────────────────────────────────────────────────────

function buildUrl(
  table: string,
  columns?: string,
  filters?: Record<string, string>,
  order?: { column: string; ascending?: boolean },
  limit?: number,
  offset?: number
): string {
  const params = new URLSearchParams();
  if (columns) params.set("select", columns);
  else params.set("select", "*");

  if (filters) {
    for (const [key, val] of Object.entries(filters)) {
      params.set(key, val);
    }
  }

  if (order) {
    const dir = order.ascending === false ? "desc" : "asc";
    params.set("order", `${order.column}.${dir}`);
  }

  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));

  return `${API_BASE}/${table}?${params.toString()}`;
}

async function fetchApi(url: string, options?: RequestInit): Promise<{ data: any; error: any }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json };
    return { data: json, error: null };
  } catch (err: any) {
    console.warn("[localDb] API unreachable:", err.message);
    return { data: null, error: { message: err.message } };
  }
}

/** Returns a consistent "feature not available" error object. */
function notAvailable(feature: string): { data: null; error: { message: string } } {
  const msg = `Feature not available: ${feature}. Use the API server for this functionality.`;
  console.warn(`[localDb] ${msg}`);
  return { data: null, error: { message: msg } };
}

// ── Builder pattern (matches the DB query builder) ─────────────────────────

class QueryBuilder {
  private table: string;
  private _columns: string = "*";
  private _filters: Record<string, string> = {};
  private _order: { column: string; ascending?: boolean } | null = null;
  private _limit: number | undefined;
  private _offset: number | undefined;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string): this {
    this._columns = columns || "*";
    return this;
  }

  eq(column: string, value: any): this {
    this._filters[column] = `eq.${value}`;
    return this;
  }

  neq(column: string, value: any): this {
    this._filters[column] = `neq.${value}`;
    return this;
  }

  gt(column: string, value: number): this {
    this._filters[column] = `gt.${value}`;
    return this;
  }

  gte(column: string, value: number): this {
    this._filters[column] = `gte.${value}`;
    return this;
  }

  lt(column: string, value: number): this {
    this._filters[column] = `lt.${value}`;
    return this;
  }

  lte(column: string, value: number): this {
    this._filters[column] = `lte.${value}`;
    return this;
  }

  like(column: string, pattern: string): this {
    this._filters[column] = `like.${pattern}`;
    return this;
  }

  in(column: string, values: any[]): this {
    this._filters[column] = `in.${values.join(",")}`;
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this._order = { column, ascending: opts?.ascending ?? true };
    return this;
  }

  limit(n: number): this {
    this._limit = n;
    return this;
  }

  range(from: number, to: number): this {
    this._offset = from;
    this._limit = to - from + 1;
    return this;
  }

  // ── Terminal operations ────────────────────────────────────────────────

  /** Returns single row or throws if >1 */
  async single(): Promise<{ data: any; error: any }> {
    const url = buildUrl(this.table, this._columns, this._filters, this._order, 2, 0);
    const { data, error } = await fetchApi(url);
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: { message: "No rows found" } };
    }
    if (data.length > 1) {
      return { data: null, error: { message: "Multiple rows found" } };
    }
    return { data: data[0], error: null };
  }

  /** Returns single row or null */
  async maybeSingle(): Promise<{ data: any; error: any }> {
    const url = buildUrl(this.table, this._columns, this._filters, this._order, 2, 0);
    const { data, error } = await fetchApi(url);
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: null };
    }
    return { data: data[0], error: null };
  }

  /** Returns array of rows. This is the default when await-ing directly. */
  async then<T = any>(
    onfulfilled?: ((value: { data: T[]; error: null } | { data: null; error: any }) => any) | null,
    onrejected?: ((reason: any) => any) | null
  ): Promise<any> {
    const url = buildUrl(this.table, this._columns, this._filters, this._order, this._limit, this._offset);
    const result = await fetchApi(url);
    return onfulfilled ? onfulfilled(result as any) : result;
  }

  /** Insert one or more rows */
  async insert(data: any | any[]): Promise<{ data: any; error: any }> {
    const url = `${API_BASE}/${this.table}`;
    return fetchApi(url, { method: "POST", body: JSON.stringify(data) });
  }

  /** Upsert one or more rows */
  async upsert(data: any | any[], _opts?: any): Promise<{ data: any; error: any }> {
    const rows = Array.isArray(data) ? data : [data];
    const results: any[] = [];
    for (const row of rows) {
      if (row.id || row.user_id) {
        let updateFilters: Record<string, string> = {};
        if (row.id) updateFilters.id = `eq.${row.id}`;
        else if (row.user_id) updateFilters.user_id = `eq.${row.user_id}`;

        const checkUrl = buildUrl(this.table, "id", updateFilters, undefined, 1);
        const { data: existing } = await fetchApi(checkUrl);
        if (existing && Array.isArray(existing) && existing.length > 0) {
          const updateUrl = `${API_BASE}/${this.table}?${new URLSearchParams(updateFilters).toString()}`;
          const { data: updated, error } = await fetchApi(updateUrl, {
            method: "PATCH",
            body: JSON.stringify(row),
          });
          if (error) return { data: null, error };
          results.push(...(Array.isArray(updated) ? updated : [updated]));
        } else {
          const { data: inserted, error } = await fetchApi(`${API_BASE}/${this.table}`, {
            method: "POST",
            body: JSON.stringify(row),
          });
          if (error) return { data: null, error };
          results.push(...(Array.isArray(inserted) ? inserted : [inserted]));
        }
      } else {
        const { data: inserted, error } = await fetchApi(`${API_BASE}/${this.table}`, {
          method: "POST",
          body: JSON.stringify(row),
        });
        if (error) return { data: null, error };
        results.push(...(Array.isArray(inserted) ? inserted : [inserted]));
      }
    }
    return { data: results, error: null };
  }

  /** Update rows matching filters */
  async update(data: any): Promise<{ data: any; error: any }> {
    const filterParams = new URLSearchParams(this._filters);
    const url = `${API_BASE}/${this.table}?${filterParams.toString()}`;
    return fetchApi(url, { method: "PATCH", body: JSON.stringify(data) });
  }

  /** Delete rows matching filters */
  async delete(): Promise<{ data: any; error: any }> {
    const filterParams = new URLSearchParams(this._filters);
    const url = `${API_BASE}/${this.table}?${filterParams.toString()}`;
    return fetchApi(url, { method: "DELETE" });
  }
}

// ── Feature-not-available stubs (no mock data, no silent success) ─────────

/**
 * Realtime channels are not supported in local mode.
 * The API server does not expose a WebSocket/subscription endpoint yet.
 * Use polling via localDb.from() instead, or deploy a real Supabase instance.
 */
function createChannelStub(_name: string) {
  console.warn("[localDb] realtime channels not available. Use polling via localDb.from() instead.");
  return {
    on(_event: string, _filter: any, _callback: Function): ReturnType<typeof createChannelStub> {
      return this;
    },
    subscribe(callback?: (status: string, err?: Error) => void): ReturnType<typeof createChannelStub> {
      if (callback) callback("CLOSED", new Error("Feature not available: realtime channels. Use API server."));
      return this;
    },
    unsubscribe(): ReturnType<typeof createChannelStub> {
      return this;
    },
  };
}

// ── Main localDb object ──────────────────────────────────────────────────────

export const localDb = {
  /** Query builder — real HTTP calls to the API server */
  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  },

  /**
   * Auth is handled by the API server (JWT tokens).
   * There is no local auth bypass — callers must obtain a real JWT from the API server.
   */
  get auth() {
    throw new Error(
      "Feature not available: localDb.auth. Auth is handled by the API server via JWT. " +
      "Use fetch() to POST /auth/login or /auth/register on the API server."
    );
  },

  /**
   * Realtime channels are not supported.
   * Use localDb.from() with polling instead.
   */
  channel(name: string) {
    return createChannelStub(name);
  },

  /** Remove a channel (no-op since channels are not supported) */
  removeChannel(_channel: ReturnType<typeof createChannelStub>): void {
    // no-op
  },

  /**
   * Direct RPC calls are not supported.
   * Use the API server's REST endpoints instead.
   */
  async rpc(_fn: string, _args?: any): Promise<{ data: null; error: { message: string } }> {
    return notAvailable(`rpc("${_fn}")`);
  },

  /**
   * File storage is not available in local mode.
   * Use the API server's upload endpoints instead.
   */
  get storage() {
    throw new Error(
      "Feature not available: localDb.storage. File uploads must go through the API server. " +
      "Use fetch() to POST /storage/upload."
    );
  },

  /**
   * Edge functions are not available in local mode.
   * Use the API server endpoints directly.
   */
  get functions() {
    throw new Error(
      "Feature not available: localDb.functions. Invoke server-side logic via the API server's REST endpoints."
    );
  },
};
