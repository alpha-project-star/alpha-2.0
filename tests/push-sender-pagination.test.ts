import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchDueReminderQueryRows } from "../src/lib/push-sender.server";

describe("scheduled push query pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("continues past the first 500 due reminders with a stable document cursor", async () => {
    const makeDocument = (index: number) => ({
      name: `projects/demo/databases/test/documents/users/user/reminders/reminder-${String(index).padStart(4, "0")}`,
      fields: { dueAt: { integerValue: "1000" } },
    });
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ document: makeDocument(index) }));
    const secondPage = [{ document: makeDocument(500) }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => secondPage });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchDueReminderQueryRows("https://firestore.example/v1/projects/demo/databases/test/documents", "token", 2000);

    expect(rows).toHaveLength(501);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondRequest = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondRequest.structuredQuery.startAt).toEqual({
      values: [
        { integerValue: "1000" },
        { referenceValue: makeDocument(499).name },
      ],
      before: false,
    });
    expect(secondRequest.structuredQuery.orderBy).toEqual([
      { field: { fieldPath: "dueAt" }, direction: "ASCENDING" },
      { field: { fieldPath: "__name__" }, direction: "ASCENDING" },
    ]);
  });
});
