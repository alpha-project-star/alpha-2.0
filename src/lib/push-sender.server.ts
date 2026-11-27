// src/lib/push-sender.server.ts
// Server-only push notification sender (.server.ts boundary prevents client bundling).

if (typeof window !== 'undefined') {
  throw new Error('[Server Boundary Violation] push-sender.server must only be executed in a server environment.');
}

import webPush from 'web-push';
import { createHash, createSign } from 'node:crypto';

export interface PushPayload {
  type?: string;
  eventId: string;
  reminderId: string;
  userId: string;
  title: string;
  body: string;
  url?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface PushSendResult {
  success: boolean;
  endpoint: string;
  status: 'sent' | 'expired' | 'failed' | 'transient_failure';
  statusCode?: number;
  error?: string;
}

export async function sendWebPushToSubscription(
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userId: string;
  },
  payload: PushPayload
): Promise<PushSendResult> {
  if (!payload.userId || subscription.userId !== payload.userId) {
    return {
      success: false,
      endpoint: subscription.endpoint,
      status: 'failed',
      error: 'Push delivery refused: subscription owner does not match the reminder owner',
    };
  }
  if (!subscription.endpoint.startsWith('https://') ||
      !subscription.keys?.p256dh || !subscription.keys?.auth ||
      !payload.eventId || !payload.reminderId) {
    return {
      success: false,
      endpoint: subscription.endpoint,
      status: 'failed',
      error: 'Push delivery refused: subscription or event data is invalid',
    };
  }

  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || 'mailto:admin@alpha.app';

  if (!publicKey || !privateKey) {
    return {
      success: false,
      endpoint: subscription.endpoint,
      status: 'failed',
      error: 'VAPID public or private key is not configured on the server',
    };
  }

  try {
    webPush.setVapidDetails(subject, publicKey, privateKey);

    const pushSub = {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    };

    const payloadString = JSON.stringify({
      type: payload.type || 'alpha_notification',
      eventId: payload.eventId,
      reminderId: payload.reminderId,
      title: String(payload.title || 'Alpha Reminder').slice(0, 120),
      body: String(payload.body || '').slice(0, 1000),
      url: payload.url || '/',
      metadata: payload.metadata,
    });

    await webPush.sendNotification(pushSub, payloadString);

    return {
      success: true,
      endpoint: subscription.endpoint,
      status: 'sent',
    };
  } catch (err: any) {
    const statusCode = err?.statusCode || err?.status || 500;
    // 404 Not Found or 410 Gone indicates subscription has expired / become invalid
    if (statusCode === 404 || statusCode === 410) {
      return {
        success: false,
        endpoint: subscription.endpoint,
        status: 'expired',
        statusCode,
        error: 'Subscription has expired or is invalid (404/410)',
      };
    }

    const isTransient = statusCode >= 500 || statusCode === 429;
    return {
      success: false,
      endpoint: subscription.endpoint,
      status: isTransient ? 'transient_failure' : 'failed',
      statusCode,
      error: err?.message || 'Web push send failed',
    };
  }
}


type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

type FirestoreDocument = {
  name: string;
  fields?: Record<string, unknown>;
  updateTime?: string;
};

let cachedGoogleToken: { value: string; expiresAt: number } | null = null;

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function getFirebaseServiceAccount(): FirebaseServiceAccount {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  const account = JSON.parse(raw) as Partial<FirebaseServiceAccount>;
  if (!account.project_id || !account.client_email || !account.private_key) {
    throw new Error("Firebase service account JSON is missing project_id, client_email, or private_key");
  }
  return account as FirebaseServiceAccount;
}

async function getGoogleAccessToken(account: FirebaseServiceAccount): Promise<string> {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleToken.value;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = header + "." + claims;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = unsigned + "." + signer.sign(account.private_key, "base64url");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error("Google service-account token exchange failed with status " + response.status);
  }
  const token = await response.json() as { access_token?: string; expires_in?: number };
  if (!token.access_token) throw new Error("Google token exchange returned no access token");
  cachedGoogleToken = {
    value: token.access_token,
    expiresAt: Date.now() + Math.max(60, token.expires_in || 3600) * 1000,
  };
  return token.access_token;
}

