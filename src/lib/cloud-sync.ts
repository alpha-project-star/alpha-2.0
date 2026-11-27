/**
 * Alpha Cloud Memory & Persistence Synchronizer
 * Connects Alpha's local-first state to Firestore with optimistic local updates,
 * background cloud backup, and cross-device sync.
 */

import { doc, setDoc, deleteDoc, onSnapshot, collection, getDocs, writeBatch } from "firebase/firestore";
import { onAuthStateChanged, User } from "firebase/auth";
import { db, auth, handleFirestoreError, OperationType } from "./firebase";
import { alphaStore, getStorage, getKey, getCurrentStoreUser, setStoreUser } from "./alpha-store";

let activeUnsubscribers: Array<() => void> = [];
let currentSyncedUid: string | null = null;
const pausedCloudSyncUids = new Set<string>();

/** Stable comparison so same-count remote edits are not silently ignored. */
function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

type SyncCollection = "memories" | "notes" | "tasks" | "bills" | "goals";
type SyncStateKey = "memories" | "notes" | "tasks" | "bills" | "goals";
type SyncMetadata = Partial<Record<SyncCollection, string[]>>;
const SYNC_METADATA_KEY = "alpha.cloudSync.v1";

function readSyncMetadata(uid: string): SyncMetadata {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(getKey(SYNC_METADATA_KEY, uid));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeSyncMetadata(uid: string, metadata: SyncMetadata): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(getKey(SYNC_METADATA_KEY, uid), JSON.stringify(metadata));
  } catch (error) {
    console.warn("[CloudSync] Could not persist sync metadata:", error);
  }
}

function markKnownRemoteId(uid: string, collectionName: SyncCollection, id: string): void {
  const metadata = readSyncMetadata(uid);
  const ids = new Set(metadata[collectionName] || []);
  ids.add(id);
  metadata[collectionName] = Array.from(ids);
  writeSyncMetadata(uid, metadata);
}

function unmarkKnownRemoteId(uid: string, collectionName: SyncCollection, id: string): void {
  const metadata = readSyncMetadata(uid);
  metadata[collectionName] = (metadata[collectionName] || []).filter((knownId) => knownId !== id);
  writeSyncMetadata(uid, metadata);
}

export async function syncDocToCloud(
  collectionName: SyncCollection,
  id: string,
  data: any
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.uid || !id || getCurrentStoreUser() !== user.uid ||
      pausedCloudSyncUids.has(user.uid)) return false;

  const uid = user.uid;
  const path = `users/${uid}/${collectionName}/${id}`;
  try {
    const source = data && typeof data === "object" ? data : {};
    const createdAt =
      typeof source.createdAt === "number" ? source.createdAt :
      typeof source.updatedAt === "number" ? source.updatedAt : Date.now();
    const payload: Record<string, unknown> = {
      ...source,
      id,
      userId: uid,
      createdAt,
    };

    if (collectionName === "memories") {
      const content = typeof source.content === "string"
        ? source.content
        : [source.topic, source.detail].filter((part) => typeof part === "string" && part.length > 0).join("\n");
      if (!content || content.length > 10000) throw new Error("Memory content is empty or exceeds the 10,000 character cloud limit.");
      payload.content = content;
    } else if (collectionName === "notes") {
      const content = typeof source.content === "string"
        ? source.content
        : [source.title, source.body].filter((part) => typeof part === "string" && part.length > 0).join("\n\n");
      if (!content || content.length > 20000) throw new Error("Note content is empty or exceeds the 20,000 character cloud limit.");
      payload.content = content;
    } else if (collectionName === "tasks" || collectionName === "goals") {
      if (typeof source.title !== "string" || !source.title.trim() || source.title.length > 1000) {
        throw new Error("Task/goal title is missing or exceeds the 1,000 character cloud limit.");
      }
    } else if (collectionName === "bills") {
      const description = typeof source.description === "string" ? source.description : source.name;
      const amount = Number(source.amount ?? 0);
      if (typeof description !== "string" || !description.trim() || description.length > 1000 || !Number.isFinite(amount)) {
        throw new Error("Bill description or amount is invalid for cloud storage.");
      }
      payload.description = description;
      payload.amount = amount;
    }

    await setDoc(doc(db, "users", uid, collectionName, id), payload, { merge: true });
    markKnownRemoteId(uid, collectionName, id);
    return true;
  } catch (err: any) {
    console.warn(`[CloudSync] Background sync to ${path} failed:`, err?.message || err);
    return false;
  }
}

export async function deleteDocFromCloud(
  collectionName: SyncCollection,
  id: string
): Promise<boolean> {
  const user = auth.currentUser;
  if (!user || !user.uid || !id || getCurrentStoreUser() !== user.uid ||
      pausedCloudSyncUids.has(user.uid)) return false;

  const uid = user.uid;
  const path = `users/${uid}/${collectionName}/${id}`;
  try {
    await deleteDoc(doc(db, "users", uid, collectionName, id));
    unmarkKnownRemoteId(uid, collectionName, id);
    return true;
  } catch (err: any) {
    console.warn(`[CloudSync] Background delete from ${path} failed:`, err?.message || err);
    return false;
  }
}


/**
 * Deletes the signed-in user's cloud-owned Alpha collections in bounded batches.
 * This is deliberately UID-bound and refuses to act for a different auth user.
 */
