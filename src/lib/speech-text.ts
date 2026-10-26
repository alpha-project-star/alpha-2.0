/**
 * ALPHA GATE — MASTER FORCE PRESENTATION PROTOCOL (Version 1.0)
 * Speech Presentation Engine & Audio Sanitizer (Sections 13.6, 15, 16, 17, 18)
 *
 * Distinct from visual rendering: interprets written content semantically
 * into natural spoken English for Text-to-Speech (TTS).
 *
 * Rules:
 * - Visual markup must NEVER be vocalized ("heading two", "bold", "asterisk", "code block")
 * - Mathematical expressions are converted to spoken equivalents (stacked fractions, roots, powers)
 * - Currencies, numbers, percentages, dates, and units are pronounced naturally
 * - Pauses and prosody respect semantic boundaries
 */

import { stripLeakedThinking } from "./openai-compat";

const MATH_DISPLAY = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]/g;
const MATH_INLINE = /\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;

/** Does this `$...$` span actually look like math (rather than "$5 to $9")? */
function looksLikeMath(s: string): boolean {
  if (/^\s*[\d.,]+\s*$/.test(s)) return false; // "$5" style money
  return /[\\^_={}]|\\frac|\\sqrt|[a-zA-Z]\s*[+\-*/=]/.test(s);
}

function speakTable(block: string): string {
  const rows = block
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cells = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const isSep = (line: string) => /^\|?[\s:-]+\|[\s|:-]*$/.test(line);
  const header = rows[0] && !isSep(rows[0]) ? cells(rows[0]) : [];
  const out: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (isSep(rows[i])) continue;
    if (i === 0 && header.length) continue;
    const c = cells(rows[i]);
    if (!c.length) continue;
    const parts = c
      .map((v, j) => {
        const cleanVal = v.replace(/^[-–—]$/, "").trim();
        if (!cleanVal) return "";
        return header[j] ? `${header[j]}: ${cleanVal}` : cleanVal;
      })
      .filter(Boolean);
    if (parts.length) out.push(parts.join(", "));
  }
  if (!out.length) return "";
  if (out.length > 5) {
    return `${out.slice(0, 4).join(". ")}. And ${out.length - 4} more rows in the table.`;
  }
  return out.join(". ") + ".";
}

export function normalizeForSpeech(input: string): string {
  let s = input || "";
  s = stripLeakedThinking(s);

  // 1. Remove internal action tags, raw URLs, and emojis
  s = s.replace(/\[\[[\s\S]*?\]\]/g, " ");
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F]/gu, " ");

  // 2. Code blocks -> brief natural notice, never vocalize syntax line-by-line
  s = s.replace(/```(?:[a-z0-9_-]+)?\s*([\s\S]*?)```/gi, " code block. ");
  s = s.replace(/~~~(?:[a-z0-9_-]+)?\s*([\s\S]*?)~~~/gi, " code block. ");
  s = s.replace(/`([^`]+)`/g, "$1");

  // 3. Mathematical display & inline -> natural spoken mathematics (Section 13.6)
  s = s.replace(MATH_DISPLAY, (_m, a, b) => " " + latexToSpeech(a || b || "") + " ");
  s = s.replace(MATH_INLINE, (m, a, b) => {
    const body = a ?? b ?? "";
    if (a !== undefined && !looksLikeMath(a)) return m;
    return " " + latexToSpeech(body) + " ";
  });

  // 4. Tables -> natural row-wise verbalization (Section 12.4)
  s = s.replace(/(?:^\|.*\|[ \t]*\n?)+/gm, (block) => " " + speakTable(block) + " ");

  // 5. Headings & Markdown markers -> natural phrasing followed by pause (Section 15.3, 15.5)
  // Strip heading hashes without saying "heading"
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Callouts -> natural notice
  s = s.replace(/^>\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|ERROR|SUCCESS)\]\s*/gim, "");
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  // Horizontal rules
  s = s.replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, " ");
  // List bullets -> natural pause, never vocalize "bullet point" (Section 15.2, 15.6)
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/^\|/gm, "");

  // 6. Sources / metadata footers: Strip strictly
  s = s.replace(/\*\*Sources:?\*\*[\s\S]*$/i, " ");
  s = s.replace(/_No web sources[^.]*\./gi, " ");
  s = s.replace(/^\s*(?:✅|❌|⚠️|💡|📌)\s*/gm, "");

  // 7. Emphasis markers — pairs only (do NOT pronounce asterisks or underscores)
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, "$1$2");
  s = s.replace(/(^|\s)__([^_]+)__/g, "$1$2");
  s = s.replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:!?])/g, "$1$2");

  // 8. Currency pronunciation (Section 17.2)
  s = s.replace(/\$\s?(\d[\d,]*)\.(\d{2})\b/g, (_m, dollars, cents) => {
    const d = dollars.replace(/,/g, "");
    const c = parseInt(cents, 10);
    return `${d} dollars and ${c} cents`;
  });
  s = s.replace(/\$\s?(\d[\d,]*)/g, (_m, dollars) => {
    const d = dollars.replace(/,/g, "");
    return `${d} dollars`;
  });

  // 9. Numbers, Units & Symbols to words (Section 17.4, 17.6)
  s = s.replace(/(\d+(?:\.\d+)?)\s*%/g, "$1 percent");
  s = s.replace(/%/g, " percent ");
  s = s.replace(/(\d+(?:\.\d+)?)\s*m\/s(?:²|\^2)/gi, "$1 metres per second squared");
  s = s.replace(/(\d+(?:\.\d+)?)\s*km\b/gi, "$1 kilometres");
  s = s.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi, "$1 kilograms");
  s = s.replace(/(\d+(?:\.\d+)?)\s*°C/gi, "$1 degrees Celsius");
  s = s.replace(/(\d+(?:\.\d+)?)\s*°F/gi, "$1 degrees Fahrenheit");

  s = s.replace(/×/g, " times ");
  s = s.replace(/÷/g, " divided by ");
  s = s.replace(/(^|[\s(])-(\d)/g, "$1minus $2");
  s = s.replace(/(\d)\s*[–—]\s*(\d)/g, "$1 to $2");
  s = s.replace(/[|•▪●※]+/g, ", ");
  s = s.replace(/[#*_`~]/g, "");

  // 10. Clean up whitespace & maintain sentence boundaries for TTS cadence
  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, ". ");
  s = s.replace(/\s+([.,;:!?])/g, "$1").replace(/(?:\.\s*){2,}/g, ". ");
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Converts LaTeX expressions into spoken mathematical English (Section 13.6).
 * Handles fractions, square roots, powers, Greek letters, boxed answers, and derivations.
 */
