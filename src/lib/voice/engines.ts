/**
 * Voice engines. Both implement the same interface and report only real
 * events (connection, voice activity, final transcripts, audio playback) to the
 * state machine. The planner API is the single "brain": transcripts are sent to
 * it like typed messages and its replies are spoken — the voice layer never
 * invents answers or keeps its own trip state.
 *
 * Browser APIs are injected so the engines can be unit-tested with fakes.
 */
import type { VoiceEvent } from "./machine";

export interface VoiceHandlers {
  onEvent: (e: VoiceEvent) => void;
  /** Real audio levels in [0, 1] when measurable (user microphone, assistant output). */
  onLevel?: (who: "user" | "assistant", level: number) => void;
}

export interface VoiceEngine {
  readonly kind: "realtime" | "browser";
  start(): Promise<void>;
  speak(text: string): void;
  interrupt(): void;
  setMuted(muted: boolean): void;
  stop(): void;
}

/* ------------------------------------------------------------------ */
/* Audio level meter (AnalyserNode) — real levels, optional             */
/* ------------------------------------------------------------------ */

export interface AudioContextLike {
  createMediaStreamSource(stream: MediaStream): { connect(node: unknown): void };
  createAnalyser(): { fftSize: number; frequencyBinCount: number; getByteTimeDomainData(a: Uint8Array): void };
  close(): Promise<void>;
}

export function startLevelMeter(ctx: AudioContextLike | null, stream: MediaStream, onLevel: (l: number) => void): () => void {
  if (!ctx || typeof requestAnimationFrame === "undefined") return () => {};
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let last = 0;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    if (t - last < 50) return; // ~20 fps is plenty for a visual
    last = t;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    onLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/* ------------------------------------------------------------------ */
/* OpenAI Realtime over WebRTC                                          */
/* ------------------------------------------------------------------ */

export interface DataChannelLike {
  readyState: string;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose?: (() => void) | null;
}
export interface PeerConnectionLike {
  connectionState: string;
  ontrack: ((e: { streams: MediaStream[] }) => void) | null;
  onconnectionstatechange: (() => void) | null;
  addTrack(track: MediaStreamTrack, stream: MediaStream): void;
  /** Receive-only audio when no microphone is available. */
  addTransceiver?(kind: "audio", init: { direction: "recvonly" }): unknown;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<{ sdp?: string; type: string }>;
  setLocalDescription(d: { sdp?: string; type: string }): Promise<void>;
  setRemoteDescription(d: { type: "answer"; sdp: string }): Promise<void>;
  close(): void;
}
export interface RealtimeDeps {
  requestSession: () => Promise<{ clientSecret: string }>;
  getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: EnumerateDevices;
  createPeerConnection: () => PeerConnectionLike;
  fetch: typeof fetch;
  createAudio: () => { srcObject: MediaStream | null; autoplay: boolean; pause(): void };
  createAudioContext?: () => AudioContextLike | null;
  callsUrl?: string;
}

export type VoiceStartCode =
  | "unavailable"
  | "permission_denied" // the site is blocked in the browser's site settings, or the prompt was dismissed
  | "blocked_by_os" // the operating system denies the browser microphone access
  | "no_microphone"
  | "mic_in_use" // another app holds the device, or the hardware failed to start
  | "insecure_context"
  | "connection_failed"
  | "unsupported";

export class VoiceStartError extends Error {
  constructor(
    message: string,
    readonly code: VoiceStartCode,
  ) {
    super(message);
  }
}

const KEEP_TYPING = "You can keep planning by typing.";

/** Turns a getUserMedia failure into the real cause and the fix for it. */
export function microphoneError(error: unknown): VoiceStartError {
  const e = microphoneErrorFor(error);
  const name = (error as Error | undefined)?.name ?? "";
  const message = (error as Error | undefined)?.message ?? "";
  if (!name) return e;
  return new VoiceStartError(`${e.message} (Browser reported: ${name}${message ? ` — ${message.slice(0, 120)}` : ""}.)`, e.code);
}

function microphoneErrorFor(error: unknown): VoiceStartError {
  const name = (error as Error | undefined)?.name ?? "";
  const message = (error as Error | undefined)?.message ?? "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    // Chrome reports an OS-level block as "Permission denied by system".
    if (/system/i.test(message)) {
      return new VoiceStartError(
        `Your computer is blocking microphone access for this browser. On Windows: Settings → Privacy & security → Microphone → turn on “Microphone access” and “Let desktop apps access your microphone”, then try again. ${KEEP_TYPING}`,
        "blocked_by_os",
      );
    }
    return new VoiceStartError(
      `Microphone access is blocked for this site. Click the icon at the left of the address bar → Site settings → Microphone → Allow, reload the page and start voice again. ${KEEP_TYPING}`,
      "permission_denied",
    );
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" || name === "NotSupportedError") {
    return new VoiceStartError(`No microphone was found. Connect or enable a microphone, then try again. ${KEEP_TYPING}`, "no_microphone");
  }
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
    return new VoiceStartError(
      `The microphone couldn't be started (every input device was tried). Another app may be holding it — close Teams/Zoom or leave their calls — or the input device is disabled: check Windows Settings → System → Sound → Input and test the microphone there, then try again. ${KEEP_TYPING}`,
      "mic_in_use",
    );
  }
  if (name === "TypeError") {
    return new VoiceStartError(`Voice needs a secure page (https:// or http://localhost). ${KEEP_TYPING}`, "insecure_context");
  }
  return new VoiceStartError(`The microphone couldn't be started${name ? ` (${name})` : ""}. ${KEEP_TYPING}`, "permission_denied");
}

