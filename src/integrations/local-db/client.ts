/**
 * Local DB Client — drop-in replacement for the DB client.
 *
 * Talks to the local API server on http://localhost:3001/rest/v1/:table
 * Returns data in DB-compatible shape: { data, error }
 *
 * Import: import { localDb } from '@/integrations/local-db/client';
 */

const API_BASE = "http://localhost:3001/rest/v1";

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

  /** Upsert one or more rows (simulated as insert with conflict handling on server) */
  async upsert(data: any | any[], _opts?: any): Promise<{ data: any; error: any }> {
    // For local DB, we treat upsert as a combination:
    // Try to update first, if 0 rows affected, insert.
    const rows = Array.isArray(data) ? data : [data];
    const results: any[] = [];
    for (const row of rows) {
      if (row.id || row.user_id) {
        // Try update first
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

// ── No-op channel (for compatibility with the DB channel API) ────────────────

class NoopChannel {
  private _listeners: Array<() => void> = [];

  on(_event: string, _filter: any, _callback: Function): this {
    return this;
  }

  subscribe(callback?: (status: string, err?: Error) => void): this {
    if (callback) callback("SUBSCRIBED");
    return this;
  }

  unsubscribe(): this {
    this._listeners = [];
    return this;
  }

  // Tracked for cleanup
  _id = Math.random().toString(36).slice(2);
}

// ── Local auth stubs (seed-auth handles real auth offline) ───────────────────

// H3 FIX: local-db is for development only. Block in production to prevent
// complete auth bypass via passwordless login.
if (typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD) {
  throw new Error(
    'local-db is NOT allowed in production. ' +
    'It accepts any email/password without verification, which would be a complete auth bypass. ' +
    'Use a real auth provider in production.'
  );
}

interface LocalUser {
  id: string;
  email?: string;
  user_metadata?: Record<string, any>;
  app_metadata?: Record<string, any>;
  aud?: string;
  created_at?: string;
}

interface LocalSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  user: LocalUser;
}

type AuthCallback = (event: string, session: LocalSession | null) => void;

const LS_AUTH_KEY = "hsmc_local_auth";

function getLocalAuth(): { user: LocalUser | null; session: LocalSession | null } {
  try {
    const raw = localStorage.getItem(LS_AUTH_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { user: parsed.user || null, session: parsed.session || null };
    }
  } catch {}
  return { user: null, session: null };
}

function setLocalAuth(user: LocalUser | null, session: LocalSession | null): void {
  if (user && session) {
    localStorage.setItem(LS_AUTH_KEY, JSON.stringify({ user, session }));
  } else {
    localStorage.removeItem(LS_AUTH_KEY);
  }
}

const _authListeners: Set<AuthCallback> = new Set();

function notifyAuthListeners(event: string, session: LocalSession | null): void {
  for (const cb of _authListeners) {
    try { cb(event, session); } catch {}
  }
}

const localAuth = {
  getSession: async () => {
    const { session } = getLocalAuth();
    return { data: { session }, error: null as any };
  },

  getUser: async () => {
    const { user } = getLocalAuth();
    return { data: { user }, error: null as any };
  },

  onAuthStateChange: (callback: AuthCallback) => {
    _authListeners.add(callback);
    // Fire initial state
    const { session } = getLocalAuth();
    try { callback("INITIAL_SESSION", session); } catch {}
    return {
      data: {
        subscription: {
          unsubscribe: () => { _authListeners.delete(callback); },
        },
      },
    };
  },

  signUp: async (credentials: { email: string; password: string; options?: any }) => {
    const user: LocalUser = {
      id: "local-" + Date.now().toString(36),
      email: credentials.email,
      user_metadata: credentials.options?.data || {},
    };
    const session: LocalSession = {
      access_token: "local-token-" + Date.now(),
      refresh_token: "local-refresh-" + Date.now(),
      user,
    };
    setLocalAuth(user, session);
    notifyAuthListeners("SIGNED_IN", session);
    return { data: { user, session }, error: null as any };
  },

  signInWithPassword: async (credentials: { email: string; password: string }) => {
    const user: LocalUser = {
      id: "local-" + Date.now().toString(36),
      email: credentials.email,
    };
    const session: LocalSession = {
      access_token: "local-token-" + Date.now(),
      refresh_token: "local-refresh-" + Date.now(),
      user,
    };
    setLocalAuth(user, session);
    notifyAuthListeners("SIGNED_IN", session);
    return { data: { user, session }, error: null as any };
  },

  signOut: async () => {
    setLocalAuth(null, null);
    notifyAuthListeners("SIGNED_OUT", null);
    return { error: null as any };
  },

  updateUser: async (_attrs: any) => {
    return { data: { user: getLocalAuth().user }, error: null as any };
  },

  setSession: async (tokens: { access_token: string; refresh_token: string }) => {
    const user: LocalUser = {
      id: "local-session-" + Date.now().toString(36),
    };
    const session: LocalSession = { ...tokens, user };
    setLocalAuth(user, session);
    notifyAuthListeners("SIGNED_IN", session);
    return { data: { user, session }, error: null as any };
  },

  // OAuth beta typing stub
  oauth: undefined as unknown,
};

// ── Local storage stubs ──────────────────────────────────────────────────────

const localStorage_ = {
  from: (_bucket: string) => ({
    upload: async (_path: string, _file: any, _opts?: any) => {
      return { data: { path: _path }, error: null as any };
    },
    getPublicUrl: (path: string) => {
      return { data: { publicUrl: `local://storage/${path}` } };
    },
    download: async (_path: string) => {
      return { data: null, error: { message: "Storage not available in local mode" } as any };
    },
  }),
};

// ── Edge functions stub ──────────────────────────────────────────────────────

const localFunctions = {
  invoke: async (_name: string, _opts?: any) => {
    console.debug(`[localDb] Edge function "${_name}" not available in local mode`);
    return { data: null, error: { message: `Edge function "${_name}" not available in local mode` } };
  },
};

// ── Main localDb object ──────────────────────────────────────────────────────

const _channels: Map<string, NoopChannel> = new Map();

export const localDb = {
  from(table: string): QueryBuilder {
    return new QueryBuilder(table);
  },

  channel(name: string): NoopChannel {
    const ch = new NoopChannel();
    _channels.set(name, ch);
    return ch;
  },

  removeChannel(channel: NoopChannel): void {
    channel.unsubscribe();
    for (const [name, c] of _channels) {
      if (c._id === channel._id) {
        _channels.delete(name);
        break;
      }
    }
  },

  /** Direct RPC-style call — returns no-op success for compatibility */
  rpc(_fn: string, _args?: any): Promise<{ data: any; error: null | { message: string } }> {
    console.debug(`[localDb] RPC "${_fn}" not available in local mode`);
    return Promise.resolve({ data: null, error: null });
  },

  /** Auth stubs — seed-auth.ts handles real auth offline */
  auth: localAuth,

  /** Storage stubs */
  storage: localStorage_,

  /** Edge Functions stubs */
  functions: localFunctions,
};
