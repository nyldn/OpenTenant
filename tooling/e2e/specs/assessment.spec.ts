import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { test, expect, signIn } from "./fixtures";
import { PILLARS } from "@opentenant/assessment";

// Export cells are quoted, including commas, quotes and newlines in evidence.
function parseCsv(text: string) {
  const cells = /"((?:[^"]|"")*)"(,|\r?\n|$)/gy;
  const rows: string[][] = [[]];
  let end = 0;
  let match: RegExpExecArray | null;
  while ((match = cells.exec(text))) {
    rows.at(-1)!.push(match[1]!.replace(/""/g, '"'));
    end = cells.lastIndex;
    if (match[2] !== "," && end < text.length) rows.push([]);
  }
  expect(end, "CSV must parse to its final byte").toBe(text.length);
  return rows;
}
async function completedDownload(download: Download) {
  expect(await download.failure(), "download completed successfully").toBeNull();
  const path = await download.path();
  expect(path).toBeTruthy();
  const bytes = await readFile(path!);
  expect(bytes.byteLength).toBeGreaterThan(0);
  return bytes;
}

test("complete Assessment, save a response, review results and export JSON, CSV and PDF", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/assessment");
  await expect(page.getByLabel("Client / organization", { exact: true })).toBeVisible();
  await page.getByLabel("Client / organization", { exact: true }).fill("Other Engagement");
  await expect(page.getByText("Saved to this browser.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New engagement", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start new engagement", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await page.getByLabel("Client / organization", { exact: true }).fill("Example Assessment");
  const evidence = 'Example evidence, with "quoted text"\nand a second line';
  const dimensions = PILLARS.flatMap(p => p.dimensions.map(d => ({ pillar: p.name, dimension: d.name, id: `${p.key}__${d.key}` })));
  for (const pillar of PILLARS) {
    await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: new RegExp(pillar.name) }).click();
    const groups = page.getByRole("group", { name: /^Maturity score for / });
    await expect(groups).toHaveCount(pillar.dimensions.length);
    for (const group of await groups.all()) await group.getByRole("button", { name: /^3 / }).click();
    await page.getByLabel(`Evidence for ${pillar.dimensions[0]!.name}`, { exact: true }).fill(evidence);
  }
  await page.getByLabel("Respondent name", { exact: true }).fill("Example Respondent");
  await page.getByLabel("Role", { exact: true }).fill("Example Role");
  await page.getByRole("button", { name: "Save response", exact: true }).click();
  await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: /AI Readiness/ }).click();
  await expect(page.getByRole("heading", { name: "AI Readiness", exact: true })).toBeVisible();
  await expect(page.getByText(new RegExp(`${dimensions.length}/${dimensions.length} dimensions`))).toBeVisible();
  const exportButton = page.getByRole("button", { name: "Export data", exact: true });
  const pdfButton = page.getByRole("button", { name: "Download PDF", exact: true });
  for (const format of ["JSON", "CSV"] as const) {
    await exportButton.focus();
    await page.keyboard.press("Enter");
    const item = page.getByRole("menuitem", { name: format === "JSON" ? "Export report JSON" : "Export CSV", exact: true });
    if (format === "JSON") await page.keyboard.press("End");
    else await page.keyboard.press("Home");
    await expect(item).toBeFocused();
    const pending = page.waitForEvent("download");
    await page.keyboard.press("Enter");
    const download = await pending;
    expect(download.suggestedFilename()).toMatch(new RegExp(`Example_Assessment.*\\.${format.toLowerCase()}$`));
    const bytes = await completedDownload(download);
    await expect(exportButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    const text = bytes.toString("utf8");
    expect(text).not.toContain("Other Engagement");
    if (format === "JSON") {
      const report = JSON.parse(text);
      expect(report.clientInfo.name).toBe("Example Assessment");
      expect(report.dashboard.scoredCount).toBe(25);
      expect(report.dashboard.overallScore).toBe(3);
      expect(report.dashboard.pillarResults).toHaveLength(5);
      expect(report.respondents).toHaveLength(1);
      expect(report.respondents[0]).toMatchObject({ name: "Example Respondent", role: "Example Role", company: "Example Assessment" });
      expect(report.respondents[0].scores).toEqual(Object.fromEntries(dimensions.map(d => [d.id, 3])));
    } else {
      const rows = parseCsv(text);
      expect(rows.shift()).toEqual(["Pillar", "Dimension", "Score", "Level", "Evidence"]);
      expect(rows).toEqual(dimensions.map((d, index) => [d.pillar, d.dimension, "3", "Defined", index % 5 === 0 ? evidence : ""]));
    }
  }
  await pdfButton.focus();
  const pendingPdf = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const pdf = await pendingPdf;
  expect(pdf.suggestedFilename()).toMatch(/Example_Assessment.*\.pdf$/);
  const bytes = await completedDownload(pdf);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(bytes.toString("latin1").trimEnd()).toMatch(/startxref\s+\d+\s+%%EOF$/);
  const document = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: true });
  try {
    expect(document.numPages).toBeGreaterThanOrEqual(1);
    const { totalPages, text } = await extractText(document, { mergePages: true });
    expect(totalPages).toBe(document.numPages);
    expect(text).toContain("Example Assessment");
    expect(text).toContain("Strategy");
    expect(text).toContain("3");
    expect(text).not.toContain("Other Engagement");
  } finally { await document.destroy(); }
  await expect(pdfButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(exportButton).toBeFocused();
  await page.reload();
  await expect(page.getByLabel("Client / organization", { exact: true })).toHaveValue("Example Assessment");
});
