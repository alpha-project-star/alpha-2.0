import { afterEach, describe, expect, it, vi } from "vitest";

const { authMock, setDocMock, deleteDocMock, onSnapshotMock, collectionMock, docMock, storeUser, queuedDeletes, cloudState, enqueueDeleteMock, clearDeleteMock } = vi.hoisted(() => ({
  authMock: { currentUser: null as null | { uid: string; isAnonymous: boolean } },
  setDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
  onSnapshotMock: vi.fn(),
  collectionMock: vi.fn(),
  docMock: vi.fn(),
  storeUser: { value: "anonymous-user" },
  queuedDeletes: [] as Array<{ collectionName: string; id: string }>,
  cloudState: { records: { memories: [] as unknown[], notes: [] as unknown[], tasks: [] as unknown[], bills: [] as unknown[], goals: [] as unknown[] }, replaceAll: vi.fn() },
  enqueueDeleteMock: vi.fn(),
  clearDeleteMock: vi.fn(),
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: (auth: unknown, cb: (user: unknown) => void) => {
    cb(authMock.currentUser);
    return vi.fn();
  },
}));
vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => docMock(...args),
  setDoc: (...args: unknown[]) => setDocMock(...args),
  deleteDoc: (...args: unknown[]) => deleteDocMock(...args),
  onSnapshot: (...args: unknown[]) => onSnapshotMock(...args),
  collection: (...args: unknown[]) => collectionMock(...args),
  getDocs: vi.fn(),
  writeBatch: vi.fn(),
}));
vi.mock("../src/lib/firebase", () => ({ auth: authMock, db: {}, handleFirestoreError: vi.fn(), OperationType: {} }));
vi.mock("../src/lib/alpha-store", () => ({
  alphaStore: { get: () => cloudState.records, replaceAll: (...args: unknown[]) => cloudState.replaceAll(...args) },
  getQueuedCloudDeletes: () => [...queuedDeletes],
  clearQueuedCloudDelete: (...args: unknown[]) => clearDeleteMock(...args),
  enqueueCloudDelete: (...args: unknown[]) => enqueueDeleteMock(...args),
  getStorage: () => undefined,
  getKey: (key: string) => key,
  getCurrentStoreUser: () => storeUser.value,
  setStoreUser: vi.fn(),
}));
vi.mock("../src/lib/reminder-repo", () => ({}));
vi.mock("../src/lib/notification-acknowledgement", () => ({}));
vi.mock("../src/lib/notification-delivery", () => ({}));

import { deleteDocFromCloud, initCloudSync, syncDocToCloud } from "../src/lib/cloud-sync";
import { initReminderCloudSync, syncReminderToCloud } from "../src/lib/reminder-cloud-sync";
import { initNotificationCloudSync, syncAcknowledgementToCloud, syncDeliveryToCloud } from "../src/lib/notification-cloud-sync";

describe("anonymous cloud isolation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not upload or delete personal records for anonymous users", async () => {
    authMock.currentUser = { uid: "anonymous-user", isAnonymous: true };
    storeUser.value = "anonymous-user";

    expect(await syncDocToCloud("notes", "note-1", { id: "note-1" })).toBe(false);
    expect(await deleteDocFromCloud("notes", "note-1")).toBe(false);
    await syncReminderToCloud("anonymous-user", {
      id: "reminder-1", userId: "anonymous-user", title: "Local", notes: "",
      dueAt: 1000, createdAt: 1, updatedAt: 1, reminderState: "active", notificationState: "pending",
    } as never);
    await syncAcknowledgementToCloud("anonymous-user", { userId: "anonymous-user", ackId: "a" } as never);
    await syncDeliveryToCloud("anonymous-user", { userId: "anonymous-user", deliveryId: "d" } as never);

    expect(setDocMock).not.toHaveBeenCalled();
    expect(deleteDocMock).not.toHaveBeenCalled();
  });

  it("does not restore a cloud record while its local delete is queued", async () => {
    authMock.currentUser = { uid: "google-user", isAnonymous: false };
    storeUser.value = "google-user";
    queuedDeletes.splice(0, queuedDeletes.length, { collectionName: "notes", id: "deleted-note" });
    cloudState.records.notes = [];
    const callbacks: Array<(snapshot: unknown) => void> = [];
    collectionMock.mockImplementation((...parts: unknown[]) => parts.at(-1));
    onSnapshotMock.mockImplementation((_ref: unknown, callback: (snapshot: unknown) => void) => {
      callbacks.push(callback);
      return vi.fn();
    });
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });

    const stop = initCloudSync();
    const notesCallbackIndex = callbacks.findIndex((_callback, index) =>
      collectionMock.mock.results[index]?.value === "notes",
    );
    expect(notesCallbackIndex).toBeGreaterThanOrEqual(0);
    callbacks[notesCallbackIndex]({
      metadata: { fromCache: false },
      docs: [{ id: "deleted-note", data: () => ({ id: "deleted-note", userId: "google-user", title: "Old copy" }) }],
    });

    await vi.waitFor(() => expect(deleteDocMock).toHaveBeenCalled());
    expect(cloudState.replaceAll).not.toHaveBeenCalled();
    stop();
  });

  it("keeps a failed cloud delete queued for a later retry", async () => {
    authMock.currentUser = { uid: "google-user", isAnonymous: false };
    storeUser.value = "google-user";
    deleteDocMock.mockRejectedValueOnce(new Error("offline"));

    expect(await deleteDocFromCloud("notes", "note-1")).toBe(false);
    expect(enqueueDeleteMock).toHaveBeenCalledWith("google-user", "notes", "note-1");
    expect(clearDeleteMock).not.toHaveBeenCalled();
  });

  it("does not subscribe anonymous users to cloud collections", () => {
    authMock.currentUser = { uid: "anonymous-user", isAnonymous: true };
    storeUser.value = "anonymous-user";
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });

    const stopMain = initCloudSync();
    const stopReminders = initReminderCloudSync({} as never);
    const stopNotifications = initNotificationCloudSync({} as never, {} as never);

    expect(collectionMock).not.toHaveBeenCalled();
    expect(onSnapshotMock).not.toHaveBeenCalled();
    stopMain();
    stopReminders();
    stopNotifications();
  });
});
