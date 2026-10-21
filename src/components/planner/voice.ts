"use client";

import { api } from "@/lib/client/api";

/* ------------------------------------------------------------------ */
/* Browser dictation (Web Speech API): free, optional, text-first      */
/* ------------------------------------------------------------------ */

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function dictationSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function startDictation(handlers: { onText: (text: string, final: boolean) => void; onEnd: () => void; onError: (message: string) => void }): () => void {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) {
    handlers.onError("Dictation isn't supported in this browser. Please type instead.");
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = "en-IN";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (e) => {
    let text = "";
    let final = false;
    for (let i = 0; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
      final = final || e.results[i].isFinal;
    }
    handlers.onText(text, final);
  };
  rec.onerror = (e) =>
    handlers.onError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone permission was denied. You can keep typing." : `Dictation stopped (${e.error}).`);
  rec.onend = handlers.onEnd;
  rec.start();
  return () => rec.stop();
}

/* ------------------------------------------------------------------ */
/* OpenAI Realtime voice over WebRTC                                   */
/* ------------------------------------------------------------------ */

export interface RealtimeSession {
  speak(text: string): void;
  stop(): void;
}

/**
 * Starts a realtime voice session with a short-lived client secret from our
 * server. The realtime model is configured NOT to answer on its own: each
 * finished user transcript is passed to `onTranscript` (which sends it through
 * the same planner API as typed text), and we ask the model to speak the
 * planner's reply. This keeps one trip profile and avoids duplicate answers.
 */
export async function startRealtimeVoice(opts: {
  tripId: string;
  onTranscript: (text: string) => void;
  onStatus: (status: "connecting" | "listening" | "disconnected" | "error", message?: string) => void;
}): Promise<RealtimeSession> {
  opts.onStatus("connecting");
  const session = await api<{ clientSecret: string }>("/api/ai/voice/session", { body: { tripId: opts.tripId } });
  let mic: MediaStream;
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Microphone permission was denied. You can keep typing instead.");
  }
  const pc = new RTCPeerConnection();
  const audio = new Audio();
  audio.autoplay = true;
  pc.ontrack = (e) => {
    audio.srcObject = e.streams[0];
  };
  pc.addTrack(mic.getTracks()[0], mic);
  const dc = pc.createDataChannel("oai-events");
  const seen = new Set<string>();
  dc.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === "conversation.item.input_audio_transcription.completed") {
        const text = String(ev.transcript ?? "").trim();
        if (text && !seen.has(ev.item_id)) {
          seen.add(ev.item_id);
          opts.onTranscript(text);
        }
      } else if (ev.type === "error") {
        opts.onStatus("error", ev.error?.message ?? "Voice error");
      }
    } catch {
      // ignore malformed events
    }
  };
  dc.onopen = () => opts.onStatus("listening");
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") opts.onStatus("disconnected");
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const res = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    body: offer.sdp,
    headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
  });
  if (!res.ok) {
    mic.getTracks().forEach((t) => t.stop());
    pc.close();
    throw new Error("Couldn't connect to the voice service. Please use text chat.");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });

  return {
    speak(text: string) {
      if (dc.readyState !== "open") return;
      dc.send(
        JSON.stringify({
          type: "response.create",
          response: { conversation: "none", output_modalities: ["audio"], instructions: `Read the following aloud exactly, without adding anything: ${text}` },
        }),
      );
    },
    stop() {
      mic.getTracks().forEach((t) => t.stop());
      dc.close();
      pc.close();
      opts.onStatus("disconnected");
    },
  };
}
