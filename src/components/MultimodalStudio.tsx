import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { generateImage, generateVideo } from "@/lib/api/multimodal.functions";
import { activity } from "@/lib/activity";

export default function MultimodalStudio() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const handleGenerate = async (type: "image" | "video") => {
    setResult(null);
    activity.kind = type === "image" ? "generating_image" : "generating_video";
    
    try {
      const res = type === "image" 
        ? await generateImage({ prompt })
        : await generateVideo({ prompt });
      setResult(res.dataUrl);
    } catch (e) {
      activity.kind = "action_failed";
      console.error(e);
    } finally {
      if (activity.kind !== "action_failed") {
        activity.kind = "idle";
      }
    }
  };

  const handleTTS = () => {
    activity.kind = "generating_tts";
    const utterance = new SpeechSynthesisUtterance(prompt);
    window.speechSynthesis.speak(utterance);
    activity.kind = "idle";
  };

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Multimodal Studio</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Textarea 
          placeholder="Enter prompt..." 
          value={prompt} 
          onChange={(e) => setPrompt(e.target.value)} 
        />
        <Tabs defaultValue="image">
          <TabsList>
            <TabsTrigger value="image">Image</TabsTrigger>
            <TabsTrigger value="video">Video</TabsTrigger>
            <TabsTrigger value="tts">TTS</TabsTrigger>
          </TabsList>
          <TabsContent value="image" className="space-y-2">
            <Button onClick={() => handleGenerate("image")}>Generate Image</Button>
          </TabsContent>
          <TabsContent value="video" className="space-y-2">
            <Button onClick={() => handleGenerate("video")}>Generate Video</Button>
          </TabsContent>
          <TabsContent value="tts" className="space-y-2">
            <Button onClick={handleTTS}>Speak Text</Button>
          </TabsContent>
        </Tabs>
        {result && (
          <div className="mt-4">
            <img src={result} alt="Generated result" className="max-w-full h-auto" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
