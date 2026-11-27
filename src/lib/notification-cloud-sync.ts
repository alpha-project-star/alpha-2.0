import { onAuthStateChanged } from "firebase/auth";
import { collection, doc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { getCurrentStoreUser } from "./alpha-store";
import type { AcknowledgementRecord, AcknowledgementRepository } from "./notification-acknowledgement";
import type { DeliveryRecord, DeliveryRepository } from "./notification-delivery";

type ReplaceableAcknowledgements = AcknowledgementRepository & {
  replaceAllFromCloud?: (userId: string, records: AcknowledgementRecord[]) => Promise<void>;
};
type ReplaceableDeliveries = DeliveryRepository & {
  replaceAllFromCloud?: (userId: string, records: DeliveryRecord[]) => Promise<void>;
};

function updatedAt(record: { updatedAt: number; createdAt?: number }): number {
  return Number.isFinite(record.updatedAt) ? record.updatedAt : (record.createdAt || 0);
}

export async function syncAcknowledgementToCloud(userId: string, record: AcknowledgementRecord): Promise<void> {
  if (auth.currentUser?.uid !== userId || getCurrentStoreUser() !== userId || record.userId !== userId) return;
  try {
    await setDoc(doc(db, "users", userId, "acknowledgements", record.ackId), record, { merge: true });
  } catch (error) {
    console.warn("[NotificationCloudSync] Acknowledgement remains local; cloud write failed:", error);
  }
}

export async function syncDeliveryToCloud(userId: string, record: DeliveryRecord): Promise<void> {
  if (auth.currentUser?.uid !== userId || getCurrentStoreUser() !== userId || record.userId !== userId) return;
  try {
    await setDoc(doc(db, "users", userId, "notificationDeliveries", record.deliveryId), record, { merge: true });
  } catch (error) {
    console.warn("[NotificationCloudSync] Delivery record remains local; cloud write failed:", error);
  }
}

/** Mirrors acknowledgement and delivery lifecycle records across a user's devices. */
export function initNotificationCloudSync(
  acknowledgements: ReplaceableAcknowledgements,
  deliveries: ReplaceableDeliveries,
): () => void {
  if (typeof window === "undefined") return () => {};

  let unsubscribeAck: (() => void) | undefined;
  let unsubscribeDelivery: (() => void) | undefined;
  let generation = 0;

  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    generation += 1;
    const currentGeneration = generation;
    unsubscribeAck?.();
    unsubscribeDelivery?.();
    unsubscribeAck = undefined;
    unsubscribeDelivery = undefined;
    if (!user?.uid) return;

    const uid = user.uid;
    const reconcile = async <T extends { userId: string; updatedAt: number; createdAt?: number; [key: string]: unknown }>(
      remoteItems: T[],
      localItems: T[],
      replace: (records: T[]) => Promise<void>,
      sync: (record: T) => Promise<void>,
    ) => {
      const remoteById = new Map(remoteItems.map((item) => [String(item.ackId ?? item.deliveryId), item]));
      const merged = new Map<string, T>();
      for (const local of localItems) {
        const id = String(local.ackId ?? local.deliveryId);
        const remote = remoteById.get(id);
        if (remote && updatedAt(remote) >= updatedAt(local)) {
          merged.set(id, remote);
        } else {
          merged.set(id, local);
          if (remote) void sync(local);
        }
      }
      for (const remote of remoteItems) {
        const id = String(remote.ackId ?? remote.deliveryId);
        if (!merged.has(id)) merged.set(id, remote);
      }
      await replace(Array.from(merged.values()));
    };

    unsubscribeAck = onSnapshot(collection(db, "users", uid, "acknowledgements"), (snapshot) => {
      if (currentGeneration !== generation || getCurrentStoreUser() !== uid ||
          auth.currentUser?.uid !== uid || snapshot.metadata.fromCache) return;
      void (async () => {
        const remote = snapshot.docs.map((item) => ({ ...item.data(), ackId: item.id }))
          .filter((item) => item.userId === uid) as unknown as AcknowledgementRecord[];
        const local = await acknowledgements.listAcknowledgements(uid);
        await reconcile(remote, local, async (records) => {
          await acknowledgements.replaceAllFromCloud?.(uid, records);
        }, (record) => syncAcknowledgementToCloud(uid, record));
      })().catch((error) => console.error("[NotificationCloudSync] Acknowledgement merge failed:", error));
    }, (error) => console.warn("[NotificationCloudSync] Acknowledgement listener failed:", error));

    unsubscribeDelivery = onSnapshot(collection(db, "users", uid, "notificationDeliveries"), (snapshot) => {
      if (currentGeneration !== generation || getCurrentStoreUser() !== uid ||
          auth.currentUser?.uid !== uid || snapshot.metadata.fromCache) return;
      void (async () => {
        const remote = snapshot.docs.map((item) => ({ ...item.data(), deliveryId: item.id }))
          .filter((item) => item.userId === uid) as unknown as DeliveryRecord[];
        const local = await deliveries.listDeliveries(uid);
        await reconcile(remote, local, async (records) => {
          await deliveries.replaceAllFromCloud?.(uid, records);
        }, (record) => syncDeliveryToCloud(uid, record));
      })().catch((error) => console.error("[NotificationCloudSync] Delivery merge failed:", error));
    }, (error) => console.warn("[NotificationCloudSync] Delivery listener failed:", error));
  });

  return () => {
    generation += 1;
    unsubscribeAuth();
    unsubscribeAck?.();
    unsubscribeDelivery?.();
  };
}
