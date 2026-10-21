"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/client/api";
import {
  MAX_VOICE_SESSION_MS,
  initialVoiceState,
  isActive,
  voiceReducer,
  type VoiceEvent,
  type VoiceState,
} from "@/lib/voice/machine";
import {
  VoiceStartError,
  browserVoiceSupported,
  createBrowserEngine,
  createRealtimeEngine,
  realBrowserDeps,
  realRealtimeDeps,
  type VoiceEngine,
} from "@/lib/voice/engines";

export interface VoiceAssistant {
  state: VoiceState;
  /** True when the session runs without a microphone (type to talk, robot answers aloud). */
  micless: boolean;
  /** True when the last start failed because of the microphone (offer the mic-less mode). */
  micProblem: boolean;
  startWithoutMic: () => Promise<void>;
  levels: { user: number; assistant: number };
  /** Which engine would be used if started now. */
  availableEngine: "realtime" | "browser" | null;
  start: () => Promise<void>;
  end: () => void;
  toggleMute: () => void;
  interrupt: () => void;
  /** Speak an application message (greeting, itinerary summary) through the active session. */
  say: (text: string) => void;
  notice: string | null;
}

/**
 * Speech-to-speech session for the planner. Voice transcripts go through the
 * same planner API as typed messages (`onTranscript`), whose reply is then
 * spoken; trip state therefore stays in one place and survives reloads.
 */
export function useVoiceAssistant(opts: {
  tripId: string | null;
  realtimeAvailable: boolean | undefined;
  onTranscript: (text: string) => Promise<string | null>;
  greeting: () => string;
}): VoiceAssistant {
  const [state, dispatchRaw] = useReducer(voiceReducer, initialVoiceState);
  const stateRef = useRef<VoiceState>(state);
  const engine = useRef<VoiceEngine | null>(null);
  const [levels, setLevels] = useState({ user: 0, assistant: 0 });
  const pendingLevels = useRef({ user: 0, assistant: 0 });
  const levelRaf = useRef<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [micless, setMicless] = useState(false);
  const [micProblem, setMicProblem] = useState(false);
  const miclessRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
    stateRef.current = state;
  });

  const dispatch = useCallback((e: VoiceEvent) => {
    stateRef.current = voiceReducer(stateRef.current, e);
    dispatchRaw(e);
  }, []);

  // Read browser capability after hydration so server and client render the same markup.
  const browserOk = useSyncExternalStore(noopSubscribe, browserVoiceSupported, () => false);
  const availableEngine: VoiceAssistant["availableEngine"] = opts.realtimeAvailable ? "realtime" : browserOk ? "browser" : null;

  const speak = useCallback((text: string) => {
    const clean = text.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim();
    if (clean && engine.current && isActive(stateRef.current)) engine.current.speak(clean.slice(0, 1200));
  }, []);

  const onEvent = useCallback(
    (e: VoiceEvent) => {
      const before = stateRef.current;
      // Barge-in: the customer started talking while the assistant was speaking.
      if (e.type === "USER_SPEECH_START" && before.status === "speaking") engine.current?.interrupt();
      dispatch(e);
      if (e.type === "CONNECTED") {
        // Without a microphone the session idles "muted": the customer types, the robot speaks.
        if (miclessRef.current) dispatch({ type: "MUTE" });
        speak(optsRef.current.greeting());
      }
      if (e.type === "TRANSCRIPT") {
        optsRef.current
          .onTranscript(e.text)
          .then((reply) => {
            if (reply && isActive(stateRef.current)) speak(reply);
            else dispatch({ type: "NO_REPLY" });
          })
          .catch((err: unknown) => dispatch({ type: "REPLY_FAILED", message: err instanceof Error ? err.message : undefined }));
      }
      if (e.type === "DISCONNECTED" || e.type === "ERROR") {
        engine.current?.stop();
        engine.current = null;
      }
    },
    [dispatch, speak],
  );

  const onLevel = useCallback((who: "user" | "assistant", level: number) => {
    pendingLevels.current = { ...pendingLevels.current, [who]: level };
    if (levelRaf.current === null && typeof requestAnimationFrame !== "undefined") {
      levelRaf.current = requestAnimationFrame(() => {
        levelRaf.current = null;
        setLevels({ ...pendingLevels.current });
      });
    }
  }, []);

  const end = useCallback(() => {
    engine.current?.stop();
    engine.current = null;
    if (timer.current) clearTimeout(timer.current);
    dispatch({ type: "END" });
    setLevels({ user: 0, assistant: 0 });
  }, [dispatch]);

  const start = useCallback(async (startOpts: { micless?: boolean } = {}) => {
    const tripId = optsRef.current.tripId;
    if (!tripId || isActive(stateRef.current) || stateRef.current.status === "connecting") return;
    setNotice(null);
    const withoutMic = !!startOpts.micless && !!optsRef.current.realtimeAvailable;
    miclessRef.current = withoutMic;
    setMicless(withoutMic);
    setMicProblem(false);
    const kind = optsRef.current.realtimeAvailable ? "realtime" : browserVoiceSupported() ? "browser" : null;
    if (!kind) {
      dispatch({ type: "START", engine: "browser" });
      dispatch({ type: "ERROR", message: "Voice isn't available here: live AI voice isn't configured and this browser has no speech support. You can keep typing." });
      return;
    }
    dispatch({ type: "START", engine: kind });
    const handlers = { onEvent, onLevel };
    const e =
      kind === "realtime"
        ? createRealtimeEngine(
            realRealtimeDeps(() => api<{ clientSecret: string }>("/api/ai/voice/session", { body: { tripId } })),
            handlers,
            { micless: withoutMic },
          )
        : createBrowserEngine(realBrowserDeps(), handlers);
    engine.current = e;
    try {
      await e.start();
    } catch (err) {
      engine.current = null;
      e.stop();
      const micCodes = ["permission_denied", "blocked_by_os", "no_microphone", "mic_in_use", "insecure_context"];
      setMicProblem(err instanceof VoiceStartError && micCodes.includes(err.code));
      dispatch({ type: "ERROR", message: err instanceof VoiceStartError || err instanceof Error ? err.message : "Voice couldn't start. You can keep typing." });
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setNotice("The voice session ended after 10 minutes. Start it again any time — your trip is saved.");
      end();
    }, MAX_VOICE_SESSION_MS);
  }, [dispatch, onEvent, onLevel, end]);

  const toggleMute = useCallback(() => {
    const s = stateRef.current;
    if (!isActive(s) || !engine.current || miclessRef.current) return;
    const next = !s.muted;
    if (next && s.status === "speaking") engine.current.interrupt();
    engine.current.setMuted(next);
    dispatch({ type: next ? "MUTE" : "UNMUTE" });
  }, [dispatch]);

  const interrupt = useCallback(() => {
    if (stateRef.current.status !== "speaking") return;
    engine.current?.interrupt();
    dispatch({ type: "INTERRUPT" });
  }, [dispatch]);

  // Clean up the microphone and connection when leaving the page.
  useEffect(
    () => () => {
      engine.current?.stop();
      engine.current = null;
      if (timer.current) clearTimeout(timer.current);
      if (levelRaf.current !== null) cancelAnimationFrame(levelRaf.current);
    },
    [],
  );

  const startWithoutMic = useCallback(() => start({ micless: true }), [start]);
  return { state, micless, micProblem, startWithoutMic, levels, availableEngine, start: () => start(), end, toggleMute, interrupt, say: speak, notice };
}

function noopSubscribe() {
  return () => {};
}
