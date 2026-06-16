'use strict';

const express  = require('express');
const webpush  = require('web-push');
const cron     = require('node-cron');
const fs       = require('fs');
const path     = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE= process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL  = process.env.VAPID_EMAIL;
const PUSH_SECRET  = process.env.PUSH_SECRET;

if (!VAPID_PUBLIC || !VAPID_PRIVATE || !VAPID_EMAIL || !PUSH_SECRET) {
  console.error('Missing required env vars: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL, PUSH_SECRET');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// ── Data dir ──────────────────────────────────────────────────────────────────
const DATA_DIR  = path.join(__dirname, 'data');
const SUB_FILE  = path.join(DATA_DIR, 'subscription.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function readSub() {
  try { return JSON.parse(fs.readFileSync(SUB_FILE, 'utf8')); } catch { return null; }
}
function writeSub(data) {
  fs.writeFileSync(SUB_FILE, JSON.stringify(data, null, 2));
}
function deleteSub() {
  try { fs.unlinkSync(SUB_FILE); } catch {}
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireSecret(req, res, next) {
  if (req.headers['x-push-secret'] !== PUSH_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Allow CORS from any origin (the PWA is hosted on GitHub Pages)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-push-secret');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// GET /vapid-public-key — no auth needed (client needs this to subscribe)
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// GET /health
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// POST /subscribe
app.post('/subscribe', requireSecret, (req, res) => {
  const { subscription, time, enabled, timezone } = req.body;
  if (!subscription || !time) return res.status(400).json({ error: 'Missing subscription or time' });
  writeSub({ subscription, time, enabled: !!enabled, timezone: timezone || 'Europe/Amsterdam' });
  console.log(`Subscription saved — time: ${time}, timezone: ${timezone || 'Europe/Amsterdam'}, enabled: ${enabled}`);
  res.json({ ok: true });
});

// POST /unsubscribe
app.post('/unsubscribe', requireSecret, (req, res) => {
  deleteSub();
  console.log('Subscription deleted');
  res.json({ ok: true });
});

// ── Push sender ───────────────────────────────────────────────────────────────
const PUSH_PAYLOAD = JSON.stringify({
  title: 'Just For Jess ✦',
  body:  'Your card for today is waiting 💛',
  url:   'https://arjen-rave.github.io/jess'
});

async function maybeSendPush() {
  const data = readSub();
  if (!data || !data.enabled || !data.subscription) return;

  const now       = new Date();
  const localTime = now.toLocaleTimeString('en-GB', {
    timeZone: data.timezone || 'Europe/Amsterdam',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  if (localTime !== data.time) return;

  console.log(`Sending push for ${localTime} (${data.timezone || 'Europe/Amsterdam'})…`);
  try {
    await webpush.sendNotification(data.subscription, PUSH_PAYLOAD);
    console.log('Push sent ✓');
  } catch (err) {
    if (err.statusCode === 410) {
      console.log('Subscription expired (410) — deleting');
      deleteSub();
    } else {
      console.error('Push error:', err.message);
    }
  }
}

// Run every minute
cron.schedule('* * * * *', maybeSendPush);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Jess push server listening on port ${PORT}`);
});
