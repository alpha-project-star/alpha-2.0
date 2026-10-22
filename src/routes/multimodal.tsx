import { createFileRoute } from "@tanstack/react-router";
import MultimodalStudio from "@/components/MultimodalStudio";

export const Route = createFileRoute("/multimodal")({
  component: MultimodalStudio,
});
