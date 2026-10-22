# Demo video

There are two automated videos and one optional manual recording:

1. **Chat + CRM walkthrough:** `npm run demo:video`.
2. **Voice planning reenactment with two voices** (customer + AI robot): `npm run demo:voice-video`.
3. **Optional, by hand:** a recording of *live* OpenAI Realtime voice. It needs a working microphone and a live key (section 3).

Both scripts write MP4 when they can find a full ffmpeg. Without one, the walkthrough is saved as WebM; the voice video is saved as a silent WebM plus a WAV soundtrack. To get ffmpeg without installing anything system-wide:

```bash
pip install imageio-ffmpeg
python -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"   # use this path as FFMPEG_PATH
FFMPEG_PATH="<path printed above>" npm run demo:voice-video
```

## 1. Automated walkthrough

```bash
npm run build
npm run demo:video          # → demo-video/pickyourtrail-ai-demo.mp4 (or .webm), ~2 min 20 s, 1440×900
```

How the recording runs:

- It uses the production build on port 3200 with a **fresh, throwaway database**, so your real `data/` database is never touched.
- It runs in **demo mode** (`AI_MODE=mock`, no API key). The script refuses to record if the server reports anything other than demo mode, so no tokens are spent.
- On-screen captions describe each step, and a highlighted cursor shows every click.

The output is a WebM file. It plays in Chrome, Edge, VLC and the Windows Media Player app. To get an MP4, import it into Clipchamp (built into Windows 11) and export it.

| ~Time | Chapter | What's shown |
|---|---|---|
| 0:00 | Title | Pickyourtrail AI |
| 0:05 | Customer · Home | Hero search, seasonal destinations, quick-start ideas |
| 0:20 | AI Trip Planner · Chat | Free-text request → Trip Profile fills in. The planner asks only for missing details. Each field shows its source (stated / assumed / default / confirmed). |
| 0:50 | Itinerary | Day-by-day plan with estimates; an activity is swapped and the totals recalculate; the trip is saved |
| 1:10 | Review & Quote | Booking request handed to experts; "Nothing has been booked or charged yet" |
| 1:20 | Customer · Support | Support ticket created |
| 1:28 | Employee platform | Sales login → Business Overview KPIs |
| 1:33 | Sales CRM | The chat became a lead: budget, dates, travellers, itinerary, suggested next action |
| 1:40 | AI Command Center | Grounded summary; follow-up drafted → human approval → scheduled (not sent) |
| 1:55 | Employee AI Copilot | Answer with visible sources |
| 2:02 | Support Ops | Ticket with SLA timer, assigned to an agent, AI case summary |
| 2:10 | Analytics | Trends vs previous period, metric definitions |

The captions say the app is in demo mode wherever it matters, so viewers aren't told that live AI is answering.

## 2. Voice planning reenactment (automated, two voices)

```bash
npm run build
npm run demo:voice-video    # → demo-video/pickyourtrail-ai-voice-demo.mp4, ~3½ min, Windows only
```

A customer (Windows voice **George**) plans a Bali family trip by voice with the robot (Windows voice **Zira**). It ends with a spoken itinerary summary, the call ending, and the saved itinerary. To use other installed voices, set `DEMO_CUSTOMER_VOICE` / `DEMO_AI_VOICE`.

The video is honest about what it is. The title card and a badge on every frame say **"Reenactment · demo mode · synthesized voices"**, and the voice panel shows "Browser voice (demo)".

| Real | Simulated |
|---|---|
| The app, its voice panel and status changes (listening → thinking → speaking), the planner API, the Trip Profile filling in, the saved itinerary | The speech in and out. The customer's lines are synthesized and fed into a fake microphone, so the robot's rings react to them. The robot's replies are the app's actual reply text, read by a synthesized voice. |
| Every word the robot says | The customer's script (in `scripts/demo-voice-video.mjs`; the script answers whatever the planner asks next) |

It makes no OpenAI calls. Live OpenAI Realtime voice sounds different and supports barge-in by voice. To show that, record section 3.

## 3. Live voice segment (optional; record on a laptop with a working microphone)

### Before you record

