# Alpha — Local Setup Guide

Alpha is a voice-first, futuristic AI companion built with **TanStack Start**, **React 19**, **Tailwind CSS v4**, and **Vite**. It runs as a Progressive Web App (PWA) on your phone or desktop.

## Requirements

- **Node.js** 20+ (22 LTS recommended)
- **Bun** package manager (`curl -fsSL https://bun.sh/install | bash`)
- A modern browser (Chrome/Edge/Firefox/Safari)

## Quick start

```bash
# 1. Clone or copy the project into a folder
cd alpha

# 2. Install dependencies
bun install

# 3. Start the development server
bun dev
```

Open the URL shown in the terminal (usually `http://localhost:8080`).

## Environment variables

Most configuration lives inside Alpha in **Settings → Online / Offline / Alpha Data**. The `.env` file is optional and mainly used for the build environment.

Copy `.env.example` to `.env` if you need to set anything:

```bash
cp .env.example .env
```

| Variable   | Purpose                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `NODE_ENV` | `development` or `production` |
| `VITE_VAPID_PUBLIC_KEY` | Public Web Push application-server key used by the browser |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Server-only Web Push signing configuration |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Server-only service-account JSON used by the scheduled push worker |
| `FIREBASE_PROJECT_ID` | Optional project ID override (defaults to the service account project) |
| `FIRESTORE_DATABASE_ID` | Exact Firestore database ID used by the Firebase app |
| `ALPHA_CRON_SECRET` | At least 32 random characters; protects the scheduled push endpoint |
| `VITE_*` | Values prefixed with `VITE_` are public and must never contain secrets |

## API keys you need

Alpha works best when you supply your own keys in **Settings → Online**:

- **Groq API key** — fast chat models (`console.groq.com`, free tier available)
- **OpenRouter API key** — vision and coding models (`openrouter.ai`, free tier available)
- **OpenAI-compatible key** — optional; for OpenAI, DeepSeek, xAI, etc.

Without these keys, Alpha falls back to **Ollama** in offline mode.

## Offline mode

To run Alpha fully offline on your machine:

1. **Ollama** — `ollama run llama3.2:3b` (or any model you prefer)
   - Start with: `OLLAMA_ORIGINS='*' ollama serve`
2. **Kokoro-FastAPI** (optional, for TTS) — run a local Kokoro-compatible endpoint
3. **Whisper** (optional, for STT) — run a faster-whisper-server endpoint

Set the endpoints in **Settings → Offline**.

## Build for production

```bash
bun run build
```

This produces a TanStack Start production bundle. You can preview it locally:

```bash
bun run preview
```

## PWA install and offline behavior

- Open the production app in Chrome/Edge.
- Tap the **install icon** in the address bar or use **Add to Home Screen** on Android.
- The service worker caches the application shell and same-origin static assets. After the first successful online load, Alpha can reopen to its cached shell when offline.
- Offline mode does not make remote AI providers, Firebase cloud sync, or server routes available. Local browser data remains available; local Ollama/TTS/STT services work only if the device can reach those services.

## Exporting / importing your Alpha data

All your data (chat history, notes, reminders, memories, settings, and uploaded music) is stored locally in your browser. To move it to another device or back it up:

1. Go to **Settings → Alpha Data → Export / Import**.
2. Tap **Export Alpha data** to download a JSON backup.
3. On the new device, open Alpha and tap **Import Alpha data**.
4. Select the backup file.

## Cross-device reminders and scheduled push

Authenticated users' reminders, acknowledgement records, and notification-delivery history are mirrored to their UID-scoped Firestore collections. Local writes remain usable when offline and are reconciled when a server-backed Firestore snapshot becomes available. Cloud sync requires the configured Firebase project and deployed Firestore rules.

Background push delivery runs on the server, not in the browser. To enable it:

1. Configure a Web Push VAPID key pair. Set the public key as `VITE_VAPID_PUBLIC_KEY` at build time, and set the matching `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` as server-only runtime variables.
2. Set `FIREBASE_SERVICE_ACCOUNT_JSON` to a service-account JSON value, and set `FIRESTORE_DATABASE_ID` to the exact database ID in `firebase-applet-config.json`. The service account needs Firestore read/write access to user reminder, push-subscription, and server-owned push-delivery documents. Never commit this JSON or any private key.
3. Set a strong `ALPHA_CRON_SECRET` (at least 32 random characters) in the server environment.
4. In GitHub repository settings, add the repository variable `ALPHA_BASE_URL` (the deployed app origin, without a trailing slash) and the repository secret `ALPHA_CRON_SECRET` with the same value as the server secret.
5. The `Scheduled push delivery` GitHub Actions workflow calls `POST /api/push/cron` every five minutes. You can also invoke it from a trusted scheduler using `Authorization: Bearer <ALPHA_CRON_SECRET>`.

Users must sign in, grant browser notification permission, and enable **Background push** in Settings on each device. The server sends a generic reminder notification and does not include reminder notes. A successful subscription does not prove that the host's cron workflow or server credentials are configured; verify the scheduled workflow and a real device delivery after deployment.

## Moving from Lovable to your own host

Alpha uses a TanStack Start Node server, not a static-only export. Build with `npm run build` (or `bun run build`) and run the generated server with `npm run start` (or `bun run start`). Choose a host that supports the generated Node server and configure the server-only environment variables above. A static hosting target that serves only `.output/public` cannot run the scheduled push endpoint or server routes.

## Project structure

```text
src/
  routes/          # TanStack Start routes (pages)
  components/      # React components (Orb, HUD, CyberEye, etc.)
  lib/             # Core logic: store, AI calls, voice, vision, alarms
  styles.css       # Tailwind v4 + custom design tokens
  router.tsx       # Router setup
  server.ts        # SSR entry wrapper
public/            # Static assets: icons, manifest, images
```

## Need help?

If a build fails or a model returns errors, open **Settings → Online** and verify the API keys are pasted without quotes, spaces, or `Bearer` prefixes.
