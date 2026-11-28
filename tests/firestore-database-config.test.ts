import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Firestore database alignment", () => {
  it("maps the app's configured database to the repository rules file", () => {
    const appConfig = JSON.parse(readFileSync(new URL("../firebase-applet-config.json", import.meta.url), "utf8"));
    const firebaseConfig = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url), "utf8"));
    const firestoreTargets = Array.isArray(firebaseConfig.firestore)
      ? firebaseConfig.firestore
      : [firebaseConfig.firestore];

    expect(firestoreTargets).toContainEqual({
      database: appConfig.firestoreDatabaseId,
      rules: "firestore.rules",
    });
  });
});
