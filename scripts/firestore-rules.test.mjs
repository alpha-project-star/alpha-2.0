const projectId = "demo-alpha-firestore-rules";
const firestoreBase = `http://127.0.0.1:8080/v1/projects/${projectId}/databases/(default)/documents`;
const authBase = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

function encodeValue(value) {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error("Unsupported Firestore test value");
}

function encodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)]));
}

async function signUp(email, password) {
  const response = await fetch(`${authBase}/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Auth emulator sign-up failed: ${response.status} ${await response.text()}`);
  const data = await response.json();
  if (!data.idToken) throw new Error("Auth emulator returned no ID token");
  return data.idToken;
}

async function request(method, path, token, data) {
  return fetch(`${firestoreBase}/${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify({ fields: encodeFields(data) }) } : {}),
  });
}

async function expectAllowed(promise, label) {
  const response = await promise;
  if (!response.ok) throw new Error(`${label}: expected success, received ${response.status}: ${await response.text()}`);
}

async function expectDenied(promise, label) {
  const response = await promise;
  if (response.ok) throw new Error(`${label}: expected Firestore rules to deny the request`);
}

const now = Date.now();
const reminder = (userId, id) => ({
  id, userId, title: "Test reminder", notes: "",
  dueAt: now + 60_000, createdAt: now, updatedAt: now,
  reminderState: "active", notificationState: "pending",
});
const acknowledgement = (userId, ackId) => ({
  ackId, eventId: "due_test_123", reminderId: "test", userId,
  channel: "in_app", status: "delivered", createdAt: now, updatedAt: now,
});
const subscription = (userId, subscriptionId, endpoint = "https://push.example.test/subscription") => ({
  subscriptionId, userId, endpoint,
  keys: { p256dh: "test-public-key", auth: "test-auth-key" },
  expirationTime: null, createdAt: now, updatedAt: now, userAgent: "rules-test",
});
const delivery = (userId, deliveryId) => ({
  deliveryId, eventId: "due_test_123", reminderId: "test", userId,
  messageId: "message_1", channel: "in_app", status: "delivered",
  createdAt: now, updatedAt: now, retryCount: 0, deliveredAt: now,
});

const [aliceToken, bobToken] = await Promise.all([
  signUp("alice@example.test", "TestPassword123!"),
  signUp("bob@example.test", "TestPassword123!"),
]);

await expectAllowed(
  request("PATCH", "users/alice/reminders/test", aliceToken, reminder("alice", "test")),
  "owner reminder create",
);
await expectAllowed(request("GET", "users/alice/reminders/test", aliceToken), "owner reminder read");
await expectDenied(request("GET", "users/bob/reminders/test", aliceToken), "cross-account reminder read");
await expectDenied(
  request("PATCH", "users/bob/reminders/forged", aliceToken, reminder("bob", "forged")),
  "cross-account reminder create",
);
await expectDenied(
  request("GET", "users/alice/reminders/test", null),
  "unauthenticated reminder read",
);

const ackId = "due_test_123:in_app:ack";
await expectAllowed(
  request("PATCH", `users/alice/acknowledgements/${ackId}`, aliceToken, acknowledgement("alice", ackId)),
  "owner acknowledgement create",
);
await expectDenied(
  request("PATCH", "users/alice/acknowledgements/forged", aliceToken, acknowledgement("bob", "forged")),
  "forged acknowledgement owner",
);

await expectAllowed(
  request("PATCH", "users/alice/pushSubscriptions/sub_1", aliceToken, subscription("alice", "sub_1")),
  "valid push subscription create",
);
await expectDenied(
  request("PATCH", "users/alice/pushSubscriptions/sub_bad", aliceToken,
    subscription("alice", "sub_bad", "http://not-secure.example.test/subscription")),
  "insecure push endpoint",
);
await expectDenied(
  request("PATCH", "users/bob/pushSubscriptions/sub_2", aliceToken, subscription("bob", "sub_2")),
  "cross-account push subscription create",
);

const deliveryId = "due_test_123:in_app";
await expectAllowed(
  request("PATCH", `users/alice/notificationDeliveries/${deliveryId}`, aliceToken, delivery("alice", deliveryId)),
  "owner notification delivery create",
);

// Seed a server-owned push marker with emulator admin credentials. Clients may
// read/delete their own markers for account wipe, but cannot forge/update them.
await expectAllowed(
  request("PATCH", "users/alice/pushDeliveries/server_only", "owner", {
    userId: "alice", status: "sent", eventId: "due_test_123",
  }),
  "admin seed push marker",
);
await expectAllowed(
  request("GET", "users/alice/pushDeliveries/server_only", aliceToken),
  "owner push marker read",
);
await expectDenied(
  request("PATCH", "users/alice/pushDeliveries/forged", aliceToken, {
    userId: "alice", status: "sent",
  }),
  "client push marker forgery",
);
await expectAllowed(
  request("DELETE", "users/alice/pushDeliveries/server_only", aliceToken),
  "owner push marker cleanup",
);

await expectAllowed(
  request("PATCH", "users/bob/reminders/private", bobToken, reminder("bob", "private")),
  "second owner reminder create",
);
await expectDenied(
  request("GET", "users/bob/reminders/private", aliceToken),
  "second cross-account reminder read",
);

console.log("Firestore rules emulator checks passed.");
