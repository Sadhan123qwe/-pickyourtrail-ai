import { describe, expect, it, vi } from "vitest";
import { initialVoiceState, isActive, voiceReducer, type VoiceEvent, type VoiceState } from "@/lib/voice/machine";
import { VoiceStartError, createBrowserEngine, createRealtimeEngine, pickVoice, type DataChannelLike, type PeerConnectionLike, type RecognitionLike, type UtteranceLike } from "@/lib/voice/engines";

const run = (events: VoiceEvent[], from: VoiceState = initialVoiceState) => events.reduce(voiceReducer, from);

describe("voice state machine", () => {
  it("moves through a full spoken turn only on real events", () => {
    let s = run([{ type: "START", engine: "realtime" }]);
    expect(s.status).toBe("connecting");
    s = run([{ type: "CONNECTED" }], s);
    expect(s.status).toBe("listening");
    s = run([{ type: "SPEAK_START" }], s); // greeting audio actually started
    expect(s.status).toBe("speaking");
    s = run([{ type: "SPEAK_END" }, { type: "USER_SPEECH_START" }], s);
    expect(s).toMatchObject({ status: "listening", userSpeaking: true });
    s = run([{ type: "USER_SPEECH_END" }, { type: "TRANSCRIPT", text: "Bali in December" }], s);
    expect(s).toMatchObject({ status: "thinking", turns: 1 });
    s = run([{ type: "SPEAK_START" }, { type: "SPEAK_END" }], s);
    expect(s.status).toBe("listening");
  });

  it("does not claim to listen or speak without a session", () => {
    expect(run([{ type: "SPEAK_START" }]).status).toBe("idle");
    expect(run([{ type: "USER_SPEECH_START" }]).status).toBe("idle");
    expect(run([{ type: "TRANSCRIPT", text: "hi" }]).status).toBe("idle");
    expect(run([{ type: "START", engine: "browser" }, { type: "TRANSCRIPT", text: "hi" }]).status).toBe("connecting");
  });

  it("supports mute (pause), resume, interrupt and barge-in", () => {
    let s = run([{ type: "START", engine: "realtime" }, { type: "CONNECTED" }, { type: "MUTE" }]);
    expect(s).toMatchObject({ status: "muted", muted: true });
    expect(run([{ type: "USER_SPEECH_START" }], s).userSpeaking).toBe(false); // muted mic hears nothing
    s = run([{ type: "UNMUTE" }, { type: "SPEAK_START" }, { type: "INTERRUPT" }], s);
    expect(s.status).toBe("listening");
    s = run([{ type: "SPEAK_START" }, { type: "USER_SPEECH_START" }], s);
    expect(s.status).toBe("listening"); // customer talked over the assistant
  });

  it("handles failures, disconnects, reconnects and ending", () => {
    const failed = run([{ type: "START", engine: "browser" }, { type: "ERROR", message: "Microphone permission was denied." }]);
    expect(failed).toMatchObject({ status: "error", error: "Microphone permission was denied." });
    expect(isActive(failed)).toBe(false);
    let s = run([{ type: "START", engine: "realtime" }, { type: "CONNECTED" }, { type: "TRANSCRIPT", text: "x" }, { type: "DISCONNECTED" }]);
    expect(s.status).toBe("disconnected");
    s = run([{ type: "START", engine: "realtime" }], s);
    expect(s).toMatchObject({ status: "connecting", turns: 1 }); // reconnect keeps the session's turn count
    s = run([{ type: "CONNECTED" }, { type: "TRANSCRIPT", text: "y" }, { type: "REPLY_FAILED", message: "Server error" }], s);
    expect(s).toMatchObject({ status: "listening", error: "Server error" });
    expect(run([{ type: "END" }], s).status).toBe("ended");
  });
});

/* ---------------- Realtime (WebRTC) engine with fakes ---------------- */