/**
 * Opens the microphone. Asks for echo cancellation/noise suppression and falls
 * back to plain audio if the device can't satisfy those constraints.
 */
type GetUserMedia = (c: MediaStreamConstraints) => Promise<MediaStream>;
type EnumerateDevices = () => Promise<{ kind: string; deviceId: string; label: string }[]>;

/** Device-level failures worth retrying with other settings or another microphone. */
const RETRYABLE = new Set(["OverconstrainedError", "NotReadableError", "TrackStartError", "AbortError"]);

/**
 * Opens the microphone. Tries, in order: the default device with echo
 * cancellation/noise suppression, the default device with plain audio (some
 * Windows drivers refuse the processing constraints), then every other input
 * device. Permission errors are never retried. Throws a VoiceStartError naming
 * the real cause, including the browser's own error text.
 */
export async function requestMicrophone(getUserMedia: GetUserMedia, enumerateDevices?: EnumerateDevices): Promise<MediaStream> {
  let last: unknown;
  for (const constraints of [{ audio: { echoCancellation: true, noiseSuppression: true } }, { audio: true }] as MediaStreamConstraints[]) {
    try {
      return await getUserMedia(constraints);
    } catch (error) {
      last = error;
      if (!RETRYABLE.has((error as Error)?.name)) throw microphoneError(error);
    }
  }
  if (enumerateDevices) {
    const inputs = (await enumerateDevices().catch(() => [])).filter((d) => d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications");
    for (const device of inputs) {
      try {
        return await getUserMedia({ audio: { deviceId: { exact: device.deviceId } } });
      } catch (error) {
        last = error;
        if (!RETRYABLE.has((error as Error)?.name)) throw microphoneError(error);
      }
    }
  }
  throw microphoneError(last);
}

/**
 * `micless`: no microphone is opened; the session only receives the assistant's
 * audio (the customer types, the robot answers aloud). Used when the microphone
 * is blocked or broken on this device.
 */
export function createRealtimeEngine(deps: RealtimeDeps, h: VoiceHandlers, opts: { micless?: boolean } = {}): VoiceEngine {
  let mic: MediaStream | null = null;
  let pc: PeerConnectionLike | null = null;
  let dc: DataChannelLike | null = null;
  let audio: ReturnType<RealtimeDeps["createAudio"]> | null = null;
  let ctx: AudioContextLike | null = null;
  const stopMeters: (() => void)[] = [];
  const seen = new Set<string>();
  let stopped = false;

  const send = (event: Record<string, unknown>) => {
    if (dc?.readyState === "open") dc.send(JSON.stringify(event));
  };

  function cleanup() {
    stopMeters.splice(0).forEach((f) => f());
    mic?.getTracks().forEach((t) => t.stop());
    try {
      dc?.close();
    } catch {}
    try {
      pc?.close();
    } catch {}
    audio?.pause();
    if (audio) audio.srcObject = null;
    void ctx?.close().catch(() => {});
    mic = null;
    pc = null;
    dc = null;
    audio = null;
    ctx = null;
  }

  return {
    kind: "realtime",
    async start() {
      stopped = false;
      // Microphone first, while the click's user activation is fresh, so the browser shows its prompt.
      if (!opts.micless) mic = await requestMicrophone(deps.getUserMedia, deps.enumerateDevices);
      let session: { clientSecret: string };
      try {
        session = await deps.requestSession();
      } catch (e) {
        cleanup();
        throw new VoiceStartError(e instanceof Error ? e.message : "Voice is unavailable right now.", "unavailable");
      }
      ctx = deps.createAudioContext?.() ?? null;
      if (h.onLevel && mic) stopMeters.push(startLevelMeter(ctx, mic, (l) => h.onLevel!("user", l)));
      pc = deps.createPeerConnection();
      audio = deps.createAudio();
      audio.autoplay = true;
      pc.ontrack = (e) => {
        if (!audio) return;
        audio.srcObject = e.streams[0];
        if (h.onLevel) stopMeters.push(startLevelMeter(ctx, e.streams[0], (l) => h.onLevel!("assistant", l)));
      };
      if (mic) pc.addTrack(mic.getTracks()[0], mic);
      else pc.addTransceiver?.("audio", { direction: "recvonly" });
      dc = pc.createDataChannel("oai-events");
      dc.onopen = () => h.onEvent({ type: "CONNECTED" });
      dc.onmessage = (msg) => {
        let ev: { type?: string; item_id?: string; transcript?: string; error?: { message?: string } };
        try {
          ev = JSON.parse(msg.data);
        } catch {
          return;
        }
        switch (ev.type) {
          case "input_audio_buffer.speech_started":
            h.onEvent({ type: "USER_SPEECH_START" });
            break;
          case "input_audio_buffer.speech_stopped":
            h.onEvent({ type: "USER_SPEECH_END" });
            break;
          case "conversation.item.input_audio_transcription.completed": {
            const text = String(ev.transcript ?? "").trim();
            const id = ev.item_id ?? text;
            if (text && !seen.has(id)) {
              seen.add(id);
              h.onEvent({ type: "TRANSCRIPT", text });
            }
            break;
          }
          case "conversation.item.input_audio_transcription.failed":
            h.onEvent({ type: "USER_SPEECH_END" });
            break;
          case "output_audio_buffer.started":
            h.onEvent({ type: "SPEAK_START" });
            break;
          case "output_audio_buffer.stopped":
          case "output_audio_buffer.cleared":
            h.onEvent({ type: "SPEAK_END" });
            break;
          case "error":
            // Non-fatal protocol errors (e.g. cancelling when nothing is playing) are ignored.
            if (!/no active response|cancel/i.test(ev.error?.message ?? "")) h.onEvent({ type: "ERROR", message: "The voice service reported an error. You can keep typing." });
            break;
        }
      };
      pc.onconnectionstatechange = () => {
        if (stopped || !pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          h.onEvent({ type: "DISCONNECTED", message: "The voice connection dropped. Reconnect, or keep typing." });
          cleanup();
        }
      };
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const res = await deps.fetch(deps.callsUrl ?? "https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${session.clientSecret}`, "Content-Type": "application/sdp" },
        });
        if (!res.ok) throw new Error(String(res.status));
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      } catch {
        cleanup();
        throw new VoiceStartError("Couldn't connect to the voice service. You can keep planning by typing.", "connection_failed");
      }
    },
    speak(text: string) {
      // The realtime model only voices the planner's reply; it does not answer on its own.
      send({
        type: "response.create",
        response: { conversation: "none", output_modalities: ["audio"], instructions: `Read the following aloud naturally and exactly, without adding anything: ${text}` },
      });
    },
    interrupt() {
      send({ type: "response.cancel" });
      send({ type: "output_audio_buffer.clear" });
    },
    setMuted(muted: boolean) {
      mic?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    },
    stop() {
      stopped = true;
      cleanup();
    },
  };
}

