# Jess Push Server

Minimal Node.js push notification server for the Just For Jess PWA.

## Setup

### 1. Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Copy the output — you'll need both keys as environment variables.

### 2. Required environment variables

| Variable | Description |
|---|---|
| `VAPID_PUBLIC_KEY` | Base64url VAPID public key (from step 1) |
| `VAPID_PRIVATE_KEY` | Base64url VAPID private key (from step 1) |
| `VAPID_EMAIL` | Contact email for VAPID (e.g. `mailto:arjen@example.com`) |
| `PUSH_SECRET` | Shared secret for endpoint auth — choose any long random string |
| `PORT` | (optional) Port to listen on. Defaults to 3000 |

### 3. Run locally

```bash
npm install
VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_EMAIL=mailto:you@example.com PUSH_SECRET=changeme node server.js
```

### 4. Deploy to Railway

1. Push this folder to a GitHub repo (or a sub-path of the main repo)
2. Create a new Railway project → "Deploy from GitHub repo"
3. Set all five environment variables in Railway → Variables
4. Railway auto-detects `package.json` and runs `npm start`
5. Copy the Railway public URL and paste it into `index.html` as `PUSH_SERVER_URL`
6. Also set `PUSH_SECRET` in `index.html` to match the Railway variable

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/vapid-public-key` | None | Returns `{ key: "..." }` |
| `POST` | `/subscribe` | x-push-secret | Body: `{ subscription, time, enabled }` |
| `POST` | `/unsubscribe` | x-push-secret | Deletes stored subscription |
| `GET` | `/health` | None | Returns `{ ok: true }` |

## How notifications work

A cron job runs every minute. It reads the stored subscription and compares the saved `time` field against the current local time on the server. When they match, it sends a Web Push notification. If the push returns HTTP 410 (subscription expired), the subscription file is deleted automatically.
