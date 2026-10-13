import { describe, it, expect } from "vitest";
import { DEFAULT_SYSTEM, executeTool, fetchLiveWebContext } from "../src/lib/alpha.functions";
import { ALPHA_TOOLS } from "../src/lib/reminder-tool-definitions";
import { SEARCH_CAPABILITY_HINT } from "../src/lib/web-search";
import { DuckDuckGoProvider } from "../src/lib/search-providers";
import { BoundedResearchService } from "../src/lib/research";
import { MAX_OUTPUT_TOKENS } from "../src/lib/models";
import { sendChatOpenAICompat, WholeTurnTimeoutError, getMonotonicTimeMs } from "../src/lib/openai-compat";

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
    });

    it("SEARCH_CAPABILITY_HINT describes live search as an integrated capability", () => {
      expect(SEARCH_CAPABILITY_HINT).toContain("orchestrated via live DuckDuckGo");
      expect(SEARCH_CAPABILITY_HINT).not.toContain("not via a model-callable function tool");
    });

    it("executeTool executes web_search and parses Jina markdown into structured evidence", async () => {
      const origFetch = globalThis.fetch;
      const jinaMarkdown = `### [Alpha Companion 2.0](https://alpha.example.com/news)\nAlpha 2.0 release includes live web search and evidence pipeline.`;
      globalThis.fetch = async () => new Response(jinaMarkdown, { status: 200 });

      try {
        const result = await executeTool(
          { function: { name: "web_search", arguments: JSON.stringify({ query: "Alpha release" }) } },
          { userId: "test-user" }
        );

        expect(result.operation).toBe("web_search");
        expect(result.success).toBe(true);
        expect(result.error).toBeUndefined();
        expect(result.data).toContain("LIVE WEB SEARCH RESULTS");
        expect(result.data).toContain("Alpha Companion 2.0");
        expect(result.data).toContain("https://alpha.example.com/news");
        expect(result.data).toContain("[1]");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });

  describe("Defect B: Search & Research Cancellation Integrity", () => {
    it("DuckDuckGoProvider.search rethrows when caller signal is aborted", async () => {
      const origFetch = globalThis.fetch;
      const abortErr = new Error("This operation was aborted");
      abortErr.name = "AbortError";
      globalThis.fetch = async () => { throw abortErr; };

      const ctrl = new AbortController();
      ctrl.abort();

      const provider = new DuckDuckGoProvider();
      try {
        await expect(provider.search("test query", 5, { signal: ctrl.signal })).rejects.toThrow();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("DuckDuckGoProvider.search returns empty array gracefully on ordinary network failure", async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => { throw new Error("Network offline"); };

      const provider = new DuckDuckGoProvider();
      try {
        const res = await provider.search("test query", 5);
        expect(res).toEqual([]);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("BoundedResearchService.research rethrows when caller signal is aborted", async () => {
      const origFetch = globalThis.fetch;
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      globalThis.fetch = async () => { throw abortErr; };

      const ctrl = new AbortController();
      ctrl.abort();

      const service = new BoundedResearchService();
      try {
        await expect(service.research("test query", ctrl.signal)).rejects.toThrow();
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("fetchLiveWebContext rejects on whole-turn deadline expiration", async () => {
      // Passing monotonic deadlineMs in the past must throw WholeTurnTimeoutError before search
      await expect(
        fetchLiveWebContext("timed query", undefined, getMonotonicTimeMs() - 1000)
      ).rejects.toThrowError(WholeTurnTimeoutError);
    });

    it("fetchLiveWebContext rethrows when caller signal is aborted", async () => {
      const ctrl = new AbortController();
      ctrl.abort();

      await expect(
        fetchLiveWebContext("cancelled query", ctrl.signal)
      ).rejects.toThrow();
    });

    it("executeTool rethrows when caller signal is aborted instead of converting to REPOSITORY_ERROR", async () => {
      const ctrl = new AbortController();
      ctrl.abort();

      await expect(
        executeTool(
          { function: { name: "web_search", arguments: JSON.stringify({ query: "test" }) } },
          { userId: "test-user" },
          ctrl.signal
        )
      ).rejects.toThrow();
    });
  });

  describe("Defect C: Token Budget & Follow-Up Completion Integrity", () => {
    it("MAX_OUTPUT_TOKENS task budgets preserve full capacities for all profiles", () => {
      expect(MAX_OUTPUT_TOKENS.auto).toBe(2000);
      expect(MAX_OUTPUT_TOKENS.fast).toBe(1200);
      expect(MAX_OUTPUT_TOKENS.thinking).toBe(3000);
      expect(MAX_OUTPUT_TOKENS.coding).toBe(3000);
      expect(MAX_OUTPUT_TOKENS.vision).toBe(1200);
    });

    it("sendChatOpenAICompat transmits full task token budget to provider without artificial 300 cap", async () => {
      const origFetch = globalThis.fetch;
      let capturedBody: any = null;

      globalThis.fetch = async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Full budget response" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      try {
        const response = await sendChatOpenAICompat(
          [{ id: "1", role: "user", text: "Hello", ts: Date.now() }],
          "System prompt",
          {
            baseUrl: "https://api.openai.com/v1",
            apiKey: "test-key",
            model: "test-model",
            maxTokens: MAX_OUTPUT_TOKENS.auto,
          }
        );

        expect(capturedBody).not.toBeNull();
        expect(capturedBody.max_tokens).toBe(2000);
        expect(capturedBody.max_tokens).not.toBe(300);
        expect(response.finalText).toBe("Full budget response");
      } finally {
        globalThis.fetch = origFetch;
      }
    });
  });
});

