import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/**
 * The complete customer-to-business journey from the assignment brief,
 * executed in a real browser against a production build in mock AI mode.
 */

let tripId = "";
let ticketRef = "";
let baseline: { newLeads: number; openTickets: number; bookingHandoffsOpen: number };

async function staffApi(request: APIRequestContext, email: string) {
  const res = await request.post("/api/auth/login", { data: { email, password: "demo1234" } });
  expect(res.ok()).toBeTruthy();
}

async function kpis(request: APIRequestContext) {
  const res = await request.get("/api/dashboard/overview");
  expect(res.ok()).toBeTruthy();
  return (await res.json()).kpis;
}

async function say(page: Page, message: string) {
  await page.fill("#planner-input", message);
  await Promise.all([page.waitForResponse((r) => r.url().includes("/api/ai/chat") && r.request().method() === "POST"), page.keyboard.press("Enter")]);
  await expect(page.getByText("Thinking…", { exact: true })).toBeHidden();
}

test.describe.serial("customer-to-business journey", () => {
  test("customer discovers, plans, edits, saves and requests a booking", async ({ page, playwright }) => {
    const sales = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
    await staffApi(sales, "sales@pyt-demo.test");
    baseline = await kpis(sales);

    // 1–2. Home page → start AI planning.
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Where would you like to go next?" })).toBeVisible();
    await page.getByLabel(/Describe your trip/).fill("I want a five-day family trip to Bali in December");
    await page.getByRole("button", { name: "Plan with AI" }).click();
    await page.waitForURL(/\/plan\?trip=/);
    tripId = new URL(page.url()).searchParams.get("trip")!;
    await expect(page.getByText(/Got it — Bali · 5 days/).first()).toBeVisible();
    // 14. Mock mode is clearly labelled.
    await expect(page.getByText("Demo mode · rules-based", { exact: true }).first()).toBeVisible();

    // 3–4. Provide the remaining details; the planner must only ask for what's missing.
    for (const m of ["Flexible within the month", "2 adults and 2 kids aged 6 and 9", "3 lakh total including flights", "from Chennai"]) await say(page, m);
    const assistantText = (await page.locator("[data-role=assistant]").allInnerTexts()).join("\n");
    expect(assistantText).not.toMatch(/Where would you like to go/);
    expect(assistantText).not.toMatch(/How many days would you like/);
    expect(assistantText).toMatch(/What do you enjoy most on holiday/);
    await expect(page.getByText("₹3,00,000 total", { exact: true })).toBeVisible();
    await expect(page.getByText("Chennai", { exact: true })).toBeVisible();

    // 5. Generate the itinerary.
    await page.getByRole("button", { name: "Generate itinerary" }).click();
    await page.waitForURL(/\/itinerary$/);
    await expect(page.locator("#day-5")).toBeVisible();
    await expect(page.getByText("Prices are estimates", { exact: true })).toBeVisible();

    // 6. Replace an activity with an alternative.
    await page.getByRole("button", { name: /^Replace / }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Choose" }).first()).toBeVisible();
    const chosen = (await dialog.locator("li p.font-medium").first().innerText()).trim();
    await dialog.getByRole("button", { name: "Choose" }).first().click();
    await expect(page.getByText(/Replaced “.+” with “.+”/).first()).toBeVisible();

    // 7. Save the trip.
    await page.getByRole("button", { name: "Save trip" }).click();
    await expect(page.getByText("Trip saved to My Trips", { exact: true })).toBeVisible();

    // 12. Reload: everything persisted on the server.
    await page.reload();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByText(chosen, { exact: true }).first()).toBeVisible();

    // Booking handoff requires explicit confirmation and never claims a confirmed booking.
    await page.getByRole("button", { name: "Review & book" }).click();
    await page.waitForURL(/\/review$/);
    await page.getByLabel("Full name").fill("E2E Traveller");
    await page.getByLabel("Email").fill("e2e.traveller@example.com");
    const submit = page.getByRole("button", { name: "Send booking request" });
    await expect(submit).toBeDisabled();
    await page.getByRole("checkbox").check();
    await submit.click();
    await expect(page.getByText("Nothing has been booked or charged yet.", { exact: true })).toBeVisible();
    await expect(page.getByText("Not confirmed · no provider connected", { exact: true })).toBeVisible();

    // 9. Create a support ticket.
    await page.goto("/support");
    await page.getByRole("button", { name: "Create a ticket", exact: true }).click();
    await page.getByLabel("How can we help?").fill("E2E: please confirm early hotel check-in for my Bali trip");
    await page.getByRole("dialog").getByRole("button", { name: "Create ticket" }).click();
    const created = page.getByText(/Ticket PYT-\d+ created/);
    await expect(created).toBeVisible();
    ticketRef = (await created.innerText()).match(/PYT-\d+/)![0];
    await sales.dispose();
  });

  test("employees see the lead, the ticket and updated metrics", async ({ browser, playwright }) => {
    // 8. The lead appears in the CRM with the customer's details.
    const salesPage = await (await browser.newContext()).newPage();
    await salesPage.goto("/login");
    await salesPage.getByRole("button", { name: "Sales", exact: true }).click();
    await salesPage.waitForURL(/\/admin/);
    await salesPage.goto("/admin/leads");
    await salesPage.getByLabel("Search leads", { exact: true }).fill("E2E Traveller");
    await salesPage.getByRole("button", { name: "E2E Traveller" }).click();
    await expect(salesPage.getByText(/Itinerary v1: 5 days/).first()).toBeVisible();
    await expect(salesPage.getByText(/Customer requested a booking/).first()).toBeVisible();
    const leadId = new URL(salesPage.url()).searchParams.get("lead")!;

    // 9–11. The employee asks the AI Command Center about the lead and prepares a follow-up.
    await salesPage.goto(`/admin/command-center?leadId=${leadId}&label=${encodeURIComponent("Lead: E2E Traveller")}`);
    await salesPage.getByRole("button", { name: "Summarize this customer's requirements and conversation" }).click();
    await expect(salesPage.getByText(/Requirements: Destination: Bali/).first()).toBeVisible();
    await expect(salesPage.getByText(/E2E Traveller: New lead for Bali/).first()).toBeVisible();
    await salesPage.locator("#command-input").fill("Prepare a follow-up message for this lead");
    await salesPage.keyboard.press("Enter");
    await expect(salesPage.getByText("Needs your approval", { exact: true })).toBeVisible();
    await expect(salesPage.getByRole("textbox", { name: "Prepared follow-up message" })).toHaveValue(/Hi E2E, thanks for planning your Bali/);
    await salesPage.getByRole("button", { name: /Approve & run/ }).last().click();
    await expect(salesPage.getByText(/Follow-up scheduled for E2E Traveller/).first()).toBeVisible();
    await salesPage.goto(`/admin/leads?lead=${leadId}`);
    await expect(salesPage.getByText(/Follow-up message prepared with the AI Command Center \(not sent\)/).first()).toBeVisible();
    await expect(salesPage.getByText("Suggested next action", { exact: true })).toBeVisible();

    // The Employee AI Copilot answers from the same records, with sources.
    await salesPage.getByRole("link", { name: "Ask the AI Copilot" }).click();
    await salesPage.waitForURL(/\/admin\/copilot\?leadId=/);
    await salesPage.getByRole("button", { name: "Summarize this lead's travel requirements" }).first().click();
    await expect(salesPage.getByText(/Requirements: Destination: Bali/).first()).toBeVisible();
    await expect(salesPage.getByText("Sources", { exact: true }).first()).toBeVisible();

    // 10. The ticket appears in support operations.
    const supportPage = await (await browser.newContext()).newPage();
    await supportPage.goto("/login");
    await supportPage.getByRole("button", { name: "Support", exact: true }).click();
    await supportPage.waitForURL(/\/admin/);
    await supportPage.goto("/admin/support");
    await supportPage.getByLabel("Search tickets", { exact: true }).fill(ticketRef);
    await expect(supportPage.getByText("E2E: please confirm early hotel check-in for my Bali trip", { exact: true }).first()).toBeVisible();
    // 12. …and can be assigned.
    await supportPage.getByText("E2E: please confirm early hotel check-in for my Bali trip", { exact: true }).first().click();
    const assign = supportPage.getByLabel("Assign ticket to");
    await assign.selectOption({ label: "Arjun Mehta" });
    await expect(assign.locator("option:checked")).toHaveText("Arjun Mehta");
    await supportPage.reload(); // persisted on the server
    await expect(supportPage.getByLabel("Assign ticket to").locator("option:checked")).toHaveText("Arjun Mehta");

    // 11. Dashboard metrics reflect the new records.
    const api = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
    await staffApi(api, "sales@pyt-demo.test");
    const after = await kpis(api);
    expect(after.newLeads).toBe(baseline.newLeads + 1);
    expect(after.openTickets).toBe(baseline.openTickets + 1);
    expect(after.bookingHandoffsOpen).toBe(baseline.bookingHandoffsOpen + 1);
    await salesPage.goto("/admin");
    await expect(salesPage.getByText("New leads (7 days)", { exact: true })).toBeVisible();
    await api.dispose();
  });

  test("unauthorized access to customer and employee data is blocked", async ({ browser, playwright }) => {
    // 13a. Anonymous visitors can't use the employee portal or APIs.
    const anon = await (await browser.newContext()).newPage();
    await anon.goto("/admin");
    await anon.waitForURL(/\/login/);
    const api = await playwright.request.newContext({ baseURL: "http://localhost:3100" });
    expect((await api.get("/api/leads")).status()).toBe(401);

    // 13b. Another visitor can't open this customer's trip.
    await anon.goto(`/trips/${tripId}/itinerary`);
    await expect(anon.getByText("Access denied", { exact: true })).toBeVisible();
    expect((await api.get(`/api/trips/${tripId}`)).status()).toBe(403);

    // 13c. Customers can't enter the employee portal.
    const customer = await (await browser.newContext()).newPage();
    await customer.goto("/login");
    await customer.getByRole("button", { name: "Customer", exact: true }).click();
    await customer.waitForURL(/\/trips/);
    await customer.goto("/admin");
    await customer.waitForURL(/reason=employee/);
    await api.dispose();
  });

  test("runs in mock mode without an AI key", async ({ request }) => {
    const status = await (await request.get("/api/ai/status")).json();
    expect(status.mode).toBe("mock");
    expect(status.voice.realtimeAvailable).toBe(false);
  });

  test("recovers gracefully from an AI provider error", async ({ page }) => {
    // 15. Server :3101 has a key configured but the provider is unreachable.
    const status = await (await page.request.get("http://localhost:3101/api/ai/status")).json();
    expect(status.mode).toBe("live");
    await page.goto("http://localhost:3101/plan?q=" + encodeURIComponent("A 4-day trip to Dubai for 2 adults in January"));
    await expect(page.getByText(/Got it — Dubai · 4 days/).first()).toBeVisible();
    await expect(page.getByText(/standard planner was used/).first()).toBeVisible();
    await expect(page.getByText("Standard planner (AI fallback)", { exact: true }).first()).toBeVisible();
    await say(page, "budget 2 lakh total");
    await expect(page.getByText("₹2,00,000 total", { exact: true })).toBeVisible();
  });
});
