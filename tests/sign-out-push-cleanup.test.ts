import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls, authMock, signOutMock, unregisterMock } = vi.hoisted(() => ({
  calls: [] as string[],
  authMock: { currentUser: null as null | { uid: string; isAnonymous: boolean } },
  signOutMock: vi.fn(async () => {}),
  unregisterMock: vi.fn(async () => ({ success: true })),
}));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  signInAnonymously: vi.fn(),
  signInWithPopup: vi.fn(),
  linkWithPopup: vi.fn(),
  GoogleAuthProvider: class {},
  signOut: (...args: unknown[]) => signOutMock(...args),
}));
vi.mock("../src/lib/firebase", () => ({ auth: authMock }));
vi.mock("../src/lib/alpha-store", () => ({ setStoreUser: vi.fn() }));
vi.mock("../src/lib/reminder-context", () => ({ reminderContextManager: { getContext: vi.fn(), clear: vi.fn() } }));
vi.mock("../src/lib/push-subscription", () => ({ unregisterPushSubscription: (...args: unknown[]) => unregisterMock(...args) }));

import { signOutUser } from "../src/lib/auth";

describe("account sign-out", () => {
  beforeEach(() => {
    calls.length = 0;
    authMock.currentUser = { uid: "google-user", isAnonymous: false };
    unregisterMock.mockClear();
    signOutMock.mockClear();
    unregisterMock.mockImplementation(async () => {
      calls.push("unregister");
      return { success: true };
    });
    signOutMock.mockImplementation(async () => { calls.push("signOut"); });
  });

  it("removes the user's browser push subscription before signing out", async () => {
    await signOutUser();
    expect(unregisterMock).toHaveBeenCalledWith("google-user");
    expect(calls).toEqual(["unregister", "signOut"]);
  });

  it("keeps local anonymous sessions out of remote push cleanup", async () => {
    authMock.currentUser = { uid: "anonymous-user", isAnonymous: true };
    await signOutUser();
    expect(unregisterMock).not.toHaveBeenCalled();
    expect(calls).toEqual(["signOut"]);
  });
});
