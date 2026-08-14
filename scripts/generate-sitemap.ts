// Runs before `vite dev` and `vite build` (predev/prebuild hooks); writes public/sitemap.xml.
import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://hsmc-network.ctonew.app";

interface SitemapEntry {
  path: string;
  changefreq?: "weekly" | "monthly" | "daily";
  priority?: string;
}

const entries: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/landing", changefreq: "weekly", priority: "0.9" },
  { path: "/whitepaper", changefreq: "monthly", priority: "0.9" },
  { path: "/mainnet", changefreq: "weekly", priority: "0.8" },
  { path: "/mainnet/readiness", changefreq: "weekly", priority: "0.6" },
  { path: "/rust-node", changefreq: "monthly", priority: "0.7" },
  { path: "/node", changefreq: "weekly", priority: "0.7" },
  { path: "/investors", changefreq: "monthly", priority: "0.7" },
  { path: "/listing-kit", changefreq: "monthly", priority: "0.6" },
  { path: "/onboarding", changefreq: "monthly", priority: "0.5" },
];

const xml = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ...entries.map((e) =>
    [
      `  <url>`,
      `    <loc>${BASE_URL}${e.path}</loc>`,
      e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
      e.priority ? `    <priority>${e.priority}</priority>` : null,
      `  </url>`,
    ].filter(Boolean).join("\n")
  ),
  `</urlset>`,
].join("\n");

writeFileSync(resolve("public/sitemap.xml"), xml);
console.log(`sitemap.xml written (${entries.length} entries)`);
