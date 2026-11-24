import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, type Download, type Page, type TestInfo } from "@playwright/test";
import { extractText, getDocumentProxy } from "unpdf";
import { PILLARS } from "@opentenant/assessment";
import { record } from "./fixtures";

async function completed(download: Download, info: TestInfo, extension: string) {
  expect(await download.failure(), `${extension} must finish`).toBeNull();
  expect(download.suggestedFilename()).toMatch(new RegExp(`Production_Proof.*\\.${extension}$`));
  const path = await download.path(); expect(path).toBeTruthy();
  const bytes = await readFile(path!); expect(bytes.length).toBeGreaterThan(0);
  const artifact = info.outputPath(`assessment.${extension}`);
  await mkdir(info.outputDir, { recursive: true }); await writeFile(artifact, bytes);
  await info.attach(`assessment.${extension}`, { path: artifact });
  await record({ kind: "artifact", width: pageWidth(info), format: extension, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  return bytes;
}

const pageWidth = (info: TestInfo) => Number(info.title.match(/at (\d+)$/)?.[1]);

function csvRows(text: string) {
  const cells = [...text.matchAll(/"((?:[^"]|"")*)"(,|\r?\n|$)/g)];
  expect(cells.map(cell => cell[0]).join(""), "CSV must parse through its final byte").toBe(text);
  const rows: string[][] = [];
  let row: string[] = [];
  for (const cell of cells) {
    row.push(cell[1]!.replace(/""/g, '"'));
    if (cell[2] !== ",") { rows.push(row); row = []; }
  }
  expect(row, "CSV has no incomplete final row").toEqual([]);
  return rows;
}

async function renderPdf(page: Page, bytes: Buffer, info: TestInfo) {
  const source = await readFile(new URL(import.meta.resolve("unpdf/pdfjs")), "utf8");
  const context = await page.context().browser()!.newContext();
  try {
    const preview = await context.newPage();
    await preview.route("**/*", route => new URL(route.request().url()).pathname === "/pdfjs.mjs"
      ? route.fulfill({ contentType: "text/javascript", body: source })
      : route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="en"><title>PDF rendering evidence</title><body></body></html>' }));
    await preview.goto(new URL("/__pdf-proof", page.url()).href);
    const pages = await preview.evaluate(async ({ data, url }) => {
      const { getDocument } = await import(url);
      const doc = await getDocument({ data: Uint8Array.from(data), stopAtErrors: true }).promise;
      const result = [];
      try {
        for (let number = 1; number <= doc.numPages; number++) {
          const pdfPage = await doc.getPage(number);
          const viewport = pdfPage.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext("2d")!;
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let ink = 0;
          for (let i = 0; i < pixels.length; i += 4) if (Math.min(pixels[i]!, pixels[i+1]!, pixels[i+2]!) < 240) ink++;
          result.push({ number, width: canvas.width, height: canvas.height, ink, png: canvas.toDataURL("image/png") });
        }
      } finally { await doc.destroy(); }
      return result;
    }, { data: [...bytes], url: new URL("/pdfjs.mjs", preview.url()).href });
    expect(pages.length).toBeGreaterThan(0);
    for (const result of pages) {
      expect(result.width).toBeGreaterThan(500); expect(result.height).toBeGreaterThan(700);
      expect(result.ink, `PDF page ${result.number} must render nonblank content`).toBeGreaterThan(500);
      const artifact = info.outputPath(`pdf-page-${result.number}.png`);
      await writeFile(artifact, Buffer.from(result.png.split(",")[1]!, "base64"));
      await info.attach(`pdf-page-${result.number}.png`, { path: artifact, contentType: "image/png" });
    }
    await record({ kind: "pdf-render", width: pageWidth(info), pages: pages.map(({ number, width, height, ink }) => ({ number, width, height, ink })) });
  } finally { await context.close(); }
}

export async function proveDownloads(page: Page, info: TestInfo) {
  await page.getByLabel("Client / organization", { exact: true }).fill("Production Proof");
  const evidence = 'Production evidence, with "quoted text"\nand a second line';
  const dimensions = PILLARS.flatMap(p => p.dimensions.map(d => ({ pillar: p.name, dimension: d.name, id: `${p.key}__${d.key}` })));
  for (const pillar of PILLARS) {
    await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: new RegExp(pillar.name) }).click();
    for (const group of await page.getByRole("group", { name: /^Maturity score for / }).all()) await group.getByRole("button", { name: /^3 / }).click();
    await page.getByLabel(`Evidence for ${pillar.dimensions[0]!.name}`, { exact: true }).fill(evidence);
  }
  await page.getByLabel("Respondent name", { exact: true }).fill("Example Respondent");
  await page.getByLabel("Role", { exact: true }).fill("Example Role");
  await page.getByRole("button", { name: "Save response", exact: true }).click();
  await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: /AI Readiness/ }).click();
  await expect(page.getByRole("heading", { name: "AI Readiness", exact: true })).toBeVisible();
  const trigger = page.getByRole("button", { name: "Export data", exact: true });
  for (const format of ["json", "csv"]) {
    await trigger.focus(); await page.keyboard.press("Enter");
    const item = page.getByRole("menuitem", { name: format === "json" ? "Export report JSON" : "Export CSV", exact: true });
    await page.keyboard.press(format === "json" ? "End" : "Home"); await expect(item).toBeFocused();
    const pending = page.waitForEvent("download"); await page.keyboard.press("Enter");
    const bytes = await completed(await pending, info, format);
    await expect(trigger).toBeFocused(); await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeFocused();
    const text = bytes.toString("utf8");
    if (format === "json") {
      const report = JSON.parse(text);
      expect(report.clientInfo.name).toBe("Production Proof");
      expect(report.dashboard).toMatchObject({ scoredCount: 25, overallScore: 3 });
      expect(report.dashboard.pillarResults).toHaveLength(5); expect(report.respondents).toHaveLength(1);
      expect(report.respondents[0]).toMatchObject({ name: "Example Respondent", role: "Example Role", company: "Production Proof", scores: Object.fromEntries(dimensions.map(d => [d.id, 3])) });
    } else {
      const rows = csvRows(text);
      expect(rows.shift()).toEqual(["Pillar", "Dimension", "Score", "Level", "Evidence"]);
      expect(rows).toEqual(dimensions.map((d,i) => [d.pillar, d.dimension, "3", "Defined", i % 5 === 0 ? evidence : ""]));
    }
  }
  const pdfButton = page.getByRole("button", { name: "Download PDF", exact: true });
  await pdfButton.focus(); const pending = page.waitForEvent("download"); await page.keyboard.press("Enter");
  const bytes = await completed(await pending, info, "pdf");
  expect(bytes.subarray(0,5).toString()).toBe("%PDF-");
  expect(bytes.toString("latin1").trimEnd()).toMatch(/startxref\s+\d+\s+%%EOF$/);
  const document = await getDocumentProxy(new Uint8Array(bytes), { stopAtErrors: true });
  try {
    const { totalPages, text } = await extractText(document, { mergePages: true });
    expect(totalPages).toBe(document.numPages); expect(totalPages).toBeGreaterThan(0);
    for (const content of ["Production Proof", ...PILLARS.map(p => p.name)]) expect(text).toContain(content);
    for (let n = 1; n <= document.numPages; n++) {
      const pdfPage = await document.getPage(n); const viewport = pdfPage.getViewport({ scale: 1 });
      const content = await pdfPage.getTextContent();
      expect(content.items.length, `PDF page ${n} has text`).toBeGreaterThan(0);
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [x,y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
        expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
        expect(x! + item.width).toBeLessThanOrEqual(viewport.width + 1); expect(y).toBeLessThanOrEqual(viewport.height);
      }
    }
  } finally { await document.destroy(); }
  await renderPdf(page, bytes, info);
  await expect(pdfButton).toBeFocused(); await page.keyboard.press("Tab"); await expect(trigger).toBeFocused();
}