function latexToSpeech(tex: string): string {
  let t = tex;

  // Boxed solutions
  t = t.replace(/\\boxed\{([^{}]+)\}/g, " $1 ");

  // Specific common fraction idioms
  t = t.replace(/\\frac\{1\}\{2\}/g, " one half ");
  t = t.replace(/\\frac\{1\}\{4\}/g, " one quarter ");
  t = t.replace(/\\frac\{3\}\{4\}/g, " three quarters ");
  t = t.replace(/\\frac\{1\}\{3\}/g, " one third ");
  t = t.replace(/\\frac\{2\}\{3\}/g, " two thirds ");

  // Explicit grouping for algebraic and multi-term fractions (Section 13.6)
  t = t.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_m, num, den) => {
    const numClean = num.trim();
    const denClean = den.trim();
    const numNeedsGroup = /[+\-*/]/.test(numClean);
    const denNeedsGroup = /[+\-*/]/.test(denClean);
    const spokenNum = numNeedsGroup ? `the quantity ${numClean}` : numClean;
    const spokenDen = denNeedsGroup ? `the quantity ${denClean}` : denClean;
    return ` ${spokenNum}, divided by ${spokenDen} `;
  });

  t = t.replace(/\\sqrt\{([^{}]+)\}/g, " the square root of ($1) ");
  t = t.replace(/\^\{([^{}]+)\}/g, " to the power of ($1) ");
  t = t.replace(/\^(\d+)/g, (_m, n) =>
    n === "2" ? " squared " : n === "3" ? " cubed " : ` to the power of ${n} `,
  );
  t = t.replace(/_\{([^{}]+)\}/g, " sub ($1) ");
  t = t.replace(/_(\w)/g, " sub $1 ");

  const greek = [
    "pi",
    "theta",
    "alpha",
    "beta",
    "gamma",
    "delta",
    "lambda",
    "mu",
    "sigma",
    "omega",
    "phi",
  ];
  for (const g of greek) t = t.replace(new RegExp(`\\\\${g}`, "g"), ` ${g} `);

  t = t.replace(/\\sum/g, " sum ");
  t = t.replace(/\\prod/g, " product ");
  t = t.replace(/\\int/g, " integral ");
  t = t.replace(/\\infty/g, " infinity ");
  t = t.replace(/\\cdot|\\times/g, " times ");
  t = t.replace(/\\div/g, " divided by ");
  t = t.replace(/\\pm/g, " plus or minus ");
  t = t.replace(/\\leq/g, " less than or equal to ");
  t = t.replace(/\\geq/g, " greater than or equal to ");
  t = t.replace(/\\neq/g, " not equal to ");
  t = t.replace(/\\approx/g, " approximately ");
  t = t.replace(/\\begin\{[a-z*]+\}|\\end\{[a-z*]+\}/g, " ");
  t = t.replace(/\\\\/g, " ; ");
  t = t.replace(/[{}\\]/g, " ");
  t = t.replace(/=/g, " equals ");
  t = t.replace(/(^|[\s(])-(\s*[\d.a-z(])/gi, "$1minus $2");
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/-/g, " minus ");
  t = t.replace(/\*/g, " times ");
  t = t.replace(/\//g, " over ");
  return t.replace(/\s+/g, " ").trim();
}
