import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc } from "firebase/firestore";

const projectId = "demo-alpha-firestore-rules";
const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules },
});

const now = Date.now();
const reminder = (userId, id) => ({
  id,
  userId,
  title: "Test reminder",
  notes: "",
  dueAt: now + 60_000,
  createdAt: now,
  updatedAt: now,
  reminderState: "active",
  notificationState: "pending",
});
const acknowledgement = (userId, ackId) => ({
  ackId,
  eventId: "due_test_123",
  reminderId: "test",
  userId,
  channel: "in_app",
  status: "delivered",
  createdAt: now,
  updatedAt: now,
});
const subscription = (userId, subscriptionId, endpoint = "https://push.example.test/subscription") => ({
  subscriptionId,
  userId,
  endpoint,
  keys: { p256dh: "test-public-key", auth: "test-auth-key" },
  expirationTime: null,
  createdAt: now,
  updatedAt: now,
  userAgent: "rules-test",
});
const delivery = (userId, deliveryId) => ({
  deliveryId,
  eventId: "due_test_123",
  reminderId: "test",
  userId,
  messageId: "message_1",
  channel: "in_app",
  status: "delivered",
  createdAt: now,
  updatedAt: now,
  retryCount: 0,
  deliveredAt: now,
});

try {
  const alice = testEnv.authenticatedContext("alice").firestore();
  const bob = testEnv.authenticatedContext("bob").firestore();
  const anonymous = testEnv.unauthenticatedContext().firestore();

  await assertSucceeds(setDoc(doc(alice, "users/alice/reminders/test"), reminder("alice", "test")));
  await assertSucceeds(getDoc(doc(alice, "users/alice/reminders/test")));
  await assertFails(getDoc(doc(alice, "users/bob/reminders/test")));
  await assertFails(setDoc(doc(alice, "users/bob/reminders/forged"), reminder("bob", "forged")));
  await assertFails(setDoc(doc(anonymous, "users/alice/reminders/anonymous"), reminder("alice", "anonymous")));

  const ackId = "due_test_123:in_app:ack";
  await assertSucceeds(setDoc(doc(alice, `users/alice/acknowledgements/${ackId}`), acknowledgement("alice", ackId)));
  await assertFails(setDoc(doc(alice, "users/alice/acknowledgements/forged"), acknowledgement("bob", "forged")));

  await assertSucceeds(setDoc(
    doc(alice, "users/alice/pushSubscriptions/sub_1"),
    subscription("alice", "sub_1"),
  ));
  await assertFails(setDoc(
    doc(alice, "users/alice/pushSubscriptions/sub_bad"),
    subscription("alice", "sub_bad", "http://not-secure.example.test/subscription"),
  ));
  await assertFails(setDoc(
    doc(alice, "users/bob/pushSubscriptions/sub_2"),
    subscription("bob", "sub_2"),
  ));

  await assertSucceeds(setDoc(
    doc(alice, "users/alice/notificationDeliveries/due_test_123:in_app"),
    delivery("alice", "due_test_123:in_app"),
  ));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "users/alice/pushDeliveries/server_only"), {
      userId: "alice",
      status: "sent",
      eventId: "due_test_123",
    });
  });
  await assertSucceeds(getDoc(doc(alice, "users/alice/pushDeliveries/server_only")));
  await assertFails(setDoc(
    doc(alice, "users/alice/pushDeliveries/forged"),
    { userId: "alice", status: "sent" },
  ));
  await assertSucceeds(deleteDoc(doc(alice, "users/alice/pushDeliveries/server_only")));

  await assertSucceeds(setDoc(
    doc(bob, "users/bob/reminders/private"),
    reminder("bob", "private"),
  ));
  await assertFails(getDoc(doc(alice, "users/bob/reminders/private")));

  console.log("Firestore rules emulator checks passed.");
} finally {
  await testEnv.cleanup();
}