/* ------------------------------------------------------------------ */
/* Browser voice (Web Speech API) — demo fallback, no AI audio          */
/* ------------------------------------------------------------------ */

export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort?(): void;
  onstart: (() => void) | null;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: unknown;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onboundary: (() => void) | null;
}
export interface BrowserDeps {
  createRecognition: (() => RecognitionLike) | null;
  synth: { speak(u: UtteranceLike): void; cancel(): void; getVoices(): { name: string; lang: string }[] } | null;
  createUtterance: ((text: string) => UtteranceLike) | null;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
  enumerateDevices?: EnumerateDevices;
  createAudioContext?: () => AudioContextLike | null;
}

/** Picks a clear, natural English voice when the browser offers one. */
export function pickVoice(voices: { name: string; lang: string }[]) {
  const pref = [/en-IN/i, /en-GB/i, /en-US/i, /^en/i];
  const natural = (v: { name: string }) => /natural|neural|google|samantha|daniel|serena|aria|jenny/i.test(v.name);
  for (const p of pref) {
    const list = voices.filter((v) => p.test(v.lang));
    if (list.length) return list.find(natural) ?? list[0];
  }
  return voices[0] ?? null;
}

export function createBrowserEngine(deps: BrowserDeps, h: VoiceHandlers): VoiceEngine {
  let rec: RecognitionLike | null = null;
  let mic: MediaStream | null = null;
  let ctx: AudioContextLike | null = null;
  let stopMeter: () => void = () => {};
  let active = false;
  let muted = false;
  let speaking = false;
  let listening = false;
  let connected = false;

  const listen = () => {
    if (!rec || !active || muted || speaking || listening) return;
    try {
      rec.start();
      listening = true;
    } catch {
      // already started
    }
  };
  const pause = () => {
    if (!rec || !listening) return;
    listening = false;
    try {
      rec.stop();
    } catch {}
  };

  return {
    kind: "browser",
    async start() {
      if (!deps.createRecognition || !deps.synth || !deps.createUtterance) {
        throw new VoiceStartError("This browser doesn't support voice. You can keep planning by typing.", "unsupported");
      }
      if (deps.getUserMedia) {
        mic = await requestMicrophone(deps.getUserMedia, deps.enumerateDevices);
        ctx = deps.createAudioContext?.() ?? null;
        if (h.onLevel) stopMeter = startLevelMeter(ctx, mic, (l) => h.onLevel!("user", listening ? l : 0));
      }
      active = true;
      connected = false;
      rec = deps.createRecognition();
      rec.lang = "en-IN";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onstart = () => {
        if (!connected) {
          connected = true;
          h.onEvent({ type: "CONNECTED" });
        }
      };
      rec.onspeechstart = () => h.onEvent({ type: "USER_SPEECH_START" });
      rec.onspeechend = () => h.onEvent({ type: "USER_SPEECH_END" });
      rec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            const text = r[0].transcript.trim();
            if (text) h.onEvent({ type: "TRANSCRIPT", text });
          }
        }
      };
      rec.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          active = false;
          h.onEvent({ type: "ERROR", message: microphoneError(Object.assign(new Error(e.error === "service-not-allowed" ? "Permission denied by system" : "Permission denied"), { name: "NotAllowedError" })).message });
        } else if (e.error === "network") {
          h.onEvent({ type: "DISCONNECTED", message: "Speech recognition lost its connection. Reconnect, or keep typing." });
        }
        // "no-speech" / "aborted" are normal: onend restarts listening.
      };
      rec.onend = () => {
        listening = false;
        // Recognition stops after silence; keep listening while the session is active.
        if (active && !muted && !speaking) setTimeout(listen, 150);
      };
      listen();
    },
    speak(text: string) {
      if (!deps.synth || !deps.createUtterance || !active) return;
      pause(); // don't transcribe our own voice
      deps.synth.cancel();
      const u = deps.createUtterance(text);
      u.lang = "en-IN";
      u.rate = 1;
      u.pitch = 1;
      u.voice = pickVoice(deps.synth.getVoices());
      let ended = false;
      const done = () => {
        if (ended) return;
        ended = true;
        speaking = false;
        h.onLevel?.("assistant", 0);
        h.onEvent({ type: "SPEAK_END" });
        listen();
      };
      u.onstart = () => {
        speaking = true;
        h.onEvent({ type: "SPEAK_START" });
      };
      // Word boundaries are the only real playback signal the Web Speech API exposes.
      u.onboundary = () => h.onLevel?.("assistant", 0.6 + Math.random() * 0.4);
      u.onend = done;
      u.onerror = done;
      speaking = true;
      deps.synth.speak(u);
    },
    interrupt() {
      if (!speaking) return;
      deps.synth?.cancel(); // fires onend → SPEAK_END → listen again
    },
    setMuted(m: boolean) {
      muted = m;
      if (m) pause();
      else listen();
    },
    stop() {
      active = false;
      deps.synth?.cancel();
      pause();
      try {
        rec?.abort?.();
      } catch {}
      stopMeter();
      mic?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      rec = null;
      mic = null;
      ctx = null;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Real browser dependencies                                            */
/* ------------------------------------------------------------------ */

type W = Window & { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike; webkitAudioContext?: new () => AudioContextLike };

export function browserVoiceSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as W;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition) && "speechSynthesis" in window;
}

