"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, CheckCircle2, Circle, CloudCheck, ListChecks, Mic, MicOff, Pencil, RotateCcw, Save, Send, Sparkles, Square, Wand2 } from "lucide-react";
import { api, errorMessage, newClientId, useApi } from "@/lib/client/api";
import { useToast } from "@/components/feedback";
import {
  ESSENTIAL_FIELDS,
  FIELD_KEYS,
  FIELD_LABELS,
  describeField,
  essentialsResolved,
  isRelevant,
  isResolved,
  type FieldKey,
  type FieldStatus,
  type Provenance,
  type TripProfile,
} from "@/lib/planner/profile";
import { Alert, Badge, Button, Card, ErrorState, GlassPanel, Skeleton, TypingIndicator, cn } from "@/components/ui";
import { AiSourceBadge } from "@/components/status";
import { RichText, stripMarkdown } from "@/components/rich-text";
import { formatMoney } from "@/lib/client/format";
import { DestinationImage } from "@/components/destination-image";
import { FieldEditor } from "./field-editor";
import { dictationSupported, startDictation } from "./voice";
import { useVoiceAssistant } from "@/components/voice/use-voice-assistant";
import { VoicePanel } from "@/components/voice/voice-panel";
import { RobotAvatar } from "@/components/robot";
import { VOICE_GREETING, isActive as voiceIsActive } from "@/lib/voice/machine";

interface Question {
  key: string;
  text: string;
  quickReplies: string[];
  multiSelect?: boolean;
  optional: boolean;
}
interface Recommendation {
  id: string;
  name: string;
  image: string;
  reasons: string[];
  estimatedPerPerson: number;
}
interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "agent";
  content: string;
  pending?: boolean;
  failed?: boolean;
  clientId?: string;
  recommendations?: Recommendation[];
  itineraryUpdate?: ItineraryUpdate | null;
  createdAt?: string;
}
interface ItineraryUpdate {
  itineraryId: string | null;
  version: number | null;
  total: number | null;
  actions: { tool: string; status: string; summary: string }[];
}
interface Snapshot {
  trip: { id: string; title: string; status: string };
  conversationId: string;
  profile: TripProfile;
  status: FieldStatus;
  provenance?: Provenance;
  version: number;
  completion: { resolved: number; total: number };
  messages: { id: string; role: ChatMessage["role"]; content: string; meta: Record<string, unknown> | null; createdAt?: string }[];
  question: Question | null;
  stage: string;
  itineraryId: string | null;
}
interface TurnResponse {
  trip: { id: string; title: string; status: string };
  profile: TripProfile;
  status: FieldStatus;
  provenance?: Provenance;
  version: number;
  completion: { resolved: number; total: number };
  turn: { reply: string; question: Question | null; stage: string; recommendations: Recommendation[]; itineraryUpdate?: ItineraryUpdate | null };
  ai: { source: string; notice: string | null };
}
interface TripListItem {
  id: string;
  title: string;
  status: string;
  updated_at: string;
  destination_id: string | null;
}

