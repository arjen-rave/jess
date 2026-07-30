// Cloudflare Worker for jess push subscriptions.
// Receives subscribe/unsubscribe calls from the site and persists them
// into subscriptions.json via the GitHub Contents API.
//
// Required Worker secrets:
//   GITHUB_TOKEN   - GitHub PAT with Contents read/write on the jess repo
//
// Required Worker vars:
//   GITHUB_OWNER   = "arjen-rave"
//   GITHUB_REPO    = "jess"
//   GITHUB_BRANCH  = "main"
//   ALLOWED_ORIGIN = "https://arjen-rave.github.io"

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS(origin) });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS(origin) });
    }

    try {
      if (url.pathname === "/subscribe") {
        const sub = await request.json();
        if (!sub || !sub.endpoint) {
          return new Response("Invalid subscription", { status: 400, headers: CORS_HEADERS(origin) });
        }
        await updateSubscriptions(env, (subs) => {
          const exists = subs.some((s) => s.endpoint === sub.endpoint);
          return exists ? subs : [...subs, sub];
        });
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      if (url.pathname === "/unsubscribe") {
        const { endpoint } = await request.json();
        await updateSubscriptions(env, (subs) => subs.filter((s) => s.endpoint !== endpoint));
        return new Response("OK", { status: 200, headers: CORS_HEADERS(origin) });
      }

      return new Response("Not found", { status: 404, headers: CORS_HEADERS(origin) });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500, headers: CORS_HEADERS(origin) });
    }
  }
};

async function updateSubscriptions(env, mutate) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || "main";
  const filePath = "subscriptions.json";
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;

  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    "User-Agent": "jess-subscribe-worker",
    Accept: "application/vnd.github+json"
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const getRes = await fetch(apiUrl, { headers: ghHeaders });
    if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
    const current = await getRes.json();
    const currentSubs = JSON.parse(atob(current.content));
    const nextSubs = mutate(currentSubs);

    const putRes = await fetch(apiUrl, {
      method: "PUT",
      headers: { ...ghHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Update push subscriptions [skip ci]",
        content: btoa(JSON.stringify(nextSubs, null, 2)),
        sha: current.sha,
        branch
      })
    });

    if (putRes.ok) return;
    if (putRes.status !== 409 && putRes.status !== 422) {
      throw new Error(`GitHub PUT failed: ${putRes.status}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 500));
  }
  throw new Error("Failed to update subscriptions.json after 3 attempts.");
}
