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
 *
 * Query builder mirrors the supabase-js surface used across the app:
 *   from(table).select(cols?, opts?).eq().or().order().limit()  → await → { data, error, count? }
 *   from(table).insert(row).select().single()                   → await → { data, error }
 *   from(table).update(row).eq(id, x).eq(user_id, y)            → await → { data, error }
 *   from(table).delete().eq(id, x)                              → await → { data, error }
 *
 * Write ops (insert/update/upsert/delete) are deferred until the query is awaited,
 * exactly like supabase-js: filters chained after the write op still apply.
 * The API server requires at least one `eq` filter for PATCH/DELETE, so deferred
 * writes also fix the runtime behaviour of `.update({...}).eq(...)` chains.
 */

const API_BASE = "/rest/v1";

// ── Types ──────────────────────────────────────────────────────────────────

/** Shape resolved when a query builder is awaited (`.then` / `await`). */
export interface QueryResult<Row> {
  data: Row[] | null;
  error: any;
  /** Only populated when `select(cols, { count: 'exact' })` is used AND the API server reports a count. */
  count?: number | null;
}

/** Pending write operation, executed when the builder is awaited. */
type WriteOp =
  | { kind: "insert"; payload: any }
  | { kind: "upsert"; payload: any; opts?: any }
  | { kind: "update"; payload: any }
  | { kind: "delete" };

/** Supabase-like auth surface. The getter throws at runtime (auth is server-side only). */
export interface LocalAuthUser {
  id: string;
  email?: string | null;
  role?: string | null;
  aud?: string | null;
  created_at?: string | null;
  user_metadata?: Record<string, unknown>;
  app_metadata?: Record<string, unknown>;
}

export interface LocalAuthSession {
  user: LocalAuthUser | null;
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface LocalAuthClient {
  getSession(): Promise<{ data: { session: LocalAuthSession | null }; error: null }>;
  getUser(): Promise<{ data: { user: LocalAuthUser | null }; error: null }>;
  onAuthStateChange(
    callback: (event: string, session: LocalAuthSession | null) => void
  ): { data: { subscription: { unsubscribe(): void } } };
  signUp(payload: {
    email: string;
    password: string;
    options?: Record<string, unknown>;
  }): Promise<{ data: any; error: any }>;
  signInWithPassword(payload: { email: string; password: string }): Promise<{ data: any; error: any }>;
  signOut(): Promise<{ error: any }>;
  updateUser(payload: Record<string, unknown>): Promise<{ data: any; error: any }>;
}

/** Supabase-like functions surface. invoke() resolves with a clear "not available" error. */
export interface LocalFunctionsClient {
  invoke(fn: string, opts?: { body?: any; headers?: Record<string, string> }): Promise<{
    data: any;
    error: any;
  }>;
}

/** Supabase-like storage surface. The getter throws at runtime (no file storage in local mode). */
export interface LocalStorageClient {
  from(bucket: string): {
    upload(
      path: string,
      file: Blob | ArrayBuffer | File,
      opts?: { upsert?: boolean; contentType?: string }
    ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
    download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
    getPublicUrl(path: string): { data: { publicUrl: string } };
  };
}

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

class QueryBuilder<Row = any> {
  private table: string;
  private _columns: string = "*";
  private _filters: Record<string, string> = {};
  private _order: { column: string; ascending?: boolean } | null = null;
  private _limit: number | undefined;
  private _offset: number | undefined;
  private _op: WriteOp | null = null;
  private _count: "exact" | "planned" | "estimated" | null = null;

  constructor(table: string) {
    this.table = table;
  }

