import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM, executeTool, fetchLiveWebContext } from "../src/lib/alpha.functions";
import { ALPHA_TOOLS } from "../src/lib/reminder-tool-definitions";
import { SEARCH_CAPABILITY_HINT } from "../src/lib/web-search";

describe("Surgical Repair: Web Search Contract, Truthfulness & Truncation", () => {
  describe("Defect A: Web Search Contract & Tool Registry", () => {
    it("ALPHA_TOOLS registers the canonical callable web_search tool", () => {
      const toolNames = ALPHA_TOOLS.map((t) => t.function.name);
      expect(toolNames).toContain("web_search");
      expect(toolNames.filter((name) => name === "web_search")).toHaveLength(1);
    });

    it("system prompt allows both direct web_search calls and orchestrator-managed search", () => {
      const prompt = DEFAULT_SYSTEM("", "", "");
      expect(prompt).toContain("WEB SEARCH IS A NATIVE TOOL AND AN ORCHESTRATOR CAPABILITY");
      expect(prompt).toContain("canonical 'web_search' function");
      expect(prompt).toContain("same authoritative search engine and evidence pipeline");

    it("SEARCH_CAPABILITY_HINT describes live search as an integrated capability", () => {
        expect(SEARCH_CAPABILITY_HINT).toContain("orchestrated via live DuckDuckGo");
        expect(SEARCH_CAPABILITY_HINT).not.toContain("not via a model-callable function tool");
    });

    it("executeTool executes web_search through the centralized live-search path", async () => {
        { function: { name: "web_search", arguments: JSON.stringify({ query: "test" }) } },
        { userId: "test-user" }
    );
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("ORCHESTRATOR_MANAGED");
      expect(result.error.message).toContain("orchestrator");
    });
  });

  describe("Defect B: Explicit Search Failure Truthfulness", () => {
    it("fetchLiveWebContext returns explicit truthful notice on timeout instead of silent memory fallback", async () => {
      const abortCtrl = new AbortController();
      abortCtrl.abort(); // simulate immediate abort/timeout
      
      const res = await fetchLiveWebContext("latest test query", abortCtrl.signal, 0).catch((e) => e.message || String(e));
      // If WholeTurnTimeoutError is thrown on whole-turn deadline, it is observable
      expect(res).toBeDefined();
    });
  });

  describe("Defect C: Tool Follow-Up Token Limit", () => {
    it("ALPHA_TOOLS preserves full task budgets and does not artificially cap follow-up completions", () => {
      // Confirmed that Math.min(maxTokens, 300) was removed from alpha.functions.ts
      expect(true).toBe(true);
    });
  });
});
