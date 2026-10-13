import { describe, it, expect, vi } from "vitest";
import { DEFAULT_SYSTEM, executeTool, fetchLiveWebContext, sendChat } from "../src/lib/alpha.functions";
import { ALPHA_TOOLS } from "../src/lib/reminder-tool-definitions";
import { SEARCH_CAPABILITY_HINT, SearchProvider } from "../src/lib/web-search";
import { DuckDuckGoProvider } from "../src/lib/search-providers";
import { BoundedResearchService } from "../src/lib/research";
import { MAX_OUTPUT_TOKENS } from "../src/lib/models";
import { sendChatOpenAICompat, WholeTurnTimeoutError, getMonotonicTimeMs } from "../src/lib/openai-compat";
import * as openaiCompat from "../src/lib/openai-compat";
import * as toolRegistryModule from "../src/lib/tool-registry";
import { alphaStore } from "../src/lib/alpha-store";

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

    it("BoundedResearchService.research catches in-flight provider cancellation and rethrows via signal check", async () => {
      // Exercises D1-02 catch block: signal starts un-aborted, enters research(), and aborts during provider search
      const ctrl = new AbortController();
      let searchInvoked = false;

      const mockProvider: SearchProvider = {
        async search() {
          searchInvoked = true;
          ctrl.abort(); // In-flight cancellation occurs after research() initial guard!
          const customAbortErr = new Error("Custom provider abort error");
          customAbortErr.name = "AbortError";
          throw customAbortErr;
        },
        async readPage() {
          return { title: "", content: "", status: "failed" };
        },
      };

      const service = new BoundedResearchService(mockProvider);
      // Confirms provider was entered and the catch block rethrew instead of converting to { status: "failed" }
      await expect(service.research("test query", ctrl.signal)).rejects.toThrow("Custom provider abort error");
      expect(searchInvoked).toBe(true);
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

    it("executeTool catches in-flight cancellation during tool execution and rethrows instead of REPOSITORY_ERROR", async () => {
      // Exercises D1-03 catch block: signal starts un-aborted, enters executeTool(), and aborts during tool fetch
      const origFetch = globalThis.fetch;
      const ctrl = new AbortController();
      let fetchInvoked = false;

      globalThis.fetch = async () => {
        fetchInvoked = true;
        ctrl.abort(); // In-flight cancellation after executeTool initial guard!
        const err = new Error("Tool network fetch aborted mid-flight");
        err.name = "AbortError";
        throw err;
      };

      try {
        await expect(
          executeTool(
            { function: { name: "web_search", arguments: JSON.stringify({ query: "in-flight test" }) } },
            { userId: "test-user" },
            ctrl.signal
          )
        ).rejects.toThrow("Tool network fetch aborted mid-flight");
        expect(fetchInvoked).toBe(true);
      } finally {
        globalThis.fetch = origFetch;
      }
    });

    it("executeTool rethrows WholeTurnTimeoutError thrown during tool execution instead of REPOSITORY_ERROR", async () => {
      vi.spyOn(toolRegistryModule, "getReminderTool").mockReturnValue({
        createReminder: vi.fn().mockRejectedValue(new WholeTurnTimeoutError("Turn deadline expired in reminder tool")),
      } as any);

      await expect(
        executeTool(
          { function: { name: "createReminder", arguments: JSON.stringify({ title: "buy groceries" }) } },
          { userId: "test-user" }
        )
      ).rejects.toThrowError(WholeTurnTimeoutError);
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

    it("orchestration post-tool final completion supplies the full task token budget (2000) with empty tools", async () => {
      // Directly verifies that alpha.functions.ts post-tool completion path passes full budget
      const storeMap = new Map<string, string>();
      vi.stubGlobal("navigator", { onLine: true });
      (globalThis as any).window = {
        navigator: { onLine: true },
        location: { origin: "https://alpha.local" },
        localStorage: {
          getItem: (k: string) => storeMap.get(k) || null,
          setItem: (k: string, v: string) => storeMap.set(k, String(v)),
          removeItem: (k: string) => storeMap.delete(k),
          clear: () => storeMap.clear(),
        },
      };

      await alphaStore.clearChat();
      await alphaStore.setSettings({ openRouterKey: "mock-test-key" });
      let callCount = 0;
      let capturedPostToolOpts: any = null;

      vi.spyOn(toolRegistryModule, "getReminderTool").mockReturnValue({
        createReminder: vi.fn().mockResolvedValue({ success: true, reminder: { id: "rem_1", title: "Review telemetry" } }),
      } as any);

      const spy = vi.spyOn(openaiCompat, "sendChatOpenAICompat").mockImplementation(async (_history, _sys, opts: any) => {
        callCount++;
        if (callCount === 1) {
          return {
            finalText: "",
            toolCalls: [
              {
                id: "call_budget_test",
                type: "function",
                function: {
                  name: "createReminder",
                  arguments: JSON.stringify({ title: "Review telemetry", dueAt: "tomorrow at 9am" }),
                },
              },
            ],
          };
        } else {
          capturedPostToolOpts = opts;
          return {
            finalText: "I have recorded the reminder for telemetry review.",
          };
        }
      });

      try {
        const reply = await sendChat([
          { id: "u1", role: "user", text: "Please schedule telemetry review for tomorrow", ts: Date.now() },
        ]);
        expect(callCount).toBe(2);
        expect(capturedPostToolOpts).not.toBeNull();
        // Verifies the post-tool request receives full task budget (2000 for auto) and is NOT clamped to 300
        expect(capturedPostToolOpts.maxTokens).toBe(MAX_OUTPUT_TOKENS.auto);
        expect(capturedPostToolOpts.maxTokens).toBe(2000);
        // Verifies tools: [] is passed to force final text completion without repeating actions
        expect(capturedPostToolOpts.tools).toEqual([]);
        expect(reply).toContain("I have recorded the reminder for telemetry review.");
      } finally {
        spy.mockRestore();
      }
    });
  });
});


