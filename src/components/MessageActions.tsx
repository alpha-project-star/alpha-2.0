import { useState } from "react";
import { Copy, Check, Volume2, RotateCcw, Trash2 } from "lucide-react";
import { prepareUtterance, speakWith } from "../lib/voice";

export function MessageActions({
  text,
  compact = false,
  onDelete,
  onRetry,
}: {
  text: string;
  compact?: boolean;
  onDelete?: () => void;
  onRetry?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex items-center gap-1.5 ${compact ? "mt-1 justify-end" : "mt-2"} opacity-80`}>
      {!compact && (
        <button
          onClick={() => {
            prepareUtterance();
            speakWith(text);
          }}
          aria-label="Speak again"
          className="p-1.5 rounded-lg bg-background/60 border border-primary/30 hover:border-primary/60 hover:bg-primary/10 transition-all active:scale-95"
        >
          <Volume2 className="w-4 h-4 text-primary" />
        </button>
      )}
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {}
        }}
        aria-label="Copy"
        className="p-1.5 rounded-lg bg-background/60 border border-primary/30 hover:border-primary/60 hover:bg-primary/10 transition-all active:scale-95"
      >
        {copied ? (
          <Check className="w-4 h-4 text-primary" />
        ) : (
          <Copy className="w-4 h-4 text-primary" />
        )}
      </button>
      {onRetry && (
        <button
          onClick={onRetry}
          aria-label="Regenerate"
          className="p-1.5 rounded-lg bg-background/60 border border-primary/30 hover:border-primary/60 hover:bg-primary/10 transition-all active:scale-95"
        >
          <RotateCcw className="w-4 h-4 text-primary" />
        </button>
      )}
      {onDelete && (
        <button
          onClick={onDelete}
          aria-label="Delete message"
          className="p-1.5 rounded-lg bg-background/60 border border-destructive/30 hover:border-destructive/60 hover:bg-destructive/10 transition-all active:scale-95"
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </button>
      )}
    </div>
  );
}