function fakeTrack() {
  return { enabled: true, stop: vi.fn() } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
}
function fakeStream(track = fakeTrack()) {
  return { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
}
function fakePc() {
  const dc: DataChannelLike & { sent: string[] } = {
    readyState: "open",
    sent: [],
    send(d: string) {
      this.sent.push(d);
    },
    close: vi.fn(),
    onopen: null,
    onmessage: null,
  };
  const pc: PeerConnectionLike & { dc: typeof dc } = {
    dc,
    connectionState: "new",
    ontrack: null,
    onconnectionstatechange: null,
    addTrack: vi.fn(),
    createDataChannel: () => dc,
    createOffer: async () => ({ type: "offer", sdp: "v=0 offer" }),
    setLocalDescription: async () => {},
    setRemoteDescription: async () => {},
    close: vi.fn(),
  };
  return pc;
}

describe("realtime voice engine", () => {
  it("connects with a short-lived secret and maps official Realtime events", async () => {
    const pc = fakePc();
    const track = fakeTrack();
    const events: VoiceEvent[] = [];
    const fetchMock = vi.fn(async () => new Response("v=0 answer", { status: 201 }));
    const engine = createRealtimeEngine(
      {
        requestSession: async () => ({ clientSecret: "ek_test_ephemeral" }),
        getUserMedia: async () => fakeStream(track),
        createPeerConnection: () => pc,
        fetch: fetchMock as unknown as typeof fetch,
        createAudio: () => ({ srcObject: null, autoplay: false, pause: vi.fn() }),
      },
      { onEvent: (e) => events.push(e) },
    );
    await engine.start();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ek_test_ephemeral");
    pc.dc.onopen!();
    const emit = (type: string, extra: object = {}) => pc.dc.onmessage!({ data: JSON.stringify({ type, ...extra }) });
    emit("input_audio_buffer.speech_started");
    emit("input_audio_buffer.speech_stopped");
    emit("conversation.item.input_audio_transcription.completed", { item_id: "i1", transcript: "  Bali for five days " });
    emit("conversation.item.input_audio_transcription.completed", { item_id: "i1", transcript: "Bali for five days" }); // duplicate ignored
    emit("output_audio_buffer.started");
    emit("output_audio_buffer.stopped");
    expect(events.map((e) => e.type)).toEqual(["CONNECTED", "USER_SPEECH_START", "USER_SPEECH_END", "TRANSCRIPT", "SPEAK_START", "SPEAK_END"]);
    expect(events[3]).toEqual({ type: "TRANSCRIPT", text: "Bali for five days" });

    engine.speak("Great choice!");
    engine.interrupt();
    const sent = pc.dc.sent.map((d) => JSON.parse(d));
    expect(sent[0]).toMatchObject({ type: "response.create", response: { conversation: "none", output_modalities: ["audio"] } });
    expect(sent.slice(1).map((e) => e.type)).toEqual(["response.cancel", "output_audio_buffer.clear"]);

    engine.setMuted(true);
    expect(track.enabled).toBe(false);
    engine.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(pc.close).toHaveBeenCalled();
  });

  it("reports microphone denial, unavailable sessions and failed connections honestly", async () => {
    const base = {
      createPeerConnection: () => fakePc(),
      createAudio: () => ({ srcObject: null, autoplay: false, pause: vi.fn() }),
      fetch: (async () => new Response("", { status: 201 })) as unknown as typeof fetch,
    };
    const denied = createRealtimeEngine({ ...base, requestSession: async () => ({ clientSecret: "x" }), getUserMedia: async () => Promise.reject(new Error("NotAllowedError")) }, { onEvent: () => {} });
    await expect(denied.start()).rejects.toMatchObject({ code: "permission_denied" });

    const unavailable = createRealtimeEngine({ ...base, requestSession: async () => Promise.reject(new Error("Voice demo unavailable")), getUserMedia: async () => fakeStream() }, { onEvent: () => {} });
    await expect(unavailable.start()).rejects.toBeInstanceOf(VoiceStartError);

    const track = fakeTrack();
    const failing = createRealtimeEngine(
      { ...base, requestSession: async () => ({ clientSecret: "x" }), getUserMedia: async () => fakeStream(track), fetch: (async () => new Response("", { status: 500 })) as unknown as typeof fetch },
      { onEvent: () => {} },
    );
    await expect(failing.start()).rejects.toMatchObject({ code: "connection_failed" });
    expect(track.stop).toHaveBeenCalled(); // microphone released on failure
  });

  it("emits DISCONNECTED when the peer connection drops", async () => {
    const pc = fakePc();
    const events: VoiceEvent[] = [];
    const engine = createRealtimeEngine(
      {
        requestSession: async () => ({ clientSecret: "x" }),
        getUserMedia: async () => fakeStream(),
        createPeerConnection: () => pc,
        fetch: (async () => new Response("answer", { status: 201 })) as unknown as typeof fetch,
        createAudio: () => ({ srcObject: null, autoplay: false, pause: vi.fn() }),
      },
      { onEvent: (e) => events.push(e) },
    );
    await engine.start();
    pc.connectionState = "failed";
    pc.onconnectionstatechange!();
    expect(events.at(-1)?.type).toBe("DISCONNECTED");
  });
});

/* ---------------- Browser (Web Speech) engine with fakes ---------------- */

function fakeSpeech() {
  const recs: (RecognitionLike & { started: number })[] = [];
  const utterances: UtteranceLike[] = [];
  const createRecognition = () => {
    const r: RecognitionLike & { started: number } = {
      lang: "",
      continuous: false,
      interimResults: true,
      started: 0,
      start() {
        this.started++;
        this.onstart?.();
      },
      stop() {},
      abort() {},
      onstart: null,
      onresult: null,
      onerror: null,
      onend: null,
      onspeechstart: null,
      onspeechend: null,
    };
    recs.push(r);
    return r;
  };
  const synth = {
    speak: (u: UtteranceLike) => {
      utterances.push(u);
      u.onstart?.();
    },
    cancel: vi.fn(),
    getVoices: () => [
      { name: "Robot Basic", lang: "de-DE" },
      { name: "Google UK English Female", lang: "en-GB" },
    ],
  };
  const createUtterance = (text: string): UtteranceLike => ({ text, lang: "", rate: 0, pitch: 0, voice: null, onstart: null, onend: null, onerror: null, onboundary: null });
  return { recs, utterances, deps: { createRecognition, synth, createUtterance } };
}

describe("browser voice engine (demo fallback)", () => {
  it("listens, transcribes final results, speaks replies and pauses recognition while speaking", async () => {
    const f = fakeSpeech();
    const events: VoiceEvent[] = [];
    const engine = createBrowserEngine(f.deps, { onEvent: (e) => events.push(e) });
    await engine.start();
    const rec = f.recs[0];
    expect(rec.continuous).toBe(true);
    expect(events[0]).toEqual({ type: "CONNECTED" });
    rec.onspeechstart!();
    rec.onresult!({ resultIndex: 0, results: [Object.assign([{ transcript: "five days in Bali" }], { isFinal: true })] });
    expect(events).toContainEqual({ type: "TRANSCRIPT", text: "five days in Bali" });
    engine.speak("Got it — Bali for five days.");
    expect(f.utterances[0]).toMatchObject({ text: "Got it — Bali for five days.", lang: "en-IN" });
    expect((f.utterances[0].voice as { lang: string }).lang).toBe("en-GB"); // a clear English voice
    expect(events.at(-1)).toEqual({ type: "SPEAK_START" });
    f.utterances[0].onend!();
    expect(events.at(-1)).toEqual({ type: "SPEAK_END" });
  });

  it("reports unsupported browsers and microphone denial", async () => {
    await expect(createBrowserEngine({ createRecognition: null, synth: null, createUtterance: null }, { onEvent: () => {} }).start()).rejects.toMatchObject({ code: "unsupported" });
    const f = fakeSpeech();
    const denied = createBrowserEngine({ ...f.deps, getUserMedia: async () => Promise.reject(new Error("denied")) }, { onEvent: () => {} });
    await expect(denied.start()).rejects.toMatchObject({ code: "permission_denied" });
    const events: VoiceEvent[] = [];
    const engine = createBrowserEngine(f.deps, { onEvent: (e) => events.push(e) });
    await engine.start();
    f.recs.at(-1)!.onerror!({ error: "not-allowed" });
    expect(events.at(-1)).toMatchObject({ type: "ERROR" });
  });

  it("prefers a natural English voice", () => {
    expect(pickVoice([{ name: "x", lang: "fr-FR" }, { name: "Microsoft Aria Online (Natural)", lang: "en-US" }])?.name).toContain("Aria");
    expect(pickVoice([])).toBeNull();
  });
});

describe("microphone errors are reported by their real cause", () => {
  const dom = (name: string, message = "") => new DOMException(message, name);
  it("distinguishes a site block, an OS block, a missing device and a busy device", async () => {
    const { microphoneError, requestMicrophone } = await import("@/lib/voice/engines");
    expect(microphoneError(dom("NotAllowedError", "Permission denied"))).toMatchObject({ code: "permission_denied", message: expect.stringMatching(/Site settings → Microphone → Allow/) });
    expect(microphoneError(dom("NotAllowedError", "Permission denied by system"))).toMatchObject({ code: "blocked_by_os", message: expect.stringMatching(/Let desktop apps access your microphone/) });
    expect(microphoneError(dom("NotFoundError", "Requested device not found")).code).toBe("no_microphone");
    expect(microphoneError(dom("NotReadableError", "Could not start audio source")).code).toBe("mic_in_use");
    expect(microphoneError(new TypeError("navigator.mediaDevices is undefined")).code).toBe("insecure_context");

    // Constraints the device can't meet fall back to plain audio.
    const calls: MediaStreamConstraints[] = [];
    const stream = {} as MediaStream;
    const got = await requestMicrophone(async (c) => {
      calls.push(c);
      if (calls.length === 1) throw dom("OverconstrainedError");
      return stream;
    });
    expect(got).toBe(stream);
    expect(calls[1]).toEqual({ audio: true });
  });

  it("asks for the microphone before requesting a voice session", async () => {
    const order: string[] = [];
    const engine = createRealtimeEngine(
      {
        requestSession: async () => (order.push("session"), { clientSecret: "x" }),
        getUserMedia: async () => (order.push("microphone"), Promise.reject(dom("NotAllowedError", "Permission denied"))),
        createPeerConnection: () => fakePc(),
        fetch: (async () => new Response("", { status: 201 })) as unknown as typeof fetch,
        createAudio: () => ({ srcObject: null, autoplay: false, pause: vi.fn() }),
      },
      { onEvent: () => {} },
    );
    await expect(engine.start()).rejects.toMatchObject({ code: "permission_denied" });
    expect(order).toEqual(["microphone"]); // no paid session is created when the mic is blocked
  });
});

describe("microphone device fallback", () => {
  const dom = (name: string, message = "") => new DOMException(message, name);
  it("retries plain audio, then each other input device, and reports the browser's own error", async () => {
    const { requestMicrophone } = await import("@/lib/voice/engines");
    const tried: MediaStreamConstraints[] = [];
    const ok = {} as MediaStream;
    const stream = await requestMicrophone(
      async (c) => {
        tried.push(c);
        const id = ((c.audio as MediaTrackConstraints | boolean) as { deviceId?: { exact: string } })?.deviceId?.exact;
        if (id === "usb-headset") return ok;
        throw dom("NotReadableError", "Could not start audio source");
      },
      async () => [
        { kind: "audioinput", deviceId: "default", label: "Default" },
        { kind: "audioinput", deviceId: "builtin", label: "Laptop mic" },
        { kind: "audioinput", deviceId: "usb-headset", label: "Headset" },
        { kind: "videoinput", deviceId: "cam", label: "Camera" },
      ],
    );
    expect(stream).toBe(ok);
    expect(tried).toHaveLength(4); // processed default, plain default, builtin, headset
    // Permission problems are never retried on other devices.
    const calls: number[] = [];
    await expect(requestMicrophone(async () => (calls.push(1), Promise.reject(dom("NotAllowedError", "Permission denied"))), async () => [{ kind: "audioinput", deviceId: "x", label: "" }])).rejects.toMatchObject({ code: "permission_denied" });
    expect(calls).toHaveLength(1);
    // When nothing works, the message includes the browser's exact error.
    await expect(requestMicrophone(async () => Promise.reject(dom("NotReadableError", "Could not start audio source")))).rejects.toMatchObject({
      code: "mic_in_use",
      message: expect.stringContaining("Browser reported: NotReadableError — Could not start audio source"),
    });
  });
});

describe("robot voice without a microphone", () => {
  it("never opens the microphone and receives the assistant's audio only", async () => {
    const pc = fakePc();
    const transceivers: unknown[] = [];
    (pc as unknown as { addTransceiver: (k: string, i: unknown) => void }).addTransceiver = (k, i) => transceivers.push([k, i]);
    const getUserMedia = vi.fn();
    const events: VoiceEvent[] = [];
    const engine = createRealtimeEngine(
      {
        requestSession: async () => ({ clientSecret: "ek_test" }),
        getUserMedia,
        createPeerConnection: () => pc,
        fetch: (async () => new Response("answer", { status: 201 })) as unknown as typeof fetch,
        createAudio: () => ({ srcObject: null, autoplay: false, pause: vi.fn() }),
      },
      { onEvent: (e) => events.push(e) },
      { micless: true },
    );
    await engine.start();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(pc.addTrack).not.toHaveBeenCalled();
    expect(transceivers).toEqual([["audio", { direction: "recvonly" }]]);
    pc.dc.onopen!();
    engine.speak("Hello!");
    expect(JSON.parse(pc.dc.sent[0])).toMatchObject({ type: "response.create" });
    engine.stop();
  });
});