export function pauseCloudSyncForAccount(uid: string): void {
  pausedCloudSyncUids.add(uid);
}

export function resumeCloudSyncForAccount(uid: string): void {
  pausedCloudSyncUids.delete(uid);
}

export async function wipeAccountCloudData(uid: string): Promise<void> {
  const user = auth.currentUser;
  if (!uid || !user || user.uid !== uid || getCurrentStoreUser() !== uid) {
    throw new Error("Cloud wipe refused: the active account does not match the requested UID.");
  }

  const collectionsToClear = [
    "memories",
    "notes",
    "tasks",
    "bills",
    "goals",
    "reminders",
    "acknowledgements",
    "notificationDiagnostics",
    "pushSubscriptions",
    "notificationDeliveries",
    "pushDeliveries",
  ];

  for (const collectionName of collectionsToClear) {
    const snapshot = await getDocs(collection(db, "users", uid, collectionName));
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = writeBatch(db);
      snapshot.docs.slice(offset, offset + 400).forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }

  await deleteDoc(doc(db, "users", uid, "migration", "state"));
}

export function initCloudSync(): () => void {
  if (typeof window === "undefined") return () => {};

  const unsubscribeAuth = onAuthStateChanged(auth, (user: User | null) => {
    setStoreUser(user?.uid ?? null);
    activeUnsubscribers.forEach((unsubscribe) => {
      try { unsubscribe(); } catch {}
    });
    activeUnsubscribers = [];

    if (!user?.uid) {
      currentSyncedUid = null;
      return;
    }

    const uid = user.uid;
    currentSyncedUid = uid;

    const collections: Array<{ name: SyncCollection; stateKey: SyncStateKey }> = [
      { name: "memories", stateKey: "memories" },
      { name: "notes", stateKey: "notes" },
      { name: "tasks", stateKey: "tasks" },
      { name: "bills", stateKey: "bills" },
      { name: "goals", stateKey: "goals" },
    ];

    for (const entry of collections) {
      const collectionPath = `users/${uid}/${entry.name}`;
      try {
        const unsubscribe = onSnapshot(
          collection(db, "users", uid, entry.name),
          (snapshot) => {
            // A cache-only empty snapshot is not proof that the server collection
            // is empty; wait for a server-backed snapshot before reconciling.
            if (getCurrentStoreUser() !== uid || pausedCloudSyncUids.has(uid) || snapshot.metadata.fromCache) return;

            const cloudItems = snapshot.docs.map((document) => ({
              ...document.data(),
              id: document.id,
              userId: uid,
            })) as Array<{ id: string; userId: string; [key: string]: unknown }>;
            const cloudById = new Map(cloudItems.map((item) => [item.id, item]));
            const localItems = (alphaStore.get()[entry.stateKey] || []) as Array<{ id: string; [key: string]: unknown }>;
            const metadata = readSyncMetadata(uid);
            const knownIds = new Set(metadata[entry.name] || []);
            const mergedById = new Map<string, any>();

            // A locally present ID previously known to exist remotely but now
            // absent from the server has been deleted elsewhere. Do not resurrect it.
            for (const localItem of localItems) {
              if (cloudById.has(localItem.id)) continue;
              if (knownIds.has(localItem.id)) continue;
              mergedById.set(localItem.id, localItem);
              void syncDocToCloud(entry.name, localItem.id, localItem);
            }

            // Resolve concurrent edits with deterministic last-write-wins.
            // Both local mutation paths and cloud documents carry updatedAt; use
            // createdAt only as a legacy fallback. Equal/missing timestamps keep
            // the server copy, so replicas converge deterministically.
            const syncTimestamp = (item: Record<string, unknown>): number => {
              if (typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt)) {
                return item.updatedAt;
              }
              if (typeof item.createdAt === "number" && Number.isFinite(item.createdAt)) {
                return item.createdAt;
              }
              return 0;
            };

            for (const cloudItem of cloudItems) {
              const localItem = localItems.find((item) => item.id === cloudItem.id);
              if (localItem && syncTimestamp(localItem) > syncTimestamp(cloudItem)) {
                mergedById.set(localItem.id, localItem);
                // Reconcile the newer local winner back to Firestore. The
                // subsequent snapshot will converge because timestamps match.
                void syncDocToCloud(entry.name, localItem.id, localItem);
              } else {
                mergedById.set(cloudItem.id, cloudItem);
              }
            }

            const merged = Array.from(mergedById.values());
            const nextMetadata: SyncMetadata = {
              ...metadata,
              [entry.name]: cloudItems.map((item) => item.id),
            };
            writeSyncMetadata(uid, nextMetadata);

            if (stableSerialize(merged) !== stableSerialize(localItems)) {
              void alphaStore.replaceAll({ [entry.stateKey]: merged });
            }
          },
          (error) => handleFirestoreError(error, OperationType.LIST, collectionPath)
        );
        activeUnsubscribers.push(unsubscribe);
      } catch (error) {
        console.warn(`[CloudSync] Failed to initialize ${entry.name} listener:`, error);
      }
    }
  });

  return () => {
    unsubscribeAuth();
    activeUnsubscribers.forEach((unsubscribe) => {
      try { unsubscribe(); } catch {}
    });
    activeUnsubscribers = [];
    currentSyncedUid = null;
  };
}
