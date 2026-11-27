import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { processDuePushReminders } from "../lib/push-sender.server";

function isAuthorized(request: Request): boolean {
  const expected = process.env.ALPHA_CRON_SECRET;
  if (!expected || expected.length < 32) return false;
  const supplied = request.headers.get("authorization") || "";
  const prefix = "Bearer ";
  if (!supplied.startsWith(prefix)) return false;
  const candidate = Buffer.from(supplied.slice(prefix.length));
  const secret = Buffer.from(expected);
  return candidate.length === secret.length && timingSafeEqual(candidate, secret);
}

async function handleScheduledPush(request: Request): Promise<Response> {
  if (!process.env.ALPHA_CRON_SECRET || process.env.ALPHA_CRON_SECRET.length < 32) {
    return Response.json({ error: "Scheduled push delivery is not configured" }, { status: 503 });
  }
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processDuePushReminders();
    return Response.json({ success: true, ...result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[PushCron] Scheduled delivery failed:", error);
    return Response.json({ error: "Scheduled push delivery failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/push/cron")({
  server: {
    handlers: {
      GET: async ({ request }) => handleScheduledPush(request),
      POST: async ({ request }) => handleScheduledPush(request),
    },
  },
});
