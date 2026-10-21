import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  path: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown>;
}

type Responder = (req: CapturedRequest) => { status?: number; json?: unknown; text?: string };

/** Minimal OpenAI-compatible HTTP server for exercising the real SDK without network or cost. */
export async function startFakeOpenAI(responder: Responder) {
  const requests: CapturedRequest[] = [];
  let current = responder;
  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const captured = { path: req.url ?? "", headers: req.headers, body: raw ? JSON.parse(raw) : {} };
    requests.push(captured);
    const out = current(captured);
    res.writeHead(out.status ?? 200, { "content-type": out.text !== undefined ? "text/plain" : "application/json" });
    res.end(out.text ?? JSON.stringify(out.json ?? {}));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    setResponder(r: Responder) {
      current = r;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** A Responses API payload whose output text is the given JSON. */
export function responsesPayload(output: unknown, usage = { input: 420, output: 90, cached: 256 }) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1_700_000_000,
    model: "gpt-4.1-mini-test",
    status: "completed",
    output: [
      {
        id: "msg_test",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: typeof output === "string" ? output : JSON.stringify(output), annotations: [] }],
      },
    ],
    usage: {
      input_tokens: usage.input,
      input_tokens_details: { cached_tokens: usage.cached },
      output_tokens: usage.output,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: usage.input + usage.output,
    },
  };
}

export const EXTRACTION_TEMPLATE = {
  destination: null, wantsRecommendations: false, departureCity: null, startDate: null, endDate: null, travelMonth: null, dateFlexibility: null,
  durationDays: null, adults: null, children: null, childrenAges: null, tripType: null, occasion: null, interests: null, pace: null,
  budgetAmount: null, currency: null, budgetScope: null, budgetIncludesFlights: null, accommodation: null, needsFlights: null, flightClass: null,
  dietary: null, accessibility: null, mustSee: null, specialRequests: null, unknownFields: [], noneFields: [], skippedFields: [],
  wantsToGenerate: false, sideQuestion: null, sideAnswer: null,
};
