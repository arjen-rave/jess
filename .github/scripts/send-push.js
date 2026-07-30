// Sends a daily push notification to all subscribers in subscriptions.json.
// Triggered by GitHub Actions cron at 13:00 UTC (15:00 Amsterdam CEST — test time).
// Change cron to 0 11 * * * for 07:00 Toronto EDT when ready for Jess.

const fs = require("fs");
const path = require("path");
const webpush = require("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const SITE_URL = process.env.SITE_URL || "https://arjen-rave.github.io/jess/";

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY secrets.");
  process.exit(1);
}

webpush.setVapidDetails(
  "mailto:arjen.ravestein@gmail.com",
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY
);

const repoRoot = path.resolve(__dirname, "..", "..");
const subsPath = path.join(repoRoot, "subscriptions.json");
const subscriptions = fs.existsSync(subsPath)
  ? JSON.parse(fs.readFileSync(subsPath, "utf8"))
  : [];

if (subscriptions.length === 0) {
  console.log("No subscribers yet, nothing to send.");
  process.exit(0);
}

const payload = JSON.stringify({
  title: "Just For Jess ✦",
  body: "Your card for today is waiting 💛",
  url: SITE_URL
});

(async () => {
  let sent = 0, failed = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(sub, payload, { urgency: "high", TTL: 3600 });
      sent++;
    } catch (err) {
      failed++;
      const tail = (sub.endpoint || "").slice(-12);
      console.error(`Push failed for ...${tail}:`, err.statusCode || err.message);
    }
  }
  console.log(`Done. Sent: ${sent}, failed: ${failed}, total: ${subscriptions.length}`);
})();
