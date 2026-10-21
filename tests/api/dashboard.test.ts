import { beforeEach, describe, expect, it } from "vitest";
import { TestClient } from "../support/client";
import { resetRateLimits } from "@/lib/rate-limit";
import { get } from "@/lib/db";
import * as login from "@/app/api/auth/login/route";
import * as overview from "@/app/api/dashboard/overview/route";
import * as reports from "@/app/api/analytics/reports/route";

async function as(email: string) {
  const c = new TestClient();
  expect((await c.call(login.POST, "POST", "/api/auth/login", { email, password: "demo1234" })).status).toBe(200);
  return c;
}
beforeEach(() => resetRateLimits());

describe("business overview and analytics", () => {
  it("computes conversion for the selected range from stored records", async () => {
    const admin = await as("admin@pyt-demo.test");
    const r = await admin.call(overview.GET, "GET", "/api/dashboard/overview?days=90");
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(90);
    const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const leads = get<{ c: number }>("SELECT COUNT(*) c FROM leads WHERE created_at >= ?", [from])!.c;
    expect(r.body.conversion.leads).toBe(leads);
    expect(Array.isArray(r.body.activity)).toBe(true);
    expect(Array.isArray(r.body.exceptions)).toBe(true);
    expect((await admin.call(overview.GET, "GET", "/api/dashboard/overview?days=0")).status).toBe(400);
  });

  it("hides exceptions a role can't access", async () => {
    const sales = await as("sales@pyt-demo.test");
    const r = await sales.call(overview.GET, "GET", "/api/dashboard/overview");
    for (const e of r.body.exceptions) expect(e.type).not.toBe("urgent_ticket");
  });

  it("returns previous-period values for trend comparisons", async () => {
    const admin = await as("admin@pyt-demo.test");
    const r = await admin.call(reports.GET, "GET", "/api/analytics/reports");
    expect(r.status).toBe(200);
    expect(r.body.previous).toMatchObject({ leadToBookingRequestPct: expect.any(Number), leads: expect.any(Number) });
    expect(r.body.value.confirmedRevenue).toBe(0);
  });
});