export function realBrowserDeps(): BrowserDeps {
  const w = window as W;
  const Rec = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return {
    createRecognition: Rec ? () => new Rec() : null,
    synth: "speechSynthesis" in window ? (window.speechSynthesis as unknown as BrowserDeps["synth"]) : null,
    createUtterance: "SpeechSynthesisUtterance" in window ? (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike : null,
    getUserMedia: navigator.mediaDevices?.getUserMedia ? (c) => navigator.mediaDevices.getUserMedia(c) : undefined,
    enumerateDevices: navigator.mediaDevices?.enumerateDevices ? () => navigator.mediaDevices.enumerateDevices() : undefined,
    createAudioContext: audioContextFactory,
  };
}

function audioContextFactory(): AudioContextLike | null {
  const w = window as W;
  const Ctor = (window.AudioContext as unknown as (new () => AudioContextLike) | undefined) ?? w.webkitAudioContext;
  try {
    return Ctor ? new Ctor() : null;
  } catch {
    return null;
  }
}

export function realRealtimeDeps(requestSession: RealtimeDeps["requestSession"]): RealtimeDeps {
  return {
    requestSession,
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    enumerateDevices: navigator.mediaDevices?.enumerateDevices ? () => navigator.mediaDevices.enumerateDevices() : undefined,
    createPeerConnection: () => new RTCPeerConnection() as unknown as PeerConnectionLike,
    fetch: (...a) => fetch(...a),
    createAudio: () => new Audio() as unknown as ReturnType<RealtimeDeps["createAudio"]>,
    createAudioContext: audioContextFactory,
  };
}
