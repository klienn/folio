import { expect, test, type Page } from "@playwright/test";

async function pollingFixture(page: Page) {
  const state = { calls: 0, status: "completed", fail: false, hang: false };
  const now = new Date("2026-09-29T12:00:00Z");
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now);
  await page.route("**/api/documents", async (route) => {
    state.calls++;
    if (state.hang) return;
    await route.fulfill({
      status: state.fail ? 503 : 200,
      json: state.fail
        ? { detail: "Unavailable" }
        : [
            {
              id: "polling-document",
              filename: "Polling sample.pdf",
              kind: "pdf",
              size: 100,
              page_count: 1,
              completed_pages: state.status === "completed" ? 1 : 0,
              failed_pages: 0,
              status: state.status,
              language: "en",
              handwriting: false,
              force_ocr: false,
              created_at: now.toISOString(),
              error: null,
            },
          ],
    });
  });
  await page.route("**/api/system", (route) =>
    route.fulfill({
      json: {
        languages: [],
        devices: [],
        runtime: { state: "ready", backend: `Refresh ${state.calls}` },
        limits: { file_mb: 50, pages: 500 },
      },
    }),
  );
  return state;
}

async function visibility(page: Page, hidden: boolean) {
  await page.evaluate((value) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("polls quickly for work, slowly when idle, and pauses hidden tabs", async ({
  page,
}) => {
  const state = await pollingFixture(page);
  await page.goto("/");
  await expect(page.getByText("Refresh 1", { exact: true })).toBeVisible();
  await page.clock.runFor(29_999);
  expect(state.calls).toBe(1);

  state.status = "queued";
  await page.clock.runFor(1);
  await expect(page.getByText("Refresh 2", { exact: true })).toBeVisible();
  await page.clock.runFor(1_999);
  expect(state.calls).toBe(2);
  state.status = "processing";
  await page.clock.runFor(1);
  await expect(page.getByText("Refresh 3", { exact: true })).toBeVisible();

  await visibility(page, true);
  await page.clock.runFor(120_000);
  expect(state.calls).toBe(3);
  state.status = "completed";
  await visibility(page, false);
  await expect(page.getByText("Refresh 4", { exact: true })).toBeVisible();
  await page.clock.runFor(29_999);
  expect(state.calls).toBe(4);
  await page.clock.runFor(1);
  await expect(page.getByText("Refresh 5", { exact: true })).toBeVisible();
});

test("backs off failures, bounds stalled requests, and recovers without overlap", async ({
  page,
}) => {
  const state = await pollingFixture(page);
  state.fail = true;
  await page.goto("/");
  await expect(
    page.getByText("Server disconnected", { exact: true }),
  ).toBeVisible();
  let calls = 1;
  for (const delay of [5_000, 10_000, 20_000, 40_000, 60_000, 60_000]) {
    await page.clock.runFor(delay - 1);
    expect(state.calls).toBe(calls);
    const failed = page.waitForEvent("requestfinished", {
      predicate: (request) => request.url().endsWith("/api/documents"),
    });
    await page.clock.runFor(1);
    await failed;
    // Allow the fetch rejection and timer scheduling to finish before advancing.
    await page.evaluate(() => Promise.resolve());
    expect(state.calls).toBe(++calls);
  }
  state.fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(
    page.getByText(`Refresh ${++calls}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Server disconnected", { exact: true }),
  ).toBeHidden();

  state.hang = true;
  await page.clock.runFor(30_000);
  await expect.poll(() => state.calls).toBe(++calls);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.clock.runFor(14_999);
  expect(state.calls).toBe(calls);
  await page.clock.runFor(1);
  await expect(
    page.getByText("Server disconnected", { exact: true }),
  ).toBeVisible();
  state.hang = false;
  await page.clock.runFor(4_999);
  expect(state.calls).toBe(calls);
  await page.clock.runFor(1);
  await expect(
    page.getByText(`Refresh ${++calls}`, { exact: true }),
  ).toBeVisible();
});
