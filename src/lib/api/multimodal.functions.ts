import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { generateImageServer, generateVideoServer } from "../gemini-multimodal.server";

export const generateImage = createServerFn({ method: "POST" })
  .validator(z.object({ prompt: z.string() }))
  .handler(async ({ data }) => {
    return await generateImageServer(data.prompt);
  });

export const generateVideo = createServerFn({ method: "POST" })
  .validator(z.object({ prompt: z.string() }))
  .handler(async ({ data }) => {
    return await generateVideoServer(data.prompt);
  });
