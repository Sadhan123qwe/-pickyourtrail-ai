import { NextRequest } from "next/server";

type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

let ipCounter = 1;

/** Minimal HTTP client that calls Next.js route handlers directly, with a cookie jar. */
export class TestClient {
  cookies = new Map<string, string>();
  ip = `10.0.0.${ipCounter++}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test responses are asserted field by field
  async call<T = any>(handler: unknown, method: string, path: string, body?: unknown, params: Record<string, string> = {}) {
    const headers = new Headers({ "x-forwarded-for": this.ip });
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.cookies.size) headers.set("cookie", Array.from(this.cookies, ([k, v]) => `${k}=${v}`).join("; "));
    const req = new NextRequest(new URL(path, "http://localhost:3000"), {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const res = await (handler as Handler)(req, { params: Promise.resolve(params) });
    for (const cookie of res.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const idx = pair.indexOf("=");
      const name = pair.slice(0, idx);
      const value = pair.slice(idx + 1);
      if (!value || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const type = res.headers.get("content-type") ?? "";
    const data = type.includes("json") ? await res.json() : await res.text();
    return { status: res.status, body: data as T, headers: res.headers };
  }
}
