/**
 * Voice session state machine (pure, framework-free, unit-tested).
 *
 * Every transition is driven by a real event from the active voice engine
 * (WebRTC data-channel events, Web Speech callbacks, the planner API) or by an
 * explicit user action. The robot UI renders this state and nothing else, so
 * it never claims to be listening or speaking when it isn't.
 */

export type VoiceStatus =
  | "idle" // no session
  | "connecting" // requesting a session / microphone / peer connection
  | "listening" // microphone open, waiting for or hearing the customer
  | "thinking" // a transcript was sent to the planner; waiting for the reply
  | "speaking" // the assistant's audio is playing
  | "muted" // session open, microphone muted (paused)
  | "disconnected" // connection dropped; can reconnect
  | "ended" // the customer ended the session
  | "error"; // could not start or fatal error; text chat still works

export type VoiceEngineKind = "realtime" | "browser";

export interface VoiceState {
  status: VoiceStatus;
  engine: VoiceEngineKind | null;
  muted: boolean;
  /** True while the customer's voice is detected (VAD / speech recognition). */
  userSpeaking: boolean;
  error: string | null;
  /** Number of completed customer voice turns in this session. */
  turns: number;
}

export type VoiceEvent =
  | { type: "START"; engine: VoiceEngineKind }
  | { type: "CONNECTED" }
  | { type: "USER_SPEECH_START" }
  | { type: "USER_SPEECH_END" }
  | { type: "TRANSCRIPT"; text: string }
  | { type: "REPLY_FAILED"; message?: string }
  | { type: "NO_REPLY" }
  | { type: "SPEAK_START" }
  | { type: "SPEAK_END" }
  | { type: "MUTE" }
  | { type: "UNMUTE" }
  | { type: "INTERRUPT" }
  | { type: "DISCONNECTED"; message?: string }
  | { type: "END" }
  | { type: "ERROR"; message: string };

export const initialVoiceState: VoiceState = { status: "idle", engine: null, muted: false, userSpeaking: false, error: null, turns: 0 };

const ACTIVE: VoiceStatus[] = ["listening", "thinking", "speaking", "muted"];
export const isActive = (s: VoiceState) => ACTIVE.includes(s.status);

function idleOrListening(s: VoiceState): VoiceStatus {
  return s.muted ? "muted" : "listening";
}

export function voiceReducer(s: VoiceState, e: VoiceEvent): VoiceState {
  switch (e.type) {
    case "START":
      // Allowed from any non-active state (first start, reconnect, restart after end/error).
      if (isActive(s) || s.status === "connecting") return s;
      return { ...initialVoiceState, status: "connecting", engine: e.engine, turns: s.status === "disconnected" ? s.turns : 0 };
    case "CONNECTED":
      return s.status === "connecting" ? { ...s, status: idleOrListening(s), error: null } : s;
    case "USER_SPEECH_START":
      if (!isActive(s) || s.muted) return s;
      // Speaking over the assistant is a barge-in: the engine cancels playback and we listen.
      return { ...s, userSpeaking: true, status: s.status === "thinking" ? "thinking" : "listening" };
    case "USER_SPEECH_END":
      return isActive(s) ? { ...s, userSpeaking: false } : s;
    case "TRANSCRIPT":
      if (!isActive(s) || !e.text.trim()) return s;
      return { ...s, status: "thinking", userSpeaking: false, turns: s.turns + 1 };
    case "NO_REPLY":
    case "REPLY_FAILED":
      return s.status === "thinking" ? { ...s, status: idleOrListening(s), error: e.type === "REPLY_FAILED" ? (e.message ?? "The planner couldn't reply. Please try again.") : s.error } : s;
    case "SPEAK_START":
      return isActive(s) ? { ...s, status: "speaking" } : s;
    case "SPEAK_END":
      return s.status === "speaking" ? { ...s, status: idleOrListening(s) } : s;
    case "MUTE":
      if (!isActive(s)) return s;
      return { ...s, muted: true, userSpeaking: false, status: s.status === "speaking" || s.status === "thinking" ? s.status : "muted" };
    case "UNMUTE":
      if (!isActive(s)) return s;
      return { ...s, muted: false, status: s.status === "muted" ? "listening" : s.status };
    case "INTERRUPT":
      return s.status === "speaking" ? { ...s, status: idleOrListening(s) } : s;
    case "DISCONNECTED":
      if (s.status === "ended" || s.status === "idle") return s;
      return { ...s, status: "disconnected", userSpeaking: false, error: e.message ?? "The voice connection dropped." };
    case "END":
      return s.status === "idle" ? s : { ...s, status: "ended", userSpeaking: false };
    case "ERROR":
      return { ...s, status: "error", userSpeaking: false, error: e.message };
  }
}

export const VOICE_STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Voice is off",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking…",
  speaking: "Speaking",
  muted: "Muted — paused",
  disconnected: "Disconnected",
  ended: "Voice session ended",
  error: "Voice couldn't start",
};

export const VOICE_GREETING =
  "Hi! Welcome to Pickyourtrail. I'm your AI travel planner. Tell me what kind of holiday you have in mind, and I'll help you plan it.";

/** Maximum length of one voice session before it ends automatically (cost/abuse guard). */
export const MAX_VOICE_SESSION_MS = 10 * 60_000;
