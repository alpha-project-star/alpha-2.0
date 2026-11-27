# Alpha production deployment checklist

This checklist separates repository readiness from account-owned production configuration. Do not mark a capability live until the corresponding external check has passed.

## 1. Hosting

- [ ] Confirm the intended hosting provider and production project.
- [ ] Connect `alpha-project-star/alpha-2.0` to that project and deploy the `main` branch.
- [ ] Use the repository's `vercel.json` / Nitro configuration, or the Node start command `npm run start`; do not publish only the static `.output/public` directory.
- [ ] Confirm the production origin serves the app over HTTPS.
- [ ] Confirm a deep link such as `/reminders` loads directly and the server route `/api/push/cron` responds (without credentials it should return 401 or 503, never expose diagnostics).

## 2. Firebase

The client configuration is in `firebase-applet-config.json`. Verify that the project and database are the intended production resources before changing anything.

- [ ] Confirm Firebase Authentication providers are enabled and sign-in works.
- [ ] Deploy `firestore.rules` to the exact Firestore database configured in `firebase-applet-config.json`.
- [ ] Verify the signed-in user can create, update, and delete only their own records.
- [ ] Verify a second account cannot read or modify the first account's records.
- [ ] Verify reminders, notes, memories, tasks, bills, goals, and notification history synchronize across two signed-in devices.
- [ ] Confirm legacy local-only records remain recoverable through export/import.

Do not replace, delete, or migrate the configured Firestore database as part of deployment verification.

## 3. Scheduled Web Push

Configure the following as server-only host environment variables:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_PROJECT_ID` (only when overriding the service-account project)
- `FIRESTORE_DATABASE_ID`
- `ALPHA_CRON_SECRET` (at least 32 random characters)

The public VAPID key must also be supplied as `VITE_VAPID_PUBLIC_KEY` at build time and must match the private-key pair.

In GitHub repository settings configure:

- Repository variable `ALPHA_BASE_URL`: production HTTPS origin, with no path.
- Repository secret `ALPHA_CRON_SECRET`: exactly the same value as the server secret.

Then:

- [ ] Run **Scheduled push delivery** manually from GitHub Actions and confirm the request succeeds.
- [ ] Confirm scheduled executions occur every five minutes.
- [ ] Sign in on a real Android/desktop browser, grant notification permission, enable **Background push**, and verify a due reminder arrives while Alpha is not in the foreground.
- [ ] Verify the notification opens `/reminders`.
- [ ] Verify expired subscriptions are handled and delivery history is visible on another signed-in device.

The workflow intentionally warns and skips scheduled delivery when its repository variable/secret are absent. A manual run or release-triggered run fails clearly when required GitHub configuration is missing.

## 4. Release verification

- [ ] CI passes on the exact release commit: Firestore emulator rules, typecheck, lint, tests, and production build.
- [ ] Production smoke tests pass on mobile and desktop.
- [ ] Offline shell opens after one successful online visit; remote AI, Firebase, and server routes are correctly unavailable offline.
- [ ] No production secrets are committed to Git.
- [ ] Record the production URL, release commit SHA, deployment timestamp, and any remaining limitations.

## Current release gate

Repository CI passing is necessary but not sufficient. Hosting, Firebase project configuration, GitHub Actions variables/secrets, and real-device notification delivery must be verified in their respective accounts before Alpha can be called production-ready.
