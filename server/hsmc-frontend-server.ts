import { serve, file } from "bun";
import { join, extname } from "path";

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "application/javascript",
  ".mjs": "application/javascript", ".css": "text/css",
  ".png": "image/png", ".jpg": "image/jpeg",
  ".svg": "image/svg+xml", ".json": "application/json",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

const API_TARGET = "http://localhost:3001";
// Portable: repo server/.. — resolves to <repo>/dist wherever this file lives.
const ROOT = join(import.meta.dir, "..", "dist");

const tsxTranspiler = new Bun.Transpiler({ loader: "tsx" });

function resolveAlias(p: string): string {
  if (p.startsWith("@/")) return join(ROOT, "src", p.slice(2));
  return join(ROOT, p);
}

serve({
  port: 3000,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Proxy API calls
    const PROXY = ["/api", "/rest", "/stripe", "/treasury", "/auth", "/crypto", "/node-proxy", "/health", "/explorer"];
    for (const prefix of PROXY) {
      if (pathname.startsWith(prefix)) {
        try {
          const targetUrl = API_TARGET + pathname + url.search;
          const body = req.method !== "GET" && req.method !== "HEAD"
            ? await req.arrayBuffer() : undefined;
          const resp = await fetch(targetUrl, {
            method: req.method, headers: req.headers, body,
          });
          return new Response(resp.body, {
            status: resp.status, headers: resp.headers,
          });
        } catch {
          return new Response("API unavailable", { status: 502 });
        }
      }
    }

    // Serve files
    let filePath = pathname === "/" ? "/index.html" : pathname;
    let fullPath = resolveAlias(filePath);
    const ext = extname(fullPath).toLowerCase();

    try {
      const f = file(fullPath);

      // Transpile TS/TSX on the fly
      if ([".ts", ".tsx"].includes(ext)) {
        const content = await f.text();
        const transpiled = tsxTranspiler.transformSync(content);
        return new Response(transpiled, {
          headers: { "Content-Type": "application/javascript" },
        });
      }

      return new Response(f, {
        headers: { "Content-Type": MIME[ext] || "application/octet-stream" },
      });
    } catch {
      // SPA fallback: serve index.html
      try {
        const f = file(join(ROOT, "index.html"));
        return new Response(f, {
          headers: { "Content-Type": "text/html" },
        });
      } catch {
        return new Response("Not Found", { status: 404 });
      }
    }
  },
});

console.log("🚀 HSMC Frontend running on http://localhost:3000");
console.log("   API proxy -> http://localhost:3001");
console.log("   Transpile-on-the-fly via Bun.Transpiler");
