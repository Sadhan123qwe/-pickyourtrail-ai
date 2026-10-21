"use client";

import { MicOff, WifiOff } from "lucide-react";
import type { VoiceStatus } from "@/lib/voice/machine";
import { cn } from "./ui";

/**
 * The Pickyourtrail AI robot mascot (approved asset: public/images/pickyourtrail-ai-robot.png;
 * optimized crops in public/images/robot). One component so the same robot appears everywhere.
 */
export function RobotAvatar({ size = 32, className, ring = true }: { size?: number; className?: string; ring?: boolean }) {
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-nav-deep", ring && "ring-2 ring-lavender/60", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <picture>
        <source srcSet="/images/robot/robot-head-256.webp" type="image/webp" />
        <img src="/images/robot/robot-head-256.png" alt="" width={size} height={size} className="h-[112%] w-[112%] max-w-none object-cover" draggable={false} />
      </picture>
    </span>
  );
}

/**
 * Full-body robot that reflects the real voice session. Ring scale follows the
 * measured microphone level while listening and the assistant's audio level
 * while speaking; nothing animates when the session isn't doing that work.
 */
export function RobotStage({
  status,
  userLevel = 0,
  assistantLevel = 0,
  size = 168,
  className,
}: {
  status: VoiceStatus;
  userLevel?: number;
  assistantLevel?: number;
  size?: number;
  className?: string;
}) {
  const level = status === "speaking" ? assistantLevel : status === "listening" ? userLevel : 0;
  const ringScale = 1 + Math.min(level, 1) * 0.22;
  const dim = status === "idle" || status === "ended" || status === "disconnected" || status === "error";
  const ringColor =
    status === "speaking" ? "border-lavender" : status === "listening" ? "border-ai" : status === "error" ? "border-tomato/70" : status === "muted" ? "border-slate-300" : "border-lavender/50";
  return (
    <div className={cn("relative flex items-center justify-center", className)} style={{ width: size * 1.25, height: size * 1.25 }} data-voice-status={status}>
      {/* Halo — glow strength follows the real level */}
      <span
        aria-hidden
        className={cn("absolute rounded-full blur-2xl transition-opacity duration-150", status === "listening" ? "bg-ai/40" : status === "speaking" ? "bg-lavender/60" : "bg-lavender/25")}
        style={{ width: size, height: size, opacity: dim ? 0.15 : 0.35 + level * 0.6 }}
      />
      {/* Level ring */}
      <span
        aria-hidden
        className={cn("absolute rounded-full border-[3px] transition-transform duration-100 ease-out motion-reduce:transition-none", ringColor, status === "thinking" && "voice-spin border-dashed", status === "connecting" && "voice-spin border-dotted")}
        style={{ width: size * 0.98, height: size * 0.98, transform: `scale(${ringScale})` }}
      />
      {status === "speaking" && (
        <span aria-hidden className="absolute rounded-full border border-lavender/50" style={{ width: size * 1.12, height: size * 1.12, transform: `scale(${1 + assistantLevel * 0.12})` }} />
      )}
      <picture>
        <source srcSet="/images/robot/robot-512.webp" type="image/webp" />
        <img
          src="/images/robot/robot-512.png"
          alt="Pickyourtrail AI travel assistant robot"
          width={size * (512 / 768)}
          height={size}
          className={cn("relative select-none drop-shadow-[0_10px_24px_rgba(23,21,47,0.35)] transition-[filter,opacity] duration-300", dim && "opacity-60 grayscale-[0.6]")}
          style={{ height: size, width: "auto" }}
          draggable={false}
        />
      </picture>
      {status === "muted" && (
        <span className="absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-nav-deep text-white ring-2 ring-white" title="Microphone muted">
          <MicOff className="h-4 w-4" aria-hidden />
        </span>
      )}
      {(status === "disconnected" || status === "error") && (
        <span className="absolute bottom-2 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-tomato text-white ring-2 ring-white" title={status === "error" ? "Voice unavailable" : "Disconnected"}>
          <WifiOff className="h-4 w-4" aria-hidden />
        </span>
      )}
    </div>
  );
}