  select(columns?: string, opts?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    this._columns = columns || "*";
    if (opts?.count) this._count = opts.count;
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

  gt(column: string, value: any): this {
    this._filters[column] = `gt.${value}`;
    return this;
  }

  gte(column: string, value: any): this {
    this._filters[column] = `gte.${value}`;
    return this;
  }

  lt(column: string, value: any): this {
    this._filters[column] = `lt.${value}`;
    return this;
  }

  lte(column: string, value: any): this {
    this._filters[column] = `lte.${value}`;
    return this;
  }

  like(column: string, pattern: string): this {
    this._filters[column] = `like.${pattern}`;
    return this;
  }

  /**
   * Case-insensitive LIKE. SQLite's LIKE is case-insensitive for ASCII by default,
   * so this maps to the same `like` operator the API server understands.
   */
  ilike(column: string, pattern: string): this {
    this._filters[column] = `like.${pattern}`;
    return this;
  }

  in(column: string, values: any[]): this {
    this._filters[column] = `in.${values.join(",")}`;
    return this;
  }

  /**
   * NOT filters are not supported by the API server's SQL builder.
   * Throw a clear error rather than silently returning unfiltered rows.
   */
  not(_column: string, _operator: string, _value: any): this {
    throw new Error(
      "Feature not available: not() filters. The API server does not support negation filters. " +
      "Fetch the rows and filter client-side instead."
    );
  }

  /**
   * OR filters are not supported by the API server's SQL builder.
   * Throw a clear error rather than silently returning unfiltered rows.
   */
  or(_filters: string): this {
    throw new Error(
      "Feature not available: or() filters. The API server does not support OR filters yet. " +
      "Fetch the rows and filter client-side instead."
    );
  }

  /**
   * IS NULL / IS NOT NULL filters are not supported by the API server's SQL builder.
   * Throw a clear error rather than silently returning unfiltered rows.
   */
  is(_column: string, _value: any): this {
    throw new Error(
      "Feature not available: is() filters. The API server does not support IS NULL filters. " +
      "Fetch the rows and filter client-side instead."
    );
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

  // ── Write ops (deferred until await, supabase-js style) ────────────────

  /** Insert one or more rows. Chain .select().single() or just await it. */
  insert(data: any | any[]): this {
    this._op = { kind: "insert", payload: data };
    return this;
  }

  /** Upsert one or more rows (by id/user_id when present, else insert). */
  upsert(data: any | any[], opts?: any): this {
    this._op = { kind: "upsert", payload: data, opts };
    return this;
  }

  /** Update rows matching the accumulated filters. */
  update(data: any): this {
    this._op = { kind: "update", payload: data };
    return this;
  }

  /** Delete rows matching the accumulated filters. */
  delete(): this {
    this._op = { kind: "delete" };
    return this;
  }

  // ── Terminal operations ────────────────────────────────────────────────

  /** Execute the pending write op (if any) and return the raw server result. */
  private async executeWrite(): Promise<{ data: any; error: any }> {
    const op = this._op;
    if (!op) return { data: null, error: { message: "No write operation pending" } };

    if (op.kind === "insert") {
      const url = `${API_BASE}/${this.table}`;
      return fetchApi(url, { method: "POST", body: JSON.stringify(op.payload) });
    }

    if (op.kind === "update") {
      const filterParams = new URLSearchParams(this._filters);
      const url = `${API_BASE}/${this.table}?${filterParams.toString()}`;
      return fetchApi(url, { method: "PATCH", body: JSON.stringify(op.payload) });
    }

    if (op.kind === "delete") {
      const filterParams = new URLSearchParams(this._filters);
      const url = `${API_BASE}/${this.table}?${filterParams.toString()}`;
      return fetchApi(url, { method: "DELETE" });
    }

    // upsert: update existing rows (by id or user_id), insert the rest
    const rows = Array.isArray(op.payload) ? op.payload : [op.payload];
    const results: any[] = [];
    for (const row of rows) {
      if (row.id || row.user_id) {
        const updateFilters: Record<string, string> = {};
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

  /** Execute the query/write and resolve to a supabase-shaped result. */
  private async execute(): Promise<QueryResult<Row>> {
    if (this._op) {
      const { data, error } = await this.executeWrite();
      if (error) return { data: null, error, count: null };
      return { data: (Array.isArray(data) ? data : data != null ? [data] : null) as Row[] | null, error: null, count: null };
    }

    const url = buildUrl(this.table, this._columns, this._filters, this._order, this._limit, this._offset);
    const { data, error } = await fetchApi(url);
    if (error) return { data: null, error, count: null };
    // The API server does not report a total count (no Content-Range header), so
    // `count` stays null unless/until the server supports it. Never fake it.
    return { data: (Array.isArray(data) ? data : data != null ? [data] : null) as Row[] | null, error: null, count: this._count && Array.isArray(data) ? data.length : null };
  }

  /** This builder is a thenable: `await query` resolves to a supabase-shaped result. */
  then(
    onfulfilled?: ((value: QueryResult<Row>) => any) | null,
    onrejected?: ((reason: any) => any) | null
  ): Promise<any> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }

  /** Returns single row or throws if >1. Works for reads and pending writes. */
  async single(): Promise<{ data: Row | null; error: any }> {
    if (this._op) {
      const { data, error } = await this.executeWrite();
      if (error) return { data: null, error };
      const rows = Array.isArray(data) ? data : data != null ? [data] : [];
      if (rows.length === 0) return { data: null, error: { message: "No rows found" } };
      if (rows.length > 1) return { data: null, error: { message: "Multiple rows found" } };
      return { data: rows[0] as Row, error: null };
    }
    const url = buildUrl(this.table, this._columns, this._filters, this._order, 2, 0);
    const { data, error } = await fetchApi(url);
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: { message: "No rows found" } };
    }
    if (data.length > 1) {
      return { data: null, error: { message: "Multiple rows found" } };
    }
    return { data: data[0] as Row, error: null };
  }

  /** Returns single row or null. Works for reads and pending writes. */
  async maybeSingle(): Promise<{ data: Row | null; error: any }> {
    if (this._op) {
      const { data, error } = await this.executeWrite();
      if (error) return { data: null, error };
      const rows = Array.isArray(data) ? data : data != null ? [data] : [];
      return { data: (rows[0] as Row) ?? null, error: null };
    }
    const url = buildUrl(this.table, this._columns, this._filters, this._order, 2, 0);
    const { data, error } = await fetchApi(url);
    if (error) return { data: null, error };
    if (!Array.isArray(data) || data.length === 0) {
      return { data: null, error: null };
    }
    return { data: data[0] as Row, error: null };
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
  from<Row = any>(table: string): QueryBuilder<Row> {
    return new QueryBuilder<Row>(table);
  },

  /**
   * Auth is handled by the API server (JWT tokens).
   * There is no local auth bypass — callers must obtain a real JWT from the API server.
   * Accessing this getter throws a clear error (callers must handle it, e.g. try/catch).
   */
  get auth(): LocalAuthClient {
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
   * Edge functions are not available in local mode.
   * invoke() resolves with a clear error object so callers can fall back
   * to the API server's own endpoints.
   */
  functions: {
    invoke(
      _fn: string,
      _opts?: { body?: any; headers?: Record<string, string> }
    ): Promise<{ data: any; error: any }> {
      return Promise.resolve(notAvailable(`functions.invoke("${_fn}")`));
    },
  } satisfies LocalFunctionsClient,

  /**
   * File storage is not available in local mode.
   * Use the API server's upload endpoints instead.
   * Accessing this getter throws a clear error (callers must handle it, e.g. try/catch).
   */
  get storage(): LocalStorageClient {
    throw new Error(
      "Feature not available: localDb.storage. File uploads must go through the API server. " +
      "Use fetch() to POST /storage/upload."
    );
  },
};
