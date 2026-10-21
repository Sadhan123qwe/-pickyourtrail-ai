import { expect, test, type Page } from "@playwright/test";

/**
 * Robot voice planning in a real browser. The server runs in mock-AI mode, so the
 * planner uses the browser-voice engine. Playwright can't speak into a microphone,
 * so the Web Speech API (recognition + synthesis) and getUserMedia are replaced
 * with controllable fakes; everything else — the robot UI and state machine, the
 * planner API, persistence and the Trip Profile — is the real application.
 */
const FAKE_SPEECH = ({ denyMic }: { denyMic: boolean }) => {
  type Fn = (() => void) | null;
  const voice: {
    utterances: string[];
    current: { text: string; onstart: Fn; onend: Fn } | null;
    rec: { onstart: Fn; onend: Fn; onspeechstart: Fn; onresult: ((e: unknown) => void) | null } | null;
    say: (t: string) => void;
    finishSpeaking: () => void;
  } = {
    utterances: [],
    current: null,
    rec: null,
    say(text) {
      const r = voice.rec!;
      r.onspeechstart?.();
      r.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] });
    },
    finishSpeaking() {
      const u = voice.current;
      voice.current = null;
      u?.onend?.();
    },
  };
  (window as unknown as { __voice: typeof voice }).__voice = voice;
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onstart: Fn = null;
    onend: Fn = null;
    onspeechstart: Fn = null;
    onspeechend: Fn = null;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor() {
      voice.rec = this;
    }
    start() {
      setTimeout(() => this.onstart?.(), 10);
    }
    stop() {
      setTimeout(() => this.onend?.(), 5);
    }
    abort() {}
  }
  const w = window as unknown as Record<string, unknown>;
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
  w.SpeechSynthesisUtterance = class {
    text: string;
    onstart: Fn = null;
    onend: Fn = null;
    onerror: Fn = null;
    onboundary: Fn = null;
    constructor(t: string) {
      this.text = t;
    }
  };
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak(u: { text: string; onstart: Fn; onend: Fn }) {
        voice.utterances.push(u.text);
        voice.current = u;
        setTimeout(() => u.onstart?.(), 10);
      },
      cancel() {
        voice.finishSpeaking();
      },
      getVoices: () => [{ name: "Test English", lang: "en-IN" }],
    },
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (denyMic) throw new DOMException("Permission denied", "NotAllowedError");
        return new AudioContext().createMediaStreamDestination().stream;
      },
    },
  });
};

const robot = (page: Page) => page.locator("[data-voice-status]");
const utterances = (page: Page) => page.evaluate(() => (window as unknown as { __voice: { utterances: string[] } }).__voice.utterances);

test.describe("robot voice planning", () => {
  test("greets aloud, plans by voice, syncs the Trip Profile and survives reload", async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH, { denyMic: false });
    await page.goto("/plan?new=1&voice=1");
    await page.getByRole("button", { name: "Talk to Pickyourtrail AI" }).click();

    // 1–2. The robot connects and speaks the greeting (real synthesis events drive the state).
    await expect(robot(page)).toHaveAttribute("data-voice-status", "speaking");
    expect((await utterances(page))[0]).toMatch(/Welcome to Pickyourtrail\. I'm your AI travel planner/);
    await page.evaluate(() => (window as unknown as { __voice: { finishSpeaking: () => void } }).__voice.finishSpeaking());
    await expect(robot(page)).toHaveAttribute("data-voice-status", "listening");

    // 3–5. The customer speaks; the planner captures everything and asks only what's missing.
    await page.evaluate(() =>
      (window as unknown as { __voice: { say: (t: string) => void } }).__voice.say(
        "I want a five-day family trip to Bali in December for two adults and two children. Our total budget is 1.5 lakh.",
      ),
    );
    await expect.poll(async () => (await utterances(page)).length).toBe(2);
    const reply = (await utterances(page))[1];
    expect(reply).toMatch(/Got it — Bali · 5 days/);
    expect(reply).not.toMatch(/Where would you like to go|How many days/);
    const profile = page.getByLabel("Trip profile");
    await expect(profile.getByText("Bali", { exact: true })).toBeVisible();
    await expect(profile.getByText("₹1,50,000 total", { exact: true })).toBeVisible();
    // The voice transcript is in the same conversation as typed messages.
    await expect(page.locator("[data-role=user]").filter({ hasText: "five-day family trip to Bali" })).toBeVisible();

    // Pause/resume and end are real controls.
    await page.evaluate(() => (window as unknown as { __voice: { finishSpeaking: () => void } }).__voice.finishSpeaking());
    await expect(robot(page)).toHaveAttribute("data-voice-status", "listening");
    await page.getByRole("button", { name: "Pause (mute microphone)" }).click();
    await expect(robot(page)).toHaveAttribute("data-voice-status", "muted");
    await page.getByRole("button", { name: "Resume (unmute microphone)" }).click();
    await expect(robot(page)).toHaveAttribute("data-voice-status", "listening");
    await page.getByRole("button", { name: "End voice session" }).click();
    await expect(robot(page)).toHaveAttribute("data-voice-status", "ended");

    // 8. Everything persisted: after a reload the Trip Profile is restored from the database.
    await page.reload();
    await expect(page.getByLabel("Trip profile").getByText("Bali", { exact: true })).toBeVisible();
    await expect(page.locator("[data-role=user]").filter({ hasText: "five-day family trip to Bali" })).toBeVisible();
  });

  test("falls back to text when the microphone is denied", async ({ page }) => {
    await page.addInitScript(FAKE_SPEECH, { denyMic: true });
    await page.goto("/plan?new=1");
    await page.getByRole("button", { name: "Talk to Pickyourtrail AI" }).click();
    await expect(robot(page)).toHaveAttribute("data-voice-status", "error");
    await expect(page.getByText(/Microphone access is blocked for this site\. Click the icon at the left of the address bar/).first()).toBeVisible();
    await page.getByRole("button", { name: "Switch to text" }).click();
    await expect(page.locator("#planner-input")).toBeFocused();
    await page.fill("#planner-input", "A 4 day trip to Dubai");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Got it — Dubai · 4 days/).first()).toBeVisible();
  });
});
