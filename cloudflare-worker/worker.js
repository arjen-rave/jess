// Cloudflare Worker for jess push subscriptions.
// Receives subscribe/unsubscribe calls from the site and persists them
// into subscriptions.json via the GitHub Contents API.
//
// Also runs a daily scheduled trigger (see wrangler.toml) that sends the
// "Just For Jess" push notification to every subscription stored in
// subscriptions.json. Cloudflare Workers can't use Node's `web-push`
// package, so the VAPID signing and payload encryption below are done
// directly with the Web Crypto API (RFC 8291 / RFC 8292 / RFC 8188).
//
// Required Worker secrets:
//   GITHUB_TOKEN        - GitHub PAT with Contents read/write on the jess repo
//   VAPID_PUBLIC_KEY     - VAPID public key (base64url, uncompressed P-256 point)
//   VAPID_PRIVATE_KEY    - VAPID private key (base64url, raw P-256 scalar)
//   VAPID_SUBJECT         = "mailto:arjen.ravestein@gmail.com"
//
// Required Worker vars:
//   GITHUB_OWNER   = "arjen-rave"
//   GITHUB_REPO    = "jess"
//   GITHUB_BRANCH  = "main"
//   ALLOWED_ORIGIN = "https://arjen-rave.github.io"

const CORS_HEADERS = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
});

const READ_ONLY_PATHS = ["/seen", "/seen-dev", "/schedule"];

const SUBSCRIPTIONS_RAW_URL = "https://raw.githubusercontent.com/arjen-rave/jess/main/subscriptions.json";

const PUSH_PAYLOAD = {
  title: "Just For Jess ✦",
  body: "Your card for today is waiting 💛",
  url: "https://arjen-rave.github.io/jess/"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = env.ALLOWED_ORIGIN || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS(origin) });
    }

    const isReadRoute = request.method === "GET" && READ_ONLY_PATHS.includes(url.pathname);
    if (!isReadRoute && request.method !== "POST") {
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

      // ── SEEN endpoints ──
      if (url.pathname === '/seen' || url.pathname === '/seen-dev') {
        const fileName = url.pathname === '/seen-dev' ? 'seen-dev.json' : 'seen.json';
        const raw = await fetch(
          `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/main/${fileName}?t=${Date.now()}`
        );
        if (!raw.ok) return new Response('[]', { status: 200, headers: CORS_HEADERS(origin) });
        const text = await raw.text();
        return new Response(text, { status: 200, headers: { ...CORS_HEADERS(origin), 'Content-Type': 'application/json' } });
      }

      if (url.pathname === '/seen/add' || url.pathname === '/seen-dev/add') {
        const fileName = url.pathname === '/seen-dev/add' ? 'seen-dev.json' : 'seen.json';
        const { date } = await request.json();
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return new Response('Invalid date', { status: 400, headers: CORS_HEADERS(origin) });
        }
        await updateFile(env, fileName, (seen) => {
          return seen.includes(date) ? seen : [...seen, date];
        });
        return new Response('OK', { status: 200, headers: CORS_HEADERS(origin) });
      }

      // ── SCHEDULE endpoint ──
      if (url.pathname === '/schedule') {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/main/schedule.json?t=${Date.now()}`
        );
        if (!raw.ok) return new Response(JSON.stringify({ error: 'No schedule found' }), { status: 404, headers: CORS_HEADERS(origin) });
        const text = await raw.text();
        return new Response(text, { status: 200, headers: { ...CORS_HEADERS(origin), 'Content-Type': 'application/json' } });
      }

      return new Response("Not found", { status: 404, headers: CORS_HEADERS(origin) });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500, headers: CORS_HEADERS(origin) });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailyPush(env));
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
    if (JSON.stringify(nextSubs) === JSON.stringify(currentSubs)) return;

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

async function updateFile(env, fileName, mutate) {
  const owner = env.GITHUB_OWNER;
  const repo = env.GITHUB_REPO;
  const branch = env.GITHUB_BRANCH || 'main';
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}?ref=${branch}`;

  const ghHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'jess-subscribe-worker',
    Accept: 'application/vnd.github+json'
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    const getRes = await fetch(apiUrl, { headers: ghHeaders });
    let current, currentData;
    if (getRes.status === 404) {
      currentData = [];
      current = { sha: null };
    } else {
      if (!getRes.ok) throw new Error(`GitHub GET failed: ${getRes.status}`);
      current = await getRes.json();
      currentData = JSON.parse(atob(current.content));
    }
    const nextData = mutate(currentData);
    if (JSON.stringify(nextData) === JSON.stringify(currentData)) return;
    const putBody = {
      message: `Update ${fileName} [skip ci]`,
      content: btoa(JSON.stringify(nextData, null, 2)),
      branch
    };
    if (current.sha) putBody.sha = current.sha;

    const putRes = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...ghHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    });

    if (putRes.ok) return;
    if (putRes.status !== 409 && putRes.status !== 422) {
      throw new Error(`GitHub PUT failed: ${putRes.status}`);
    }
    await new Promise((r) => setTimeout(r, attempt * 500));
  }
  throw new Error(`Failed to update ${fileName} after 3 attempts.`);
}

