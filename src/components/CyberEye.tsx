import { useEffect, useState } from "react";
import { subscribeActive as subEyeActive } from "../lib/vision-stream";

/**
 * Scanner Node Eye — Neon-blue scanner blade on a black minimalist cyber-eye.
 * Fully code-driven with SVG/CSS.
 */
export function CyberEye({
  analyser,
  active,
  speaking,
  size,
}: {
  analyser: AnalyserNode | null;
  active: boolean;
  speaking: boolean;
  size: number | string;
}) {
  const [eyeOn, setEyeOn] = useState(false);
  useEffect(() => subEyeActive(setEyeOn), []);

  const hot = active || speaking;

  return (
    <div className="relative select-none flex items-center justify-center bg-black rounded-full border border-primary/40 shadow-[0_0_15px_rgba(59,130,246,0.3)]" style={{ width: size, height: size }}>
      {/* SVG Canvas for Scanner Effect */}
      <svg viewBox="0 0 100 100" className="w-full h-full p-2">
        <defs>
          <filter id="neonGlow">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>

        {/* Central Pulse Core */}
        <circle
          cx="50"
          cy="50"
          r={hot ? "15" : "10"}
          className={`fill-primary transition-all duration-300 ${hot ? "animate-pulse" : ""}`}
          style={{ filter: "url(#neonGlow)" }}
        />

        {/* Scanner Blade */}
        {hot && (
          <line
            x1="0"
            y1="50"
            x2="100"
            y2="50"
            stroke="oklch(0.96 0.22 232)"
            strokeWidth="2"
            filter="url(#neonGlow)"
            className="animate-scanner"
            opacity="0.8"
          />
        )}
      </svg>

      {/* Themed Status Label */}
      {hot && (
        <div className="absolute top-[5%] text-[8px] font-mono tracking-wider text-primary bg-black/80 px-1 rounded shadow-sm border border-primary/30">
          {speaking ? "STATUS: SPEAKING" : "STATUS: THINKING"}
        </div>
      )}

      {eyeOn && (
        <div className="absolute bottom-[5%] text-[8px] font-mono tracking-wider text-primary bg-black/80 px-1 rounded shadow-sm border border-primary/30">
          LIVE
        </div>
      )}

      <style>{`
        @keyframes scanner-sweep {
          0% { transform: translateY(-30px); }
          50% { transform: translateY(30px); }
          100% { transform: translateY(-30px); }
        }
        .animate-scanner {
          animation: scanner-sweep 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
