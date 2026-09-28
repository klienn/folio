import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

test.beforeEach(async ({ request }) => {
  const documents = await (await request.get("/api/documents")).json();
  for (const document of documents)
    await request.delete(`/api/documents/${document.id}`);
});

test("upload, review, preserve a draft during polling, save, export, and delete", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "A fresh page starts here" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/workspace-empty.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Add documents", exact: true })
    .click();
  await page
    .locator("input[type=file]")
    .setInputFiles(path.resolve(".e2e/welcome-guide.pdf"));
  await page
    .getByRole("button", { name: "Extract text from 1 file", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "welcome-guide.pdf", exact: true }),
  ).toBeVisible();
  const editor = page.getByRole("textbox", {
    name: "Extracted text",
    exact: true,
  });
  await expect(editor).toHaveValue(/A little less paperwork/, {
    timeout: 15000,
  });
  await expect(
    page.getByRole("img", { name: /Original page 1/ }),
  ).toBeVisible();
  await editor.fill('Saved correction, with "quotes".\n日本語 — العربية');
  // Returning to a visible tab refreshes immediately without replacing the draft.
  const refresh = page.waitForResponse(/\/api\/documents\//);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await refresh;
  await expect(editor).toHaveValue(
    'Saved correction, with "quotes".\n日本語 — العربية',
  );
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Changes saved", { exact: true }).first(),
  ).toBeVisible();
  await page.getByText("View original extraction").click();
  await expect(page.locator(".raw-text pre")).toContainText(
    "A little less paperwork",
  );
  await page.screenshot({
    path: "test-results/document-review.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(editor).toHaveValue(/Make the text your own/);
  await page
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(editor).toHaveValue(
    'Saved correction, with "quotes".\n日本語 — العربية',
  );
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("csv");
  await page.getByRole("link", { name: "Export CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^welcome-guide-ocr_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}Z\.csv$/,
  );
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain('"Saved correction, with ""quotes"".');
  expect(csv).toContain("日本語 — العربية");
  expect(csv).toContain("Make the text your own");
  expect(csv.split(/\r?\n/)[0]).toBe(
    "\ufeffdocument_id,filename,page_number,text,status",
  );
  await page
    .getByRole("combobox", { name: "Export format" })
    .selectOption("xlsx");
  const excelDownloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export Excel", exact: true }).click();
  const excelDownload = await excelDownloadPromise;
  expect(excelDownload.suggestedFilename()).toMatch(
    /^welcome-guide-ocr_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}Z\.xlsx$/,
  );
  expect(
    (await readFile((await excelDownload.path())!)).subarray(0, 2).toString(),
  ).toBe("PK");
  await excelDownload.saveAs("test-results/review-export.xlsx");
  await page
    .getByRole("button", { name: "Back to documents", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Select welcome-guide.pdf" })
    .check();
  await expect(
    page.getByRole("link", { name: "Export 1 selected" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Export 1 selected" }),
  ).toHaveAttribute("href", /format=xlsx.*ids=/);
  await page.screenshot({
    path: "test-results/document-library.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Add documents", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-library.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Actions for welcome-guide.pdf", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Open", exact: true }).click();
  await expect(editor).toHaveValue(
    'Saved correction, with "quotes".\n日本語 — العربية',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/mobile-review.png",
    fullPage: true,
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete document", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A fresh page starts here" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("invalid upload errors remain visible and can be dismissed", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Add documents", exact: true })
    .click();
  await page.locator("input[type=file]").setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("bad PDF"),
  });
  await page
    .getByRole("button", { name: "Extract text from 1 file", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("broken.pdf");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh page starts here" }),
  ).toBeVisible();
});

test("library deletion supports cancellation, single documents, and partial bulk failures", async ({
  page,
  request,
}) => {
  const buffer = await readFile(path.resolve(".e2e/welcome-guide.pdf"));
  const ids: string[] = [];
  for (const name of ["one.pdf", "two.pdf", "three.pdf"]) {
    const response = await request.post("/api/documents", {
      multipart: { files: { name, mimeType: "application/pdf", buffer } },
    });
    ids.push((await response.json()).documents[0].id);
  }
  await expect
    .poll(async () => {
      const documents = await (await request.get("/api/documents")).json();
      return documents.every(
        (document: { status: string }) => document.status === "completed",
      );
    })
    .toBe(true);
  await page.goto("/");
  const actions = page.getByRole("button", {
    name: "Actions for one.pdf",
    exact: true,
  });
  await actions.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Open", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Delete", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(actions).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await actions.click();
  await page.getByRole("heading", { name: "Document library" }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await actions.click();
  await page.screenshot({
    path: "test-results/document-actions-menu.png",
    fullPage: true,
  });
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(
      "original files, all page previews, extracted text, and saved edits",
    );
    await dialog.dismiss();
  });
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(actions).toBeVisible();
  await actions.click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(actions).toHaveCount(0);
  expect(
    (await request.get(`/api/documents/${ids[0]}/original`)).status(),
  ).toBe(404);

  await page
    .getByRole("checkbox", { name: "Select all visible documents" })
    .check();
  await page.route(`**/api/documents/${ids[1]}`, async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 500,
        json: { detail: "File is in use. Try deleting again." },
      });
    } else {
      await route.continue();
    }
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete 2 selected", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "two.pdf: File is in use",
  );
  await expect(
    page.getByRole("button", { name: "Actions for three.pdf", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Select two.pdf", exact: true }),
  ).toBeChecked();
  await page.unroute(`**/api/documents/${ids[1]}`);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Delete 1 selected", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "A fresh page starts here" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A fresh page starts here" }),
  ).toBeVisible();
});