// ─────────────────────────────────────────────────────────────────────────
// DAILY PUSH SEND
// ─────────────────────────────────────────────────────────────────────────

async function sendDailyPush(env) {
  const res = await fetch(`${SUBSCRIPTIONS_RAW_URL}?t=${Date.now()}`, { cf: { cacheTtl: 0 } });
  if (!res.ok) {
    console.error(`Failed to fetch subscriptions.json: ${res.status}`);
    return;
  }

  let subs;
  try {
    subs = await res.json();
  } catch (err) {
    console.error("subscriptions.json was not valid JSON:", err.message);
    return;
  }
  if (!Array.isArray(subs) || subs.length === 0) {
    console.log("No subscribers, nothing to send.");
    return;
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(PUSH_PAYLOAD));
  const vapidPrivateKey = await importVapidPrivateKey(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);

  let sent = 0, failed = 0;
  for (const sub of subs) {
    const tail = (sub.endpoint || "").slice(-12);
    try {
      const endpointOrigin = new URL(sub.endpoint).origin;
      const jwt = await signVapidJwt(endpointOrigin, env.VAPID_SUBJECT, vapidPrivateKey);
      const authHeader = `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`;
      const encryptedBody = await encryptPayload(payloadBytes, sub);

      const pushRes = await fetch(sub.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Encoding": "aes128gcm",
          "TTL": "3600",
          "Urgency": "high",
          "Authorization": authHeader
        },
        body: encryptedBody
      });

      if (pushRes.status === 410) {
        console.log(`Subscription expired (410), removing ...${tail}`);
        await updateSubscriptions(env, (subs2) => subs2.filter((s) => s.endpoint !== sub.endpoint));
        failed++;
      } else if (!pushRes.ok) {
        console.error(`Push failed (${pushRes.status}) for ...${tail}`);
        failed++;
      } else {
        sent++;
      }
    } catch (err) {
      failed++;
      console.error(`Push error for ...${tail}:`, err.message);
    }
  }
  console.log(`Done. Sent: ${sent}, failed: ${failed}, total: ${subs.length}`);
}

// ── VAPID JWT (ES256) ──────────────────────────────────────────────────

async function importVapidPrivateKey(publicKeyB64Url, privateKeyB64Url) {
  const pub = base64urlToBytes(publicKeyB64Url); // 65 bytes: 0x04 || X(32) || Y(32)
  const d = base64urlToBytes(privateKeyB64Url); // 32 bytes
  const jwk = {
    kty: "EC",
    crv: "P-256",
    d: bytesToBase64url(d),
    x: bytesToBase64url(pub.slice(1, 33)),
    y: bytesToBase64url(pub.slice(33, 65)),
    ext: true
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function signVapidJwt(audience, subject, privateKey) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject
  };
  const signingInput =
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(header))) + "." +
    bytesToBase64url(new TextEncoder().encode(JSON.stringify(payload)));

  // Web Crypto's ECDSA signature is raw (r || s), which is exactly what a JWS ES256
  // signature needs — no DER conversion required (unlike Node's crypto module).
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + "." + bytesToBase64url(new Uint8Array(signature));
}

// ── Web Push payload encryption (RFC 8291 aes128gcm, keyed by RFC 8188) ─

async function encryptPayload(payloadBytes, sub) {
  const uaPublicBytes = base64urlToBytes(sub.keys.p256dh); // 65 bytes, uncompressed
  const authSecret = base64urlToBytes(sub.keys.auth); // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    "raw", uaPublicBytes, { name: "ECDH", namedCurve: "P-256" }, false, []
  );

  // Fresh ephemeral keypair per message, per RFC 8291.
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicBytes = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256)
  );

  // IKM = HKDF(salt=auth_secret, ikm=ecdh_secret, info="WebPush: info"||0x00||ua_pub||as_pub, 32)
  const keyInfo = concatBytes([
    new TextEncoder().encode("WebPush: info"),
    new Uint8Array([0]),
    uaPublicBytes,
    asPublicBytes
  ]);
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // Per-message salt + aes128gcm content-encryption key/nonce derivation (RFC 8188).
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekInfo = concatBytes([new TextEncoder().encode("Content-Encoding: aes128gcm"), new Uint8Array([0])]);
  const nonceInfo = concatBytes([new TextEncoder().encode("Content-Encoding: nonce"), new Uint8Array([0])]);
  const cek = await hkdf(salt, ikm, cekInfo, 16);
  const nonce = await hkdf(salt, ikm, nonceInfo, 12);

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const plaintext = concatBytes([payloadBytes, new Uint8Array([2])]); // single-record delimiter
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, plaintext)
  );

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false); // record size, big-endian

  const header = concatBytes([
    salt,
    rs,
    new Uint8Array([asPublicBytes.length]), // idlen
    asPublicBytes // keyid = this message's ephemeral public key
  ]);

  return concatBytes([header, ciphertext]);
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

// ── base64url + byte helpers ────────────────────────────────────────────

function base64urlToBytes(b64url) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
