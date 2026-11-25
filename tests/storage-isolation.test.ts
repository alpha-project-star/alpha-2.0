import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getKey,
  getLegacyStorageKeys,
  importLegacyStorageForCurrentUser,
  setStoreUser,
} from "../src/lib/alpha-store";
import { LocalReminderRepository, type FirestoreReminder } from "../src/lib/reminder-repo";

function createStorageHarness() {
  const values = new Map<string, string>();
  const storage = {
    get length() { return values.size; },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, String(value)),
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
  return { values, storage };
}

describe("UID-scoped local persistence", () => {
  let values: Map<string, string>;

  beforeEach(() => {
    const harness = createStorageHarness();
    values = harness.values;
    vi.stubGlobal("window", {
      localStorage: harness.storage,
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("CustomEvent", class CustomEvent {
      type: string;
      constructor(type: string) { this.type = type; }
    });
    setStoreUser("account-A");
  });

  it("uses a distinct storage key for each authenticated UID", () => {
    expect(getKey("alpha.chat.v1")).toBe("alpha.chat.v1.account-A");
    setStoreUser("account-B");
    expect(getKey("alpha.chat.v1")).toBe("alpha.chat.v1.account-B");
    expect(getKey("alpha.chat.v1", "account-A")).toBe("alpha.chat.v1.account-A");
  });

  it("keeps unscoped legacy data intact until the current user explicitly imports it", () => {
    values.set("alpha.notes.v1", JSON.stringify([{ id: "legacy-note" }]));
    expect(getLegacyStorageKeys()).toContain("alpha.notes.v1");

    const result = importLegacyStorageForCurrentUser();
    expect(result.imported).toContain("alpha.notes.v1");
    expect(values.get("alpha.notes.v1")).toContain("legacy-note");
    expect(values.get("alpha.notes.v1.account-A")).toContain("legacy-note");

    setStoreUser("account-B");
    expect(values.get("alpha.notes.v1.account-B")).toBeNull();
    expect(values.get("alpha.notes.v1")).toContain("legacy-note");
  });

  it("does not overwrite existing account data during legacy import", () => {
    values.set("alpha.notes.v1", JSON.stringify([{ id: "legacy-note" }]));
    values.set("alpha.notes.v1.account-A", JSON.stringify([{ id: "account-note" }]));

    const result = importLegacyStorageForCurrentUser();
    expect(result.skipped).toContain("alpha.notes.v1");
    expect(values.get("alpha.notes.v1.account-A")).toContain("account-note");
  });

  it("isolates reminders by UID instead of projecting another user's records", async () => {
    const repository = new LocalReminderRepository();
    const reminder: FirestoreReminder = {
      id: "reminder-a",
      userId: "account-A",
      title: "Account A reminder",
      notes: "",
      dueAt: Date.now() + 60_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      reminderState: "active",
      notificationState: "pending",
    };

    await repository.createReminder("account-A", reminder);
    expect((await repository.listReminders("account-A")).map((item) => item.id)).toEqual(["reminder-a"]);
    expect(await repository.listReminders("account-B")).toEqual([]);
    expect(await repository.getReminder("account-B", "reminder-a")).toBeNull();
  });
});
