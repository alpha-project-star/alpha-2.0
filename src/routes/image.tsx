import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Wand2, ExternalLink, Copy, Check, Sparkles } from "lucide-react";
import { generateImage } from "../lib/alpha.functions";
import { ToolHeader } from "../components/ToolHeader";
import type { ImageStylePreference } from "../lib/multimodal-generator";

export const Route = createFileRoute("/image")({
  head: () => ({
    meta: [
      { title: "Alpha — Image Studio" },
      { name: "description", content: "High-fidelity AI image generation powered by FLUX.1 and GPT-Image-2." },
    ],
  }),
  component: ImageRoute,
});

const STYLE_OPTIONS: Array<{ id: ImageStylePreference; label: string; desc: string }> = [
  { id: "auto", label: "Auto-Detect", desc: "Intelligently routes based on prompt" },
  { id: "anime", label: "Anime Art", desc: "GPT-Image-2 anime & character design" },
  { id: "realism", label: "Photorealistic", desc: "FLUX.1 ultra-detailed 8K realism" },
  { id: "3d", label: "3D Render", desc: "FLUX.1 Octane & Unreal 5 CGI" },
  { id: "flux", label: "FLUX.1 Art", desc: "State-of-the-art general art" },
];

function ImageRoute() {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState<ImageStylePreference>("auto");
  const [busy, setBusy] = useState(false);
  const [img, setImg] = useState<string | null>(null);
  const [via, setVia] = useState<string>("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function go() {
    if (!prompt.trim()) return;
    setBusy(true);
    setErr("");
    setImg(null);
    try {
      const res = await generateImage(prompt, style);
      setImg(res.dataUrl);
      setVia(res.via);
    } catch (e: any) {
      setErr(e?.message || "Generation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const copyUrl = () => {
    if (!img) return;
    navigator.clipboard.writeText(img);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="starfield min-h-screen pb-12">
      <ToolHeader
        title="Image Studio"
        scannerState={busy ? "processing" : "idle"}
        right={
          busy ? (
            <span className="text-[10px] text-primary animate-pulse font-medium">Synthesizing…</span>
          ) : null
        }
      />
      <div className="p-4 max-w-2xl mx-auto space-y-5">
        {/* Prompt Input */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" /> Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe what to create (e.g. 'an anime beast-girl with purple hair', 'a cybernetic city in neon rain')..."
            className="w-full bg-input/80 backdrop-blur rounded-xl px-4 py-3 border border-border outline-none focus:border-primary min-h-[100px] text-sm leading-relaxed"
          />
        </div>

        {/* Style Selection */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Style Specialization
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {STYLE_OPTIONS.map((opt) => {
              const active = style === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStyle(opt.id)}
                  className={`text-left px-3 py-2 rounded-xl border text-xs transition-all ${
                    active
                      ? "border-primary bg-primary/10 text-primary shadow-sm font-semibold"
                      : "border-border/60 bg-card/40 text-muted-foreground hover:border-border hover:text-foreground"
                  }`}
                >
                  <div className="font-medium truncate">{opt.label}</div>
                  <div className="text-[10px] opacity-75 truncate">{opt.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={go}
          disabled={busy || !prompt.trim()}
          className="w-full rounded-xl bg-primary text-primary-foreground py-3.5 font-semibold neon-border disabled:opacity-50 flex items-center justify-center gap-2 text-sm shadow-md transition-all active:scale-[0.99]"
        >
          <Wand2 className="w-4 h-4" /> {busy ? "Generating High-Res Artwork…" : "Generate with FLUX.1"}
        </button>

        {err && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs">
            {err}
          </div>
        )}

        {/* Output Canvas */}
        {img && (
          <div className="glass rounded-2xl p-3 border border-border/60 space-y-3 shadow-xl">
            <div className="relative rounded-xl overflow-hidden bg-black/40 border border-border/40">
              <img src={img} alt={prompt} className="w-full h-auto max-h-[600px] object-contain mx-auto" />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-primary/15 text-primary text-[11px] font-mono font-medium border border-primary/30">
                  {via || "FLUX.1"}
                </span>
                <span className="text-muted-foreground text-[11px] truncate max-w-[200px]">
                  1024 × 1024 HD
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyUrl}
                  className="px-3 py-1.5 rounded-lg border border-border/60 hover:bg-muted/50 text-foreground flex items-center gap-1.5 text-xs transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? "Copied" : "Copy URL"}</span>
                </button>
                <a
                  href={img}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground flex items-center gap-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Full Size</span>
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImageRoute;