1. Create a **new** OpenAI API key. Don't reuse the one that was shared in chat; revoke that one.
2. Put the new key in `.env.local` as `OPENAI_API_KEY=...`. Never paste it into a chat, a document or the video.
3. In the OpenAI dashboard, check **Settings → Limits** and **Billing**. Realtime calls returned HTTP 429 on the old account, so make sure Realtime usage is allowed and funded.
4. Run `npm run ai:check`. Every line should say PASS, including "Realtime voice session".
5. Start the app with `npm run dev` and open `http://localhost:3000/plan?new=1&voice=1` in Chrome or Edge.
6. Test the microphone at Chrome → Settings → Privacy → Site settings → Microphone. Use a headset to avoid echo.
7. Hide anything private: bookmarks bar, other tabs, notifications (Windows Focus / Do Not Disturb).

### Recording

Use **Win + Alt + R** (Xbox Game Bar), Clipchamp's screen recorder, or OBS. Record the browser window **with system audio and microphone**, so viewers hear both you and the robot.

### Shot list and lines to say

| # | Do | Say (to the robot) | What should happen |
|---|---|---|---|
| 1 | Click **Talk to Pickyourtrail AI** and allow the mic | — | The robot greets you. Status: *Speaking* → *Listening*. The robot's rings move with its voice. |
| 2 | Speak | "I'd like a five-day family trip to Bali in December." | Status goes to *Thinking*. The Trip Profile fills Bali / 5 days / December. The robot asks the next question aloud. |
| 3 | Speak | "Two adults and two kids, aged six and nine." | Travellers fill in; *kids → family* is marked **Assumed** |
| 4 | Speak while the robot is talking | "Our budget is three lakh including flights, from Chennai." | The robot stops talking when you start (barge-in), then answers |
| 5 | Click **Mute**, then **Resume** | — | The status shows the mic is off, then *Listening* again |
| 6 | Answer the remaining questions (for example "We love beaches and food"), then listen to the recap | "Yes, that's right." | The robot reads back "Here's what I have…". Confirming generates the itinerary, and the robot speaks a short summary. |
| 7 | Click **Switch to text** and type one message | (typed) "Add a beach day" | The same conversation continues in text, which shows that voice and chat share one trip |
| 8 | Click **End** | — | Status: *Ended*. "Your trip is saved." |

Everything on screen in this segment is the real product. Don't edit in voice lines that weren't actually spoken to the app.

If the microphone is blocked (for example on a managed work laptop), the panel offers **Hear the robot without a microphone**. You can type and the robot answers aloud. Say this in the voiceover; don't present it as speech input.

## 4. Putting it together (Clipchamp)

1. Open Clipchamp → **Create a new video** → import `pickyourtrail-ai-demo.mp4` and the voice video (the reenactment, your live recording, or both).
2. Order: title → Customer chat (0:00–0:50) → **voice segment** → Itinerary onward (0:50–end).
   - To split, place the playhead at about 0:50 and press **S**.
3. Optional: add a narration track (the voiceover script below) and low background music. Keep the robot's voice clearly louder than the music.
4. **Export → 1080p** produces an MP4.

### Voiceover script (about 3 minutes)

> **Intro.** This is Pickyourtrail AI: one platform where travellers plan trips with an AI assistant, and the team behind every trip runs sales, support and operations with AI help.
>
> **Chat.** A traveller describes the trip in their own words. The planner pulls out the destination, length and month, fills the trip profile, and asks only for what's missing. Each detail is labelled: stated by the customer, assumed, a default, or confirmed.
>
> **Voice.** The same planner works by voice. The robot listens, updates the same trip profile, and answers aloud. You can interrupt it, mute it, or switch to typing at any moment, and nothing is lost.
>
> **Itinerary.** From the profile, the AI builds a day-by-day itinerary with transparent cost estimates. Any activity can be swapped and the totals update. The trip is saved on the server.
>
> **Quote.** When the traveller is ready, the trip goes to a travel expert. The app is honest about status: nothing is booked or charged until a real booking is confirmed.
>
> **CRM.** On the employee side, that conversation is already a sales lead, with budget, dates, travellers, the itinerary and a suggested next action.
>
> **AI Command Center and Copilot.** Staff ask questions in plain language. Answers come from the company's own records, with sources shown. Any action, such as scheduling a follow-up, waits for a human to approve it.
>
> **Support and analytics.** Support sees the customer's ticket with its SLA timer and a case summary. Managers track conversion, response times and revenue trends, and every metric has a definition.
>
> **Close.** Chat or voice planning, itineraries and quotes, CRM, an AI copilot, support operations and analytics — Pickyourtrail AI.
