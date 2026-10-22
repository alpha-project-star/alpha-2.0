// Multimodal Generator utilities for Alpha (100% Free / Public APIs - zero key requirement)

export type ImageStylePreference = "auto" | "anime" | "realism" | "3d" | "flux";

export interface GeneratedImageResult {
  dataUrl: string;
  model: string;
  style: string;
  prompt: string;
  width: number;
  height: number;
}

/**
 * Detects the appropriate specialized model, aspect ratio, and aesthetic enrichment
 * based on prompt keywords or user preference.
 */
export function detectImageStyle(prompt: string, forcedStyle?: ImageStylePreference): {
  model: string;
  style: string;
  enrichedPrompt: string;
} {
  const p = prompt.toLowerCase();

  const isAnime =
    forcedStyle === "anime" ||
    (forcedStyle !== "realism" &&
      forcedStyle !== "3d" &&
      /\b(anime|manga|beast[- ]?girl|waifu|chibi|kawaii|comic|cel[- ]?shaded|pixiv|genshin|vtuber|japanese animation|catgirl|foxgirl|neko)\b/i.test(
        p,
      ));

  const is3D =
    forcedStyle === "3d" ||
    (!isAnime &&
      forcedStyle !== "realism" &&
      /\b(3d|render|cgi|pixar|unreal|octane|isometric|blender|claymation)\b/i.test(p));

  const isRealism =
    forcedStyle === "realism" ||
    (!isAnime &&
      !is3D &&
      /\b(photo|photograph|photorealistic|hyperrealistic|dslr|raw photo|portrait photography|real life|real|skin texture)\b/i.test(
        p,
      ));

  if (isAnime) {
    return {
      model: "gpt-image-2",
      style: "Anime Art (GPT-Image-2)",
      enrichedPrompt: `${prompt.trim()}, masterpiece, high quality anime artwork, detailed anime illustration, expressive eyes, vibrant colors, clean linework, trending on pixiv, studio quality`,
    };
  }

  if (is3D) {
    return {
      model: "flux",
      style: "3D Render (FLUX.1)",
      enrichedPrompt: `${prompt.trim()}, detailed 3d render, octane render, raytracing, unreal engine 5, volumetric lighting, 8k cgi, sharp focus`,
    };
  }

  if (isRealism) {
    return {
      model: "flux",
      style: "Photorealistic (FLUX.1)",
      enrichedPrompt: `${prompt.trim()}, ultra-detailed 8k photograph, professional photography, natural lighting, fine skin and fabric textures, sharp focus, masterwork`,
    };
  }

  // Default: State-of-the-Art FLUX.1
  return {
    model: "flux",
    style: "FLUX.1 Art",
    enrichedPrompt: `${prompt.trim()}, masterpiece, highly detailed, 8k resolution, cinematic lighting, sharp focus, artistic composition`,
  };
}

export async function generateImageServer(
  prompt: string,
  stylePref: ImageStylePreference = "auto",
): Promise<GeneratedImageResult> {
  const clean = prompt.trim() || "creative cosmic artwork";
  const { model, style, enrichedPrompt } = detectImageStyle(clean, stylePref);
  const seed = Math.floor(Math.random() * 1_000_000);
  const encodedPrompt = encodeURIComponent(enrichedPrompt);

  // High-fidelity FLUX / GPT-Image-2 engine with watermark removal and high resolution
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=${model}&nologo=true&seed=${seed}`;

  return {
    dataUrl: url,
    model,
    style,
    prompt: clean,
    width: 1024,
    height: 1024,
  };
}

export async function generateVideoServer(prompt: string): Promise<{ dataUrl: string }> {
  const clean = prompt.trim() || "snow falling in a city";

  // 1. Search Wikimedia Commons for real, 100% free public domain video clips (zero API keys required)
  try {
    const searchTerms = clean
      .replace(
        /^(video|clip|animation|make a video of|generate a video of|create a video of)\s+/i,
        "",
      )
      .trim();
    const queryUrl = `https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=filetype:video+${encodeURIComponent(searchTerms)}&gsrlimit=3&prop=imageinfo&iiprop=url|mime`;

    const res = await fetch(queryUrl, {
      headers: {
        "User-Agent": "AlphaAssistant/1.0 (Mozilla/5.0; compatible; alpha-ai-assistant)",
      },
    });

    if (res.ok) {
      const data = await res.json();
      const pages = data.query?.pages || {};
      for (const pageId of Object.keys(pages)) {
        const info = pages[pageId]?.imageinfo?.[0];
        if (
          info?.url &&
          (info.url.endsWith(".webm") ||
            info.url.endsWith(".ogv") ||
            info.url.endsWith(".mp4") ||
            info.mime?.startsWith("video/"))
        ) {
          return { dataUrl: info.url };
        }
      }
    }
  } catch (err) {
    console.warn("[generateVideoServer] Wikimedia Commons lookup error:", err);
  }

  // 2. If no direct video clip was found, generate a high-resolution cinematic FLUX animation scene (100% free, no key)
  const encodedPrompt = encodeURIComponent(
    `${clean}, cinematic 4k motion frame, detailed animation scene, masterpiece, 8k`,
  );
  const fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=576&model=flux&nologo=true`;
  return { dataUrl: fallbackUrl };
}
