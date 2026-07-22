#!/usr/bin/env node
/**
 * Create Cache Rule: cache all responses on cdn.widget.news (feed JSON).
 *
 * Needs API Token with:
 *   Zone → Cache Rules → Edit
 *   Zone → Zone → Read
 *   Zone → Cache Purge → Purge (optional, for later purge)
 *
 * Usage:
 *   export CLOUDFLARE_API_TOKEN=...   # do not commit
 *   export CLOUDFLARE_ZONE_ID=29b7cfd96af201fa96af472f5eccd358  # optional
 *   node scripts/setup-cdn-cache-rule.mjs
 */

const ZONE_ID = process.env.CLOUDFLARE_ZONE_ID || "29b7cfd96af201fa96af472f5eccd358";
const TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const RULE_DESC = "widget.news: cache R2 feed JSON on cdn.widget.news";

if (!TOKEN) {
  console.error(`
Missing CLOUDFLARE_API_TOKEN.

1) Create token:
   https://dash.cloudflare.com/profile/api-tokens
   Custom token permissions:
     • Zone · Cache Rules · Edit
     • Zone · Zone · Read
     • Zone · Cache Purge · Purge   (optional)
   Zone Resources: Include · Specific zone · widget.news

2) Run:
   export CLOUDFLARE_API_TOKEN='paste-token-here'
   node scripts/setup-cdn-cache-rule.mjs
`);
  process.exit(1);
}

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    const err = json.errors?.map((e) => e.message).join("; ") || res.statusText;
    throw new Error(`${method} ${path}: ${err}`);
  }
  return json.result;
}

const rule = {
  expression: '(http.host eq "cdn.widget.news")',
  description: RULE_DESC,
  action: "set_cache_settings",
  action_parameters: {
    cache: true,
    edge_ttl: {
      mode: "override_origin",
      default: 300,
    },
    browser_ttl: {
      mode: "respect_origin",
    },
    serve_stale: {
      disable_stale_while_updating: false,
    },
  },
  enabled: true,
};

function cleanExisting(rules) {
  return (rules || [])
    .filter((r) => r.description !== RULE_DESC)
    .map((r) => {
      const out = {
        expression: r.expression,
        description: r.description,
        action: r.action,
        enabled: r.enabled !== false,
      };
      if (r.action_parameters) out.action_parameters = r.action_parameters;
      if (r.id) out.id = r.id;
      return out;
    });
}

const entry = await cf(
  "GET",
  `/zones/${ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint`,
).catch(async (e) => {
  // No entrypoint yet — create via PUT on phase
  if (String(e.message).includes("10000") || String(e.message).includes("could not find")) {
    return null;
  }
  // 404-style empty
  return null;
});

const nextRules = [...cleanExisting(entry?.rules), rule];

if (entry?.id) {
  await cf("PUT", `/zones/${ZONE_ID}/rulesets/${entry.id}`, { rules: nextRules });
  console.log("Updated cache ruleset", entry.id);
} else {
  await cf("PUT", `/zones/${ZONE_ID}/rulesets/phases/http_request_cache_settings/entrypoint`, {
    rules: nextRules,
  });
  console.log("Created cache settings entrypoint with rule");
}

console.log("Rule:", RULE_DESC);
console.log('Expression: (http.host eq "cdn.widget.news")');
console.log("Edge TTL: 300s override · Browser: respect origin Cache-Control");
console.log("\nVerify:");
console.log("  curl -sI https://cdn.widget.news/f/TT9dcWeKp1Y7.json | grep -i cf-cache");
console.log("  # second request should show HIT or REVALIDATED");
