"use client";

import { Hand, Keyboard, Mic, MicOff, PhoneOff, RefreshCw, Volume2 } from "lucide-react";
import { VOICE_STATUS_LABEL, isActive } from "@/lib/voice/machine";
import { Button, cn } from "@/components/ui";
import { RobotAvatar, RobotStage } from "@/components/robot";
import type { VoiceAssistant } from "./use-voice-assistant";

const HINT: Partial<Record<string, string>> = {
  connecting: "Allow microphone access if your browser asks.",
  listening: "Go ahead — for example “A five-day family trip to Bali in December, budget 1.5 lakh”.",
  thinking: "Updating your trip profile…",
  speaking: "Start talking or tap Interrupt to cut in.",
  muted: "Your microphone is off. Resume when you're ready.",
  disconnected: "Your trip is saved. Reconnect or keep typing.",
  ended: "Your trip is saved. Start again any time.",
};

/** Robot voice controls for the planner. Shows the same robot and only real session states. */
export function VoicePanel({ voice, onSwitchToText, highlight, ready = true }: { voice: VoiceAssistant; onSwitchToText: () => void; highlight?: boolean; /** False until the trip exists to attach the session to. */ ready?: boolean }) {
  const { state, levels, availableEngine } = voice;
  const active = isActive(state);
  const engineLabel =
    state.engine === "realtime" || (!state.engine && availableEngine === "realtime")
      ? "Live AI voice (OpenAI Realtime)"
      : state.engine === "browser" || availableEngine === "browser"
        ? "Browser voice (demo) — speech handled by your browser, no AI audio"
        : null;

  if (state.status === "idle") {
    return (
      <div className={cn("mx-4 mt-3 flex items-center gap-3 rounded-2xl border px-3 py-2.5", highlight ? "border-ai bg-ai/15" : "border-border bg-lavender-surface/60")}>
        <RobotAvatar size={40} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Prefer to talk? Plan your trip with the AI robot.</p>
          <p className="truncate text-xs text-muted">{engineLabel ?? "Voice isn't available in this browser — typing works everywhere."}</p>
        </div>
        <Button size="sm" variant="ai" onClick={() => void voice.start()} disabled={!availableEngine || !ready} aria-label="Talk to Pickyourtrail AI">
          <Mic className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Talk to Pickyourtrail AI</span>
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Voice assistant" className="mx-4 mt-3 overflow-hidden rounded-2xl border border-lavender/60 bg-gradient-to-br from-nav-deep to-[#2a2452] text-white">
      <div className="flex flex-col items-center gap-3 p-3 sm:flex-row sm:gap-4 sm:p-4">
        <RobotStage status={state.status} userLevel={levels.user} assistantLevel={levels.assistant} size={112} className="shrink-0" />
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="flex items-center justify-center gap-2 text-[15px] font-semibold sm:justify-start" aria-live="polite">
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                state.status === "listening" ? "bg-ai" : state.status === "speaking" ? "bg-lavender" : state.status === "error" || state.status === "disconnected" ? "bg-tomato" : "bg-white/40",
                (state.status === "listening" && state.userSpeaking) || state.status === "speaking" ? "pulse-dot" : "",
              )}
              aria-hidden
            />
            {voice.micless && state.status === "muted" ? "Ready — type to talk" : VOICE_STATUS_LABEL[state.status]}
            {state.status === "listening" && state.userSpeaking && <span className="text-xs font-normal text-white/70">· hearing you</span>}
          </p>
          <p className="mt-0.5 text-xs text-white/70">
            {state.status === "error"
              ? state.error
              : voice.micless
                ? "Microphone not used on this device. Type below — the robot answers aloud."
                : state.status === "speaking" && state.engine === "browser"
                  ? "Tap Interrupt to cut in."
                  : (HINT[state.status] ?? "")}
          </p>
          {state.error && state.status !== "error" && <p className="mt-0.5 text-xs text-[#ffb4ab]">{state.error}</p>}
          {voice.notice && <p className="mt-0.5 text-xs text-lavender">{voice.notice}</p>}
          {engineLabel && <p className="mt-1 text-[11px] text-white/50">{engineLabel}</p>}
          <div className="mt-2.5 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            {state.status === "error" && voice.micProblem && availableEngine === "realtime" && (
              <Button size="sm" variant="ai" onClick={() => void voice.startWithoutMic()} disabled={!ready}>
                <Volume2 className="h-3.5 w-3.5" aria-hidden /> Hear the robot without a microphone
              </Button>
            )}
            {active && !voice.micless && (
              <Button size="sm" variant="secondary" onClick={voice.toggleMute} aria-pressed={state.muted} aria-label={state.muted ? "Resume (unmute microphone)" : "Pause (mute microphone)"}>
                {state.muted ? <Mic className="h-3.5 w-3.5" aria-hidden /> : <MicOff className="h-3.5 w-3.5" aria-hidden />} {state.muted ? "Resume" : "Mute"}
              </Button>
            )}
            {state.status === "speaking" && (
              <Button size="sm" variant="secondary" onClick={voice.interrupt} aria-label="Interrupt the assistant">
                <Hand className="h-3.5 w-3.5" aria-hidden /> Interrupt
              </Button>
            )}
            {(state.status === "disconnected" || state.status === "ended" || state.status === "error") && availableEngine && (
              <Button size="sm" variant="ai" onClick={() => void voice.start()} disabled={!ready}>
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {state.status === "disconnected" ? "Reconnect" : "Start voice"}
              </Button>
            )}
            {(active || state.status === "connecting") && (
              <Button size="sm" variant="secondary" className="!text-danger" onClick={voice.end} aria-label="End voice session">
                <PhoneOff className="h-3.5 w-3.5" aria-hidden /> End
              </Button>
            )}
            <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={onSwitchToText}>
              <Keyboard className="h-3.5 w-3.5" aria-hidden /> Switch to text
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
