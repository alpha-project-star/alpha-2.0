/**
 * Per-user conversational reminder focus and clarification state.
 * Persistence is namespaced by Firebase UID; unscoped legacy data is not read
 * automatically because its owner cannot be inferred safely.
 */

import { FirestoreReminder } from './reminder-repo';
import { withCrossContextLock } from './cross-context-lock';
import { getStorage, getKey } from './alpha-store';

const LS_KEY = 'alpha.reminder_context.v1';

export interface ActiveReminderContext {
  id: string;
  title: string;
  dueAt: number;
  userId: string;
  notes?: string;
  updatedAt: number;
}

export interface PendingClarificationData {
  title: string;
  rawWhen: string;
  notes?: string;
  hour: number;
}

export type ReminderContextInput =
  | FirestoreReminder
  | {
      id: string;
      title: string;
      dueAt: number;
      userId?: string;
      notes?: string;
    };

class ReminderContextManager {
  private activeContext: ActiveReminderContext | null = null;
  private pendingClarification: { userId: string; data: PendingClarificationData } | null = null;
  private currentUserId: string = "unauthenticated";

  constructor() {
    this.reload(this.currentUserId);
  }

  private getStorageKey(userId: string): string {
    return getKey(LS_KEY, userId);
  }

  private reload(userId: string = this.currentUserId): void {
    const storage = getStorage();
    this.currentUserId = userId;
    this.activeContext = null;
    this.pendingClarification = null;
    if (!storage) return;

    try {
      const raw = storage.getItem(this.getStorageKey(userId));
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const context = parsed?.context;
      const pending = parsed?.pendingClarification;
      if (context && typeof context.id === 'string' && context.userId === userId) {
        this.activeContext = context as ActiveReminderContext;
      }
      if (pending && pending.userId === userId && pending.data) {
        this.pendingClarification = pending;
      }
    } catch (error) {
      console.warn('[ReminderContext] Could not read user context:', error);
    }
  }

  private save(): void {
    const storage = getStorage();
    if (!storage) return;
    const key = this.getStorageKey(this.currentUserId);
    try {
      if (this.activeContext || this.pendingClarification) {
        storage.setItem(key, JSON.stringify({
          context: this.activeContext,
          pendingClarification: this.pendingClarification,
          userId: this.currentUserId,
        }));
      } else {
        storage.removeItem(key);
      }
    } catch (error) {
      console.warn('[ReminderContext] Could not persist user context:', error);
    }
  }

  async setContext(userId: string, reminder: ReminderContextInput): Promise<void> {
    await withCrossContextLock(`alpha_lock_reminder_context.${userId}`, async () => {
      this.reload(userId);
      this.activeContext = {
        id: reminder.id,
        title: reminder.title,
        dueAt: reminder.dueAt,
        userId,
        notes: reminder.notes,
        updatedAt: Date.now(),
      };
      this.save();
    });
  }

  getContext(userId: string): ActiveReminderContext | null {
    this.reload(userId);
    return this.activeContext;
  }

  async setPendingClarification(userId: string, data: PendingClarificationData): Promise<void> {
    await withCrossContextLock(`alpha_lock_reminder_context.${userId}`, async () => {
      this.reload(userId);
      this.pendingClarification = { userId, data };
      this.save();
    });
  }

  getPendingClarification(userId: string): PendingClarificationData | null {
    this.reload(userId);
    return this.pendingClarification?.userId === userId ? this.pendingClarification.data : null;
  }

  clearPendingClarification(userId: string): void {
    this.reload(userId);
    this.pendingClarification = null;
    this.save();
  }

  clear(userId: string = this.currentUserId): void {
    this.currentUserId = userId;
    this.activeContext = null;
    this.pendingClarification = null;
    this.save();
  }

  async invalidate(userId: string, reminderId: string): Promise<void> {
    await withCrossContextLock(`alpha_lock_reminder_context.${userId}`, async () => {
      this.reload(userId);
      if (this.activeContext?.id === reminderId) {
        this.activeContext = null;
        this.save();
      }
    });
  }
}

export const reminderContextManager = new ReminderContextManager();