function firestoreBaseUrl(account: FirebaseServiceAccount): string {
  const projectId = process.env.FIREBASE_PROJECT_ID || account.project_id;
  const databaseId = process.env.FIRESTORE_DATABASE_ID;
  if (!databaseId) throw new Error("FIRESTORE_DATABASE_ID is not configured");
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(databaseId)}/documents`;
}

async function firestoreRequest(
  baseUrl: string,
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${baseUrl}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
}

function decodeFirestoreValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, any>;
  if ("stringValue" in item) return item.stringValue;
  if ("integerValue" in item) return Number(item.integerValue);
  if ("doubleValue" in item) return Number(item.doubleValue);
  if ("booleanValue" in item) return item.booleanValue;
  if ("nullValue" in item) return null;
  if ("timestampValue" in item) return Date.parse(item.timestampValue);
  if ("arrayValue" in item) return (item.arrayValue?.values || []).map(decodeFirestoreValue);
  if ("mapValue" in item) return decodeFirestoreFields(item.mapValue?.fields || {});
  return undefined;
}

function decodeFirestoreFields(fields: Record<string, unknown>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]));
}

function encodeFirestoreValue(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFirestoreFields(value as Record<string, unknown>) } };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, encodeFirestoreValue(value)]));
}

async function getFirestoreDocument(
  baseUrl: string,
  token: string,
  path: string,
): Promise<FirestoreDocument | null> {
  const response = await firestoreRequest(baseUrl, token, path);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Firestore document read failed with status " + response.status);
  return await response.json() as FirestoreDocument;
}

async function patchFirestoreDocument(
  baseUrl: string,
  token: string,
  path: string,
  fields: Record<string, unknown>,
  precondition: { exists: false } | { updateTime: string },
): Promise<FirestoreDocument> {
  const url = new URL(`${baseUrl}/${path}`);
  if ("exists" in precondition) url.searchParams.set("currentDocument.exists", "false");
  else url.searchParams.set("currentDocument.updateTime", precondition.updateTime);

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: encodeFirestoreFields(fields) }),
  });
  if (!response.ok) {
    const error = new Error("Firestore conditional write failed with status " + response.status);
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }
  return await response.json() as FirestoreDocument;
}

async function deleteFirestoreDocument(baseUrl: string, token: string, path: string): Promise<void> {
  const response = await firestoreRequest(baseUrl, token, path, { method: "DELETE" });
  if (!response.ok && response.status !== 404) {
    throw new Error("Firestore document delete failed with status " + response.status);
  }
}

async function listUserPushSubscriptions(
  baseUrl: string,
  token: string,
  userId: string,
): Promise<Array<{ subscriptionId: string; userId: string; endpoint: string; keys: { p256dh: string; auth: string } }>> {
  const records: Array<{ subscriptionId: string; userId: string; endpoint: string; keys: { p256dh: string; auth: string } }> = [];
  let pageToken = "";
  for (let page = 0; page < 5; page += 1) {
    const url = new URL(`${baseUrl}/users/${encodeURIComponent(userId)}/pushSubscriptions`);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error("Firestore push subscription query failed with status " + response.status);
    const result = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string };
    for (const document of result.documents || []) {
      const decoded = decodeFirestoreFields(document.fields || {});
      if (decoded.userId !== userId || typeof decoded.endpoint !== "string" ||
          typeof decoded.keys?.p256dh !== "string" || typeof decoded.keys?.auth !== "string") continue;
      records.push({
        subscriptionId: String(decoded.subscriptionId || document.name.split("/").pop() || ""),
        userId,
        endpoint: decoded.endpoint,
        keys: { p256dh: decoded.keys.p256dh, auth: decoded.keys.auth },
      });
    }
    pageToken = result.nextPageToken || "";
    if (!pageToken) break;
  }
  return records;
}

async function claimPushDelivery(
  baseUrl: string,
  token: string,
  userId: string,
  eventId: string,
  reminderId: string,
  subscriptionId: string,
): Promise<{ path: string; updateTime: string } | null> {
  const digest = createHash("sha256").update(`${eventId}:${subscriptionId}`).digest("hex");
  const path = `users/${encodeURIComponent(userId)}/pushDeliveries/${digest}`;
  const existing = await getFirestoreDocument(baseUrl, token, path);
  const previous = existing ? decodeFirestoreFields(existing.fields || {}) : null;
  const now = Date.now();

  if (previous?.status === "sent") return null;
  if (previous?.status === "processing" && typeof previous.updatedAt === "number" &&
      now - previous.updatedAt < 5 * 60_000) return null;

  const fields = {
    userId,
    eventId,
    reminderId,
    subscriptionId,
    status: "processing",
    attempts: Number(previous?.attempts || 0) + 1,
    createdAt: Number(previous?.createdAt || now),
    updatedAt: now,
  };

  try {
    const claimed = await patchFirestoreDocument(
      baseUrl,
      token,
      path,
      fields,
      existing?.updateTime ? { updateTime: existing.updateTime } : { exists: false },
    );
    if (!claimed.updateTime) throw new Error("Firestore did not return a push-delivery claim version");
    return { path, updateTime: claimed.updateTime };
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status === 409 || status === 412) return null;
    throw error;
  }
}

/**
 * Scheduled server-side delivery. Requires a Firebase service account with
 * Firestore access and VAPID credentials in server environment variables.
 * It never generates AI content or sends reminder notes; push copy is minimal.
 */
export async function processDuePushReminders(now = Date.now()): Promise<{
  scanned: number;
  attempted: number;
  sent: number;
  expired: number;
  failed: number;
}> {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured before scheduled push delivery can run");
  }
  const account = getFirebaseServiceAccount();
  const token = await getGoogleAccessToken(account);
  const baseUrl = firestoreBaseUrl(account);
  const queryResponse = await fetch(`${baseUrl}:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "reminders", allDescendants: true }],
        where: {
          fieldFilter: {
            field: { fieldPath: "dueAt" },
            op: "LESS_THAN_OR_EQUAL",
            value: { integerValue: String(Math.floor(now)) },
          },
        },
        orderBy: [{ field: { fieldPath: "dueAt" }, direction: "ASCENDING" }],
        limit: 500,
      },
    }),
  });
  if (!queryResponse.ok) {
    throw new Error("Firestore due-reminder query failed with status " + queryResponse.status);
  }

  const queryRows = await queryResponse.json() as Array<{ document?: FirestoreDocument }>;
  const due: Array<{ userId: string; reminderId: string; eventId: string; title: string }> = [];
  for (const row of queryRows) {
    const document = row.document;
    if (!document?.name) continue;
    const parts = document.name.split("/documents/")[1]?.split("/") || [];
    if (parts.length !== 4 || parts[0] !== "users" || parts[2] !== "reminders") continue;
    const userId = parts[1];
    const reminderId = parts[3];
    const data = decodeFirestoreFields(document.fields || {});
    if (data.userId !== userId || data.id !== reminderId || data.reminderState !== "active" ||
        typeof data.dueAt !== "number" || data.dueAt > now || typeof data.title !== "string") continue;

    const occurrenceAt = typeof data.nextRepeatAt === "number" && data.nextRepeatAt <= now
      ? data.nextRepeatAt
      : data.dueAt;
    if (typeof data.nextRepeatAt === "number" && data.nextRepeatAt > now) continue;
    due.push({
      userId,
      reminderId,
      eventId: `due_${reminderId}_${occurrenceAt}`,
      title: data.title.slice(0, 120),
    });
  }

  const counts = { scanned: due.length, attempted: 0, sent: 0, expired: 0, failed: 0 };
  const subscriptionCache = new Map<string, Awaited<ReturnType<typeof listUserPushSubscriptions>>>();

  for (const reminder of due) {
    let subscriptions = subscriptionCache.get(reminder.userId);
    if (!subscriptions) {
      subscriptions = await listUserPushSubscriptions(baseUrl, token, reminder.userId);
      subscriptionCache.set(reminder.userId, subscriptions);
    }

    for (const subscription of subscriptions) {
      const claim = await claimPushDelivery(
        baseUrl, token, reminder.userId, reminder.eventId, reminder.reminderId, subscription.subscriptionId,
      );
      if (!claim) continue;
      counts.attempted += 1;

      const result = await sendWebPushToSubscription(subscription, {
        eventId: reminder.eventId,
        reminderId: reminder.reminderId,
        userId: reminder.userId,
        title: reminder.title || "Alpha Reminder",
        body: "A reminder is due.",
        url: "/reminders",
      });

      const status = result.status === "sent" ? "sent" : result.status;
      try {
        await patchFirestoreDocument(baseUrl, token, claim.path, {
          userId: reminder.userId,
          eventId: reminder.eventId,
          reminderId: reminder.reminderId,
          subscriptionId: subscription.subscriptionId,
          status,
          updatedAt: Date.now(),
          ...(result.statusCode ? { statusCode: result.statusCode } : {}),
          ...(result.error ? { error: result.error.slice(0, 500) } : {}),
        }, { updateTime: claim.updateTime });
      } catch (error) {
        console.warn("[PushSender] Could not persist delivery result:", error);
      }

      if (result.status === "sent") {
        counts.sent += 1;
      } else if (result.status === "expired") {
        counts.expired += 1;
        await deleteFirestoreDocument(
          baseUrl,
          token,
          `users/${encodeURIComponent(reminder.userId)}/pushSubscriptions/${encodeURIComponent(subscription.subscriptionId)}`,
        ).catch(() => undefined);
      } else {
        counts.failed += 1;
      }
    }
  }

  return counts;
}
