import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { PILLARS } from "@opentenant/assessment";
import { test, expect, signIn } from "./fixtures";

async function saveClient(page: Page, client: string, score: 3 | 4) {
  await page.getByPlaceholder("Client / organization").or(page.getByLabel(/^(client \/ organization|organization|client|organization name)$/i)).fill(client);
  for (const pillar of PILLARS) {
    await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: new RegExp(pillar.name) }).click();
    const groups = page.getByRole("group", { name: /^Maturity score for / });
    await expect(groups).toHaveCount(pillar.dimensions.length);
    for (const group of await groups.all()) await group.getByRole("button", { name: new RegExp(`^${score} `) }).click();
  }
  await page.getByPlaceholder("Respondent name").or(page.getByLabel("Respondent name", { exact: true })).fill(`${client} respondent`);
  await page.getByRole("button", { name: "Save response", exact: true }).click();
  await page.getByRole("navigation", { name: "Assessment stages" }).getByRole("button", { name: /AI Readiness/ }).click();
  await expect(page.getByRole("heading", { name: "AI Readiness", exact: true })).toBeVisible();
  await expect(page.getByText("Saved to this browser.", { exact: true })).toBeVisible();
}
async function report(page: Page) {
  await page.getByRole("button", { name: "Export data", exact: true }).click();
  const pending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export report JSON", exact: true }).click();
  const download = await pending;
  return JSON.parse(await readFile((await download.path())!, "utf8"));
}

test("client B never aggregates client A after New engagement", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.goto("/assessment");
  await saveClient(page, "Client A", 3);
  const a = await report(page);
  expect(a.dashboard.overallScore).toBe(3);
  expect(a.respondents).toHaveLength(1);
  expect(Object.values(a.respondents[0].scores)).toEqual(Array(25).fill(3));
  const backupPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download engagement backup", exact: true }).click();
  const backup = JSON.parse(await readFile((await (await backupPending).path())!, "utf8"));

  await page.getByRole("button", { name: "New engagement", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Start a new engagement?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await expect(dialog).toContainText("backed up");
  await dialog.getByRole("button", { name: "Start new engagement", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Client A respondent", { exact: true })).toHaveCount(0);
  await saveClient(page, "Client B", 4);
  // Reload proves the document boundary survives persistence and hydration.
  await page.reload();
  await expect(page.getByRole("heading", { name: "AI Readiness", exact: true })).toBeVisible();
  const b = await report(page);
  expect(b.dashboard.overallScore).toBe(4);
  expect(b.dashboard.scoredCount).toBe(25);
  expect(b.respondents).toHaveLength(1);
  expect(Object.values(b.respondents[0].scores)).toEqual(Array(25).fill(4));
  expect(JSON.stringify(b)).not.toContain("Client A");
  const bBackupPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download engagement backup", exact: true }).click();
  const bBackup = JSON.parse(await readFile((await (await bBackupPending).path())!, "utf8"));
  expect(bBackup.engagementId).not.toBe(backup.engagementId);
  expect(bBackup.readout).toBeNull();
  expect(JSON.stringify(bBackup)).not.toContain("Client A");

  await page.getByRole("button", { name: "Export data", exact: true }).click();
  const csvPending = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export CSV", exact: true }).click();
  const csv = await readFile((await (await csvPending).path())!, "utf8");
  expect(csv.split("\n")).toHaveLength(26);
  expect(csv.split("\n").slice(1).every(line => line.includes(',"4",'))).toBe(true);
  expect(csv).not.toContain("Client A");
  const pdfPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const pdf = await pdfPending;
  expect(pdf.suggestedFilename()).toContain("Client_B");
  expect((await readFile((await pdf.path())!)).subarray(0, 5).toString()).toBe("%PDF-");

  // Use the internally verified backup, after B's many autosaves have completed.
  await page.getByRole("button", { name: "Restore verified backup", exact: true }).click();
  await expect(page.getByPlaceholder("Client / organization").or(page.getByLabel(/^(client \/ organization|organization|client|organization name)$/i))).toHaveValue("Client A");
  const restored = await report(page);
  expect(restored).toEqual(a);
  expect(restored.dashboard.overallScore).toBe(3);
  const restoredPending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download engagement backup", exact: true }).click();
  const restoredBackup = JSON.parse(await readFile((await (await restoredPending).path())!, "utf8"));
  expect(restoredBackup.engagementId).toBe(backup.engagementId);
  expect(restoredBackup.respondents).toEqual(backup.respondents);
});
