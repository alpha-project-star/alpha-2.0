import { onAuthStateChanged } from "firebase/auth";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getCurrentStoreUser, getKey, getStorage } from "./alpha-store";
import type { FirestoreReminder, ReminderRepository } from "./reminder-repo";

const REMOTE_IDS_PREFIX = "alpha.reminderCloudIds.v1";
const applyingRemote = new Set<string>();
const pausedAccounts = new Set<string>();

export function pauseReminderCloudSyncForAccount(userId: string): void {
  if (userId) pausedAccounts.add(userId);
}

export function resumeReminderCloudSyncForAccount(userId: string): void {
  pausedAccounts.delete(userId);
}

function readKnownIds(userId: string): Set<string> {
  try {
    const raw = getStorage()?.getItem(getKey(REMOTE_IDS_PREFIX, userId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function writeKnownIds(userId: string, ids: Set<string>): void {
  try {
    getStorage()?.setItem(getKey(REMOTE_IDS_PREFIX, userId), JSON.stringify(Array.from(ids)));
  } catch (error) {
    console.warn("[ReminderCloudSync] Could not persist remote reminder IDs:", error);
  }
}

function isReminderDocument(value: unknown, id: string, userId: string): value is FirestoreReminder {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.id === id &&
    item.userId === userId &&
    typeof item.title === "string" &&
    typeof item.notes === "string" &&
    typeof item.dueAt === "number" && Number.isFinite(item.dueAt) &&
    typeof item.createdAt === "number" && Number.isFinite(item.createdAt) &&
    typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt) &&
    ["active", "completed", "cancelled", "passed", "acknowledged"].includes(String(item.reminderState)) &&
    ["pending", "claimed", "accepted", "failed"].includes(String(item.notificationState));
}

function timestamp(item: FirestoreReminder): number {
  return Number.isFinite(item.updatedAt) ? item.updatedAt : item.createdAt;
}

/** Best-effort cloud mirror; local persistence remains available while offline. */
export async function syncReminderToCloud(userId: string, reminder: FirestoreReminder): Promise<void> {
  const user = auth.currentUser;
  if (!user || user.uid !== userId || getCurrentStoreUser() !== userId ||
      applyingRemote.has(userId) || pausedAccounts.has(userId)) return;
  try {
    await setDoc(doc(db, "users", userId, "reminders", reminder.id), {
      ...reminder,
      id: reminder.id,
      userId,
    }, { merge: true });
    const known = readKnownIds(userId);
    known.add(reminder.id);
    writeKnownIds(userId, known);
  } catch (error) {
    console.warn("[ReminderCloudSync] Reminder remains local; cloud write failed:", error);
  }
}

export async function deleteReminderFromCloud(userId: string, reminderId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user || user.uid !== userId || getCurrentStoreUser() !== userId || applyingRemote.has(userId)) return;
  try {
    await deleteDoc(doc(db, "users", userId, "reminders", reminderId));
    const known = readKnownIds(userId);
    known.delete(reminderId);
    writeKnownIds(userId, known);
  } catch (error) {
    console.warn("[ReminderCloudSync] Reminder deletion remains local; cloud delete failed:", error);
  }
}

/**
 * Synchronizes reminders for the authenticated UID. A server-backed snapshot
 * merges by updatedAt; previously-known remote deletions are not resurrected.
 */
export function initReminderCloudSync(repository: ReminderRepository): () => void {
  if (typeof window === "undefined") return () => {};

  let unsubscribeSnapshot: (() => void) | undefined;
  let generation = 0;
  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    generation += 1;
    const activeGeneration = generation;
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = undefined;
    if (!user?.uid) return;

    const uid = user.uid;
    unsubscribeSnapshot = onSnapshot(
      collection(db, "users", uid, "reminders"),
      (snapshot) => {
        if (
          activeGeneration !== generation ||
          getCurrentStoreUser() !== uid ||
          auth.currentUser?.uid !== uid ||
          pausedAccounts.has(uid) ||
          snapshot.metadata.fromCache
        ) return;

        void (async () => {
          const cloudItems = snapshot.docs
            .map((document) => {
              const data = document.data();
              return isReminderDocument(data, document.id, uid) ? data : null;
            })
            .filter((item): item is FirestoreReminder => item !== null);
          const cloudById = new Map(cloudItems.map((item) => [item.id, item]));
          const localItems = await repository.listReminders(uid);
          const known = readKnownIds(uid);
          const merged = new Map<string, FirestoreReminder>();

          for (const local of localItems) {
            const remote = cloudById.get(local.id);
            if (remote) {
              if (timestamp(local) > timestamp(remote)) {
                merged.set(local.id, local);
                void syncReminderToCloud(uid, local);
              } else {
                merged.set(remote.id, remote);
              }
            } else if (!known.has(local.id)) {
              // This is a local-only record not yet observed in Firestore.
              merged.set(local.id, local);
              void syncReminderToCloud(uid, local);
            }
            // A previously-known ID absent from a server snapshot is a remote
            // deletion; do not reintroduce the stale local copy.
          }

          for (const remote of cloudItems) merged.set(remote.id, remote);

          applyingRemote.add(uid);
          try {
            await repository.replaceReminders(uid, Array.from(merged.values()));
          } finally {
            applyingRemote.delete(uid);
          }

          // Only IDs confirmed by a server-backed snapshot are considered
          // previously remote. syncReminderToCloud records newly uploaded IDs
          // after successful writes, so failed offline uploads stay recoverable.
          const nextKnown = new Set(cloudItems.map((item) => item.id));
          writeKnownIds(uid, nextKnown);
        })().catch((error) => {
          console.error("[ReminderCloudSync] Snapshot reconciliation failed:", error);
        });
      },
      (error) => console.warn("[ReminderCloudSync] Firestore listener failed:", error),
    );
  });

  return () => {
    generation += 1;
    unsubscribeAuth();
    unsubscribeSnapshot?.();
    unsubscribeSnapshot = undefined;
  };
}