export function Planner() {
  const router = useRouter();
  const params = useSearchParams();
  const tripParam = params.get("trip");
  const q = params.get("q");
  const forceNew = params.get("new") === "1";
  const keepVoice = params.get("voice") === "1" ? "&voice=1" : "";
  const toast = useToast();
  const [tripId, setTripIdState] = useState<string | null>(tripParam);
  // The active trip id is mirrored in a ref so async flows always use the current trip.
  const tripRef = useRef<string | null>(tripParam);
  const setTripId = useCallback((id: string) => {
    tripRef.current = id;
    setTripIdState(id);
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [profile, setProfile] = useState<TripProfile | null>(null);
  const [status, setStatus] = useState<FieldStatus>({});
  const [provenance, setProvenance] = useState<Provenance>({});
  const [completion, setCompletion] = useState({ resolved: 0, total: 15 });
  const [question, setQuestion] = useState<Question | null>(null);
  const [stage, setStage] = useState("collecting");
  const [aiInfo, setAiInfo] = useState<{ source: string; notice: string | null } | null>(null);
  const [input, setInput] = useState("");
  const [multi, setMulti] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [resumable, setResumable] = useState<TripListItem[] | null>(null);
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [itineraryId, setItineraryId] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const stopDictation = useRef<(() => void) | null>(null);
  const voiceActiveRef = useRef(false);
  const lastSent = useRef({ text: "", at: 0 });
  const sayRef = useRef<(text: string) => void>(() => {});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [tripTitle, setTripTitle] = useState<string | null>(null);
  const [tripStatus, setTripStatus] = useState<string | null>(null);
  const [savingTrip, setSavingTrip] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Static data only — no AI call on page load.
  const aiStatus = useApi<{ voice: { realtimeAvailable: boolean } }>("/api/ai/status");
  const destinations = useApi<{ items: { id: string; name: string; image: string; tagline: string; bestMonths: number[]; idealDays: [number, number] }[] }>("/api/destinations");
  const me = useApi<{ user: { id: string; name: string } | null }>("/api/profile");
  const signedIn = !!me.data?.user;

  const canDictate = useSyncExternalStore(noopSubscribe, dictationSupported, () => false);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const applySnapshot = useCallback((s: Snapshot) => {
    setTripId(s.trip.id);
    setTripTitle(s.trip.title);
    setTripStatus(s.trip.status);
    setProfile(s.profile);
    setStatus(s.status);
    setProvenance(s.provenance ?? {});
    setCompletion(s.completion);
    setQuestion(s.question);
    setStage(s.stage);
    setItineraryId(s.itineraryId);
    setMessages(
      s.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          recommendations: (m.meta?.recommendations as Recommendation[] | undefined) ?? undefined,
          itineraryUpdate: (m.meta?.itineraryUpdate as ItineraryUpdate | null | undefined) ?? null,
          createdAt: m.createdAt,
        })),
    );
  }, [setTripId]);

  const loadTrip = useCallback(
    async (id: string) => {
      setLoadError(null);
      try {
        applySnapshot(await api<Snapshot>(`/api/trips/preferences/${id}`));
      } catch (e) {
        setLoadError(e);
      }
    },
    [applySnapshot],
  );

  const startNew = useCallback(async () => {
    setResumable(null);
    setLoadError(null);
    try {
      const res = await api<{ trip: { id: string } }>("/api/trips/preferences", { method: "POST" });
      router.replace(`/plan?trip=${res.trip.id}${keepVoice}`);
      await loadTrip(res.trip.id);
    } catch (e) {
      setLoadError(e);
    }
  }, [router, loadTrip, keepVoice]);

  const generate = useCallback(async (forTrip?: string) => {
    const id = forTrip ?? tripRef.current;
    if (!id) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await api<{ itinerary: { id: string; days: { dayNumber: number; title: string }[]; budget: { total: number } } }>("/api/itineraries/generate", { body: { tripId: id } });
      setItineraryId(res.itinerary.id);
      if (voiceActiveRef.current) {
        // Voice session: stay here, show the itinerary in the chat and explain it concisely aloud.
        const it = res.itinerary;
        const days = it.days.slice(0, 4).map((d) => `Day ${d.dayNumber}: ${d.title}`).join(". ");
        const spoken = `Your ${it.days.length}-day itinerary is ready. ${days}${it.days.length > 4 ? ", and more" : ""}. The estimated total is ${formatMoney(it.budget.total)}. You can ask me to make it cheaper or slower, or open the itinerary to see every detail.`;
        setMessages((m) => [
          ...m,
          { id: newClientId("a"), role: "assistant", content: spoken, itineraryUpdate: { itineraryId: it.id, version: null, total: it.budget.total, actions: [{ tool: "generate_itinerary", status: "completed", summary: "Itinerary generated" }] }, createdAt: new Date().toISOString() },
        ]);
        sayRef.current(spoken);
        setGenerating(false);
        return;
      }
      router.push(`/trips/${id}/itinerary`);
    } catch (e) {
      setGenerateError(errorMessage(e));
      setGenerating(false);
    }
  }, [router]);

  const send = useCallback(
    (text: string, opts: { channel?: "text" | "voice"; clientId?: string; tripId?: string } = {}): Promise<string | null> => {
      const message = text.trim();
      const targetTrip = opts.tripId ?? tripRef.current;
      if (!message || !targetTrip) return Promise.resolve(null);
      // Ignore an accidental double submit of the same message (retries pass their clientId).
      const now = Date.now();
      if (!opts.clientId && lastSent.current.text === message && now - lastSent.current.at < 1500) return Promise.resolve(null);
      lastSent.current = { text: message, at: now };
      const clientId = opts.clientId ?? newClientId("m");
      if (!opts.clientId) setMessages((m) => [...m, { id: clientId, clientId, role: "user", content: message, pending: true, createdAt: new Date().toISOString() }]);
      else setMessages((m) => m.map((x) => (x.clientId === clientId ? { ...x, failed: false, pending: true } : x)));
      // Serialise turns so overlapping voice and text messages never race.
      const run = async (): Promise<string | null> => {
        setSending(true);
        try {
          const res = await api<TurnResponse>("/api/ai/chat", { body: { mode: "planner", tripId: targetTrip, message, clientMessageId: clientId, channel: opts.channel ?? "text" } });
          setMessages((m) => [
            ...m.map((x) => (x.clientId === clientId ? { ...x, pending: false } : x)),
            { id: newClientId("a"), role: "assistant", content: res.turn.reply, recommendations: res.turn.recommendations, itineraryUpdate: res.turn.itineraryUpdate ?? null, createdAt: new Date().toISOString() },
          ]);
          setProfile(res.profile);
          setTripTitle(res.trip.title);
          setTripStatus(res.trip.status);
          setStatus(res.status);
          setProvenance(res.provenance ?? {});
          setCompletion(res.completion);
          setQuestion(res.turn.question);
          setStage(res.turn.stage);
          setAiInfo(res.ai);
          setSavedAt(new Date().toISOString());
          if (res.turn.itineraryUpdate?.itineraryId) setItineraryId(res.turn.itineraryUpdate.itineraryId);
          setMulti([]);
          if (res.turn.stage === "ready") void generate(res.trip.id);
          // Typed messages during a voice session are answered aloud too (voice turns are spoken by the voice hook).
          if (opts.channel !== "voice" && voiceActiveRef.current) sayRef.current(stripMarkdown(res.turn.reply));
          return stripMarkdown(res.turn.reply);
        } catch (e) {
          setMessages((m) => m.map((x) => (x.clientId === clientId ? { ...x, pending: false, failed: true, content: x.content } : x)));
          setAiInfo({ source: "error", notice: errorMessage(e) });
          return null;
        } finally {
          setSending(false);
        }
      };
      const result = queue.current.then(run);
      queue.current = result.then(() => undefined);
      return result;
    },
    [generate],
  );

  const realtimeAvailable = aiStatus.data?.voice.realtimeAvailable;
  const voiceA = useVoiceAssistant({
    tripId,
    realtimeAvailable,
    onTranscript: (text) => send(text, { channel: "voice" }),
    greeting: () => {
      const hasTalked = messages.some((m) => m.role === "user");
      const text = hasTalked ? `Welcome back! Let's continue planning your trip. ${question?.text ?? "What would you like to change?"}` : VOICE_GREETING;
      // Show what the robot says in the transcript too.
      setMessages((m) => [...m, { id: newClientId("a"), role: "assistant", content: text, createdAt: new Date().toISOString() }]);
      return text;
    },
  });
  useEffect(() => {
    voiceActiveRef.current = voiceIsActive(voiceA.state);
    sayRef.current = voiceA.say;
  });

  // Initial load: resume a trip, start from a prompt, or offer to resume an unfinished plan.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      if (tripParam) return loadTrip(tripParam);
      if (forceNew && !q) return startNew();
      if (q) {
        try {
          const res = await api<{ trip: { id: string } }>("/api/trips/preferences", { method: "POST" });
          router.replace(`/plan?trip=${res.trip.id}${keepVoice}`);
          await loadTrip(res.trip.id);
          void send(q, { tripId: res.trip.id });
        } catch (e) {
          setLoadError(e);
        }
        return;
      }
      try {
        const res = await api<{ items: TripListItem[] }>("/api/trips");
        const drafts = res.items.filter((t) => t.status === "planning" && t.destination_id).slice(0, 3);
        if (drafts.length) setResumable(drafts);
        else await startNew();
      } catch (e) {
        setLoadError(e);
      }
    })();
  }, [tripParam, q, forceNew, loadTrip, startNew, router, send, keepVoice]);


  function toggleDictation() {
    if (dictating) {
      stopDictation.current?.();
      return;
    }
    setVoiceMessage(null);
    setDictating(true);
    const base = input ? `${input} ` : "";
    stopDictation.current = startDictation({
      onText: (t) => setInput(base + t),
      onEnd: () => setDictating(false),
      onError: (m) => {
        setVoiceMessage(m);
        setDictating(false);
      },
    });
  }

  async function saveField(updates: Partial<TripProfile>, clear: FieldKey[]) {
    if (!tripId) return;
    await api(`/api/trips/preferences/${tripId}`, { method: "PATCH", body: { updates, clear } });
    await loadTrip(tripId);
  }

  if (loadError) {
    return (
      <div className="px-4 py-10">
        <Card className="mx-auto max-w-lg">
          <ErrorState error={loadError} onRetry={() => (tripParam ? loadTrip(tripParam) : startNew())} />
          {tripParam && (
            <div className="pb-6 text-center">
              <Button variant="secondary" onClick={startNew}>
                Start a new plan instead
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (resumable) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <h1 className="text-[26px] font-semibold tracking-tight">Pick up where you left off?</h1>
        <p className="mt-1 text-[13px] text-muted">You have unfinished trip plans. Your answers were saved automatically.</p>
        <div className="mt-6 space-y-2.5">
          {resumable.map((t) => (
            <Card key={t.id} className="flex items-center justify-between gap-3 p-4">
              <div>
                <p className="font-medium">{t.title}</p>
                <p className="text-xs text-muted">Last updated {new Date(t.updated_at).toLocaleString("en-IN")}</p>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setResumable(null);
                  router.replace(`/plan?trip=${t.id}`);
                  void loadTrip(t.id);
                }}
              >
                <RotateCcw className="h-4 w-4" aria-hidden /> Resume
              </Button>
            </Card>
          ))}
        </div>
        <Button className="mt-6" variant="ai" onClick={startNew}>
          <Sparkles className="h-4 w-4" aria-hidden /> Start a new trip plan
        </Button>
      </div>
    );
  }

  const ready = profile ? essentialsResolved(profile, status) : false;
  const pct = Math.round((completion.resolved / Math.max(completion.total, 1)) * 100);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const dest = profile?.destinationId ? destinations.data?.items.find((d) => d.id === profile.destinationId) : undefined;

  async function saveProgress() {
    if (!tripId) return;
    setSavingTrip(true);
    try {
      if (tripStatus === "planning" || tripStatus === "itinerary_ready") {
        await api(`/api/trips/${tripId}`, { method: "PATCH", body: { status: "saved" } });
        setTripStatus("saved");
      }
      toast({ tone: "success", title: "Trip saved to My Trips", description: signedIn ? "Your answers and itinerary are stored on your account." : "Saved in this browser. Sign in to keep it on every device." });
    } catch (e) {
      toast({ tone: "error", title: "Couldn't save the trip", description: errorMessage(e) });
    } finally {
      setSavingTrip(false);
    }
  }

  const profilePanel = (
    <TripProfilePanel
      profile={profile}
      status={status}
      provenance={provenance}
      pct={pct}
      question={question}
      ready={ready}
      stage={stage}
      itineraryId={itineraryId}
      tripId={tripId}
      tripStatus={tripStatus}
      savedAt={savedAt}
      generating={generating}
      onEdit={(f) => setEditing(f)}
      onGenerate={() => generate()}
    />
  );

  return (
    <div className="mx-auto max-w-[1440px] px-3 py-3 sm:px-5 sm:py-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="flex h-[calc(100dvh-5.5rem)] min-h-[560px] flex-col overflow-hidden lg:h-[calc(100dvh-7.75rem)]">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
            <Link href="/trips" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border text-muted hover:bg-lavender-surface hover:text-foreground" aria-label="Back to My Trips" title="Back to My Trips">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <span className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-lavender text-nav-deep sm:flex">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="whitespace-nowrap text-[17px] font-semibold leading-tight">AI Trip Planner</h1>
              <p className="flex min-w-0 items-center gap-1 text-xs text-muted">
                <CloudCheck className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                <span className="truncate">
                  {tripTitle ?? "New trip"} · {savedAt ? `saved ${new Date(savedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "saved automatically"}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="hidden items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-medium lg:inline-flex"
                title={aiInfo?.source === "error" ? "Last request failed — retry from the message" : "Planner mode"}
              >
                <span className={cn("h-2 w-2 rounded-full", aiInfo?.source === "error" ? "bg-tomato" : sending ? "pulse-dot bg-ai ring-1 ring-nav-deep/30" : "bg-ai ring-1 ring-nav-deep/30")} aria-hidden />
                {aiInfo?.source === "error" ? "AI unavailable" : sending ? "AI thinking…" : "AI ready"}
              </span>
              {aiInfo && aiInfo.source !== "error" && (
                <span className="hidden lg:inline">
                  <AiSourceBadge source={aiInfo.source} />
                </span>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (voiceIsActive(voiceA.state) || voiceA.state.status === "connecting" ? voiceA.end() : void voiceA.start())}
                disabled={!tripId || !voiceA.availableEngine}
                title={voiceA.availableEngine === "realtime" ? "Talk to the planner (live AI voice)" : voiceA.availableEngine === "browser" ? "Talk to the planner (browser voice demo)" : "Voice isn't available in this browser — please type"}
                className={cn(voiceIsActive(voiceA.state) && "border-tomato/40 bg-danger-soft text-danger")}
                aria-label={voiceIsActive(voiceA.state) ? "End voice conversation" : "Start voice conversation"}
              >
                {voiceIsActive(voiceA.state) ? <Square className="h-3.5 w-3.5" aria-hidden /> : <Mic className="h-3.5 w-3.5" aria-hidden />}
                <span className="hidden md:inline">{voiceIsActive(voiceA.state) ? "End voice" : voiceA.availableEngine ? "Voice" : "Voice unavailable"}</span>
              </Button>
              <Button variant="secondary" size="sm" onClick={saveProgress} loading={savingTrip} disabled={!tripId} aria-label="Save progress to My Trips">
                <Save className="h-3.5 w-3.5" aria-hidden /> <span className="hidden md:inline">{tripStatus === "saved" || tripStatus === "handoff_requested" ? "Saved" : "Save progress"}</span>
              </Button>
              <Button variant="secondary" size="sm" className="xl:hidden" onClick={() => setProfileOpen(true)} aria-label="Open trip profile">
                <ListChecks className="h-3.5 w-3.5" aria-hidden /> <span className="tabular-nums">{pct}%</span>
              </Button>
            </div>
          </div>

          {/* Destination banner (hidden during a voice session so the conversation stays primary) */}
          {dest && voiceA.state.status === "idle" && (
            <div className="relative mx-4 mt-3 h-24 shrink-0 overflow-hidden rounded-2xl sm:h-28">
              <DestinationImage src={dest.image} alt={dest.name} className="absolute inset-0" eager />
              <div className="absolute inset-0 bg-gradient-to-r from-[#17152f]/85 via-[#17152f]/45 to-transparent" />
              <div className="relative flex h-full flex-col justify-end p-3.5 text-white">
                <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-lavender">
                  <span className="h-1.5 w-1.5 rounded-full bg-ai" aria-hidden /> Planning
                </p>
                <p className="text-lg font-semibold leading-tight">{dest.name}</p>
                <p className="hidden text-xs text-white/80 sm:block">
                  {dest.tagline} · best {dest.bestMonths.slice(0, 4).map((m) => MONTHS[m - 1]).join(", ")} · typical {dest.idealDays[0]}–{dest.idealDays[1]} days
                </p>
              </div>
            </div>
          )}

          <VoicePanel
            voice={voiceA}
            ready={!!tripId}
            highlight={params.get("voice") === "1"}
            onSwitchToText={() => {
              if (voiceIsActive(voiceA.state)) voiceA.end();
              inputRef.current?.focus();
            }}
          />

          {/* Conversation */}
          <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-transparent to-lavender-surface/40 px-4 py-4" aria-live="polite" aria-label="Conversation">
            {!profile && (
              <div className="space-y-3">
                <Skeleton className="h-16 w-3/4" />
                <Skeleton className="ml-auto h-10 w-1/2" />
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "justify-start")}>
                {m.role !== "user" ? (
                  <RobotAvatar size={32} className="mt-0.5" />
                ) : (
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lavender text-[11px] font-semibold text-nav-deep" aria-hidden>
                    {me.data?.user ? initialsOf(me.data.user.name) : "You"}
                  </span>
                )}
                <div className={cn("flex max-w-[82%] flex-col", m.role === "user" ? "items-end" : "items-start")}>
                <div
                  data-role={m.role}
                  className={cn(
                    "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user" ? "rounded-tr-md border border-lavender/60 bg-lavender-surface text-foreground" : "rounded-tl-md border border-border bg-surface text-foreground shadow-[0_1px_2px_rgba(60,42,100,0.05)]",
                    m.failed && "ring-2 ring-tomato/60",
                  )}
                >
                  <RichText text={m.content} />
                  {m.recommendations && m.recommendations.length > 0 && m.id === lastAssistant?.id && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      {m.recommendations.map((r, i) => (
                        <button key={r.id} onClick={() => send(r.name)} disabled={sending} className="overflow-hidden rounded-xl border border-border bg-surface text-left transition-colors hover:border-lavender">
                          <DestinationImage src={r.image} alt={r.name} seed={i} className="h-20" card />
                          <span className="block px-2 py-1.5 text-xs">
                            <span className="font-semibold text-foreground">{r.name}</span>
                            <span className="block text-muted">{r.reasons[0]}</span>
                            <span className="block text-muted">≈ {formatMoney(r.estimatedPerPerson)} pp (est.)</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {m.itineraryUpdate && m.itineraryUpdate.actions.some((a) => a.status === "completed") && tripId && (
                    <Link href={`/trips/${tripId}/itinerary`} className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-nav-deep/10 bg-ai/30 px-3 py-2 text-foreground hover:bg-ai/50">
                      <span className="text-xs">
                        <span className="block font-semibold text-nav-deep">Itinerary updated{m.itineraryUpdate.version ? ` · v${m.itineraryUpdate.version}` : ""}</span>
                        {m.itineraryUpdate.total ? <span className="text-muted">New estimate {formatMoney(m.itineraryUpdate.total)}</span> : null}
                      </span>
                      <span className="text-xs font-medium text-primary">View itinerary →</span>
                    </Link>
                  )}
                </div>
                <span className="mt-1 flex items-center gap-2 px-1 text-[11px] text-muted">
                  {m.role === "user" ? "You" : "Pickyourtrail AI"}
                  {m.createdAt && <time dateTime={m.createdAt}>· {new Date(m.createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</time>}
                  {m.pending && <span>· Sending…</span>}
                  {m.failed && (
                    <span className="flex items-center gap-1.5 font-medium text-danger">
                      · Not sent.
                      <button className="rounded-md border border-tomato/40 px-1.5 py-0.5 text-[11px] hover:bg-danger-soft" onClick={() => send(m.content, { clientId: m.clientId })}>
                        <RotateCcw className="mr-0.5 inline h-3 w-3" aria-hidden />
                        Retry
                      </button>
                    </span>
                  )}
                </span>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2.5">
                <RobotAvatar size={32} />
                <span className="rounded-2xl rounded-tl-md border border-border bg-surface px-3.5 py-3">
                  <TypingIndicator label="The planner is thinking" />
                </span>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-border/70 bg-surface px-4 py-3">
            {aiInfo?.notice && (
              <Alert tone={aiInfo.source === "error" ? "red" : "amber"} className="mb-2 py-2">
                {aiInfo.notice}
              </Alert>
            )}
            {generateError && (
              <Alert tone="red" className="mb-2 py-2">
                {generateError}{" "}
                <button className="underline" onClick={() => generate()}>
                  Try again
                </button>
              </Alert>
            )}
            {itineraryId && !sending && (
              <div className="mb-2 flex flex-wrap items-center gap-1.5" aria-label="Refine your itinerary">
                <span className="mr-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  <Wand2 className="h-3.5 w-3.5" aria-hidden /> Refine:
                </span>
                {["Make it slower", "More adventurous", "Show cheaper options", "More cultural experiences", "Save my trip"].map((r) => (
                  <button key={r} onClick={() => send(r)} className="rounded-full border border-lavender/70 bg-lavender-surface px-2.5 py-1 text-xs text-foreground hover:border-primary/50">
                    {r}
                  </button>
                ))}
              </div>
            )}
            {question && question.quickReplies.length > 0 && !sending && (
              <div className="mb-2 flex flex-wrap gap-1.5" aria-label="Suggested answers">
                {question.quickReplies.map((r) => {
                  const on = multi.includes(r);
                  if (question.key === "review" && /generate/i.test(r)) {
                    return (
                      <Button key={r} size="sm" variant="ai" onClick={() => generate()} loading={generating}>
                        <Wand2 className="h-3.5 w-3.5" aria-hidden /> {r}
                      </Button>
                    );
                  }
                  return (
                    <button
                      key={r}
                      aria-pressed={question.multiSelect ? on : undefined}
                      onClick={() => (question.multiSelect ? setMulti((x) => (on ? x.filter((y) => y !== r) : [...x, r])) : send(r))}
                      className={cn("rounded-full border px-3 py-1.5 text-[13px] transition-colors", on ? "border-nav-deep bg-ai font-medium text-nav-deep" : "border-lavender/70 bg-surface hover:bg-lavender-surface")}
                    >
                      {r}
                    </button>
                  );
                })}
                {question.multiSelect && multi.length > 0 && (
                  <Button size="sm" variant="ai" onClick={() => send(multi.join(", "))}>
                    Send {multi.length} selected
                  </Button>
                )}
                {question.optional && (
                  <button onClick={() => send("skip")} className="rounded-full px-3 py-1 text-[13px] text-muted hover:text-foreground">
                    Skip
                  </button>
                )}
              </div>
            )}
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const t = input;
                setInput("");
                void send(t);
              }}
            >
              <label htmlFor="planner-input" className="sr-only">
                Your message
              </label>
              <textarea
                ref={inputRef}
                id="planner-input"
                rows={1}
                value={input}
                maxLength={1500}
                disabled={!tripId}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={question?.key === "destination" ? "e.g. A 5-day family trip to Bali in December" : itineraryId ? "Ask for changes — “cheaper hotel”, “replace the water park”…" : "Type your answer…"}
                className="max-h-32 min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/40"
              />
              {canDictate && (
                <Button type="button" variant="secondary" className="h-11 w-11 px-0" onClick={toggleDictation} aria-label={dictating ? "Stop dictation" : "Dictate with microphone"} title="Dictate (browser speech recognition)">
                  {dictating ? <MicOff className="h-4 w-4 text-danger" /> : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button type="submit" variant="ai" className="h-11" disabled={!input.trim() || !tripId} aria-label="Send message">
                <Send className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
            {voiceMessage && (
              <p className="mt-2 text-xs text-muted" role="status">
                {voiceMessage}
              </p>
            )}
          </div>
        </Card>

        {/* Persistent trip profile (desktop) */}
        <aside className="hidden xl:block" aria-label="Trip profile">
          <div className="sticky top-[4.75rem] max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-2xl">{profilePanel}</div>
        </aside>
      </div>

      {/* Trip profile drawer (tablet / mobile) */}
      {profileOpen && (
        <div className="fixed inset-0 z-50 xl:hidden" role="dialog" aria-modal="true" aria-label="Trip profile">
          <div className="absolute inset-0 bg-nav-deep/40" onClick={() => setProfileOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-full max-w-sm overflow-y-auto bg-background p-3 shadow-2xl">
            <div className="mb-2 flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => setProfileOpen(false)}>
                Close
              </Button>
            </div>
            {profilePanel}
          </div>
        </div>
      )}

      {profile && <FieldEditor key={editing ?? "none"} field={editing} profile={profile} onClose={() => setEditing(null)} onSave={saveField} />}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const PROFILE_GROUPS: { title: string; fields: FieldKey[] }[] = [
  { title: "Trip", fields: ["destination", "dates", "duration"] },
  { title: "Travellers & budget", fields: ["travellers", "childrenAges", "budget", "budgetIncludesFlights"] },
  { title: "Style", fields: ["tripType", "interests", "pace", "accommodation"] },
  { title: "Getting there & needs", fields: ["departureCity", "transport", "requirements", "mustSee"] },
];

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  itinerary_ready: "Itinerary ready",
  saved: "Saved",
  handoff_requested: "Quote requested",
  cancelled: "Cancelled",
};

function TripProfilePanel({
  profile,
  status,
  provenance,
  pct,
  question,
  ready,
  stage,
  itineraryId,
  tripId,
  tripStatus,
  savedAt,
  generating,
  onEdit,
  onGenerate,
}: {
  profile: TripProfile | null;
  status: FieldStatus;
  provenance: Provenance;
  pct: number;
  question: Question | null;
  ready: boolean;
  stage: string;
  itineraryId: string | null;
  tripId: string | null;
  tripStatus: string | null;
  savedAt: string | null;
  generating: boolean;
  onEdit: (f: FieldKey) => void;
  onGenerate: () => void;
}) {
  const missing = profile ? FIELD_KEYS.filter((f) => isRelevant(f, profile) && !isResolved(f, profile, status)) : [];
  return (
    <div className="space-y-3">
      <GlassPanel className="overflow-hidden">
        <div className="border-b border-border/70 bg-gradient-to-br from-lavender-surface to-surface px-4 pb-3 pt-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[15px] font-semibold">Trip profile</h2>
            {tripStatus && <Badge tone="violet">{STATUS_LABEL[tripStatus] ?? tripStatus}</Badge>}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="h-2 flex-1 rounded-full bg-surface" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Preferences collected">
              <div className="h-2 rounded-full bg-ai ring-1 ring-nav-deep/10 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-semibold tabular-nums">{pct}%</span>
          </div>
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
            <CloudCheck className="h-3.5 w-3.5 text-success" aria-hidden />
            {savedAt ? `Saved ${new Date(savedAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Saved automatically"} · synced with the chat
          </p>
        </div>
        <div className="p-4 pt-3">
          {profile &&
            (missing.length ? (
              <div className="rounded-xl border border-warning/25 bg-warning-soft/70 px-3 py-2 text-xs">
                <p className="font-semibold text-warning">Still needed ({missing.length})</p>
                <p className="mt-0.5 text-slate-700">{missing.map((f) => `${FIELD_LABELS[f]}${ESSENTIAL_FIELDS.includes(f) ? "*" : ""}`).join(", ")}</p>
              </div>
            ) : (
              <p className="rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success">All details collected</p>
            ))}
          {!profile ? (
            <div className="mt-4 space-y-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="mt-2 space-y-3">
              {PROFILE_GROUPS.map((g) => {
                const fields = g.fields.filter((f) => isRelevant(f, profile));
                if (!fields.length) return null;
                return (
                  <section key={g.title}>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{g.title}</h3>
                    <ul className="mt-1 divide-y divide-border/60">
                      {fields.map((f) => {
                        const value = describeField(f, profile, status);
                        const done = isResolved(f, profile, status);
                        const current = question?.key === f;
                        return (
                          <li key={f} className={cn("group flex items-start gap-2 py-1.5 text-[13px]", current && "-mx-2 rounded-lg bg-lavender-surface px-2")}>
                            {done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="Answered" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-lavender" aria-label="Not answered" />}
                            <div className="min-w-0 flex-1">
                              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                                <span>
                                  {FIELD_LABELS[f]}
                                  {ESSENTIAL_FIELDS.includes(f) && <span className="text-tomato"> *</span>}
                                </span>
                                {value && <ProvenanceTag value={provenance[f]} />}
                              </p>
                              <p className={cn("truncate", value ? "text-foreground" : "text-slate-400")}>{value ?? (current ? "Asking now…" : "—")}</p>
                            </div>
                            <button onClick={() => onEdit(f)} className="rounded-md p-1 text-muted opacity-70 hover:bg-surface hover:text-primary group-hover:opacity-100" aria-label={`Edit ${FIELD_LABELS[f]}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          <Button variant="secondary" size="sm" className="mt-3 w-full" disabled={!profile} onClick={() => onEdit(missing[0] ?? "destination")}>
            <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit preferences
          </Button>
          <p className="mt-2 text-[11px] text-muted">
            <span className="text-tomato">*</span> needed for an itinerary. You can say &ldquo;I don&apos;t know yet&rdquo; to any question.
          </p>
        </div>
      </GlassPanel>
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold">Itinerary</h2>
        {itineraryId ? (
          <div className="mt-3 space-y-2">
            <Link href={`/trips/${tripId}/itinerary`} className="flex h-9 items-center justify-center rounded-xl bg-nav-deep text-sm font-medium text-white hover:bg-[#2b2752]">
              View itinerary
            </Link>
            <Button variant="secondary" className="w-full" onClick={onGenerate} loading={generating} disabled={!ready}>
              Update with latest answers
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-1 text-[13px] text-muted">
              {ready ? (stage === "review" ? "Everything's ready." : "You can generate now, or answer a few more questions for a better plan.") : "Answer the starred questions to unlock your itinerary."}
            </p>
            <Button variant="ai" className="mt-3 w-full" onClick={onGenerate} loading={generating} disabled={!ready}>
              <Wand2 className="h-4 w-4" aria-hidden /> Generate itinerary
            </Button>
          </>
        )}
        {stage === "review" && (
          <Badge tone="green" className="mt-3">
            Summary confirmed in chat
          </Badge>
        )}
      </Card>
    </div>
  );
}

/** Shows where a value came from; inferred/default values are confirmed in the summary step. */
function ProvenanceTag({ value }: { value: Provenance[FieldKey] }) {
  if (value === "inferred")
    return (
      <span className="rounded-full bg-warning-soft px-1.5 py-px text-[10px] font-medium text-warning" title="Worked out from your other answers — confirm or edit it">
        Assumed
      </span>
    );
  if (value === "default")
    return (
      <span className="rounded-full bg-surface-muted px-1.5 py-px text-[10px] font-medium text-muted" title="A default the planner used — confirm or edit it">
        Default
      </span>
    );
  if (value === "confirmed")
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-success" title="You confirmed this">
        <CheckCircle2 className="h-3 w-3" aria-hidden /> Confirmed
      </span>
    );
  return null; // stated by the customer
}

function initialsOf(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function noopSubscribe() {
  return () => {};
}
