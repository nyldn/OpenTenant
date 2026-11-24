// Uses the workspace's existing Vitest compiler and E2E Playwright installation.
// Run from the repository root; no service, fixture, package download or network.
import assert from "node:assert/strict";
// eslint-disable-next-line no-restricted-imports -- This proof loads the workspace test toolchain, never application configuration.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const require = createRequire(import.meta.url);
const compiler = createRequire(require.resolve("vite", { paths: [require.resolve("vitest/package.json")] }));
const { build } = compiler("esbuild");
const { chromium, expect } = createRequire(new URL("../../../../tooling/e2e/package.json", import.meta.url))("@playwright/test");
const platform = createRequire(new URL("../../../../apps/platform/package.json", import.meta.url));
const postcss = createRequire(platform.resolve("@tailwindcss/postcss"))("postcss");
const tailwind = platform("@tailwindcss/postcss");
const cssPath = new URL("../../../../apps/platform/app/globals.css", import.meta.url);
const { css } = await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath.pathname });
const { outputFiles } = await build({ bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", stdin: {
  loader: "tsx", resolveDir: resolve(import.meta.dirname, ".."), contents: `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SharedForm, FormInput } from './components/form-field';
import { DestructiveConfirmationDialog } from './components/destructive-confirmation-dialog';
import { Button } from './components/ui/button';
let submits = 0, confirmations = 0;
createRoot(document.getElementById('root')!).render(<>
  <SharedForm id="proof" submitLabel="Save" onSubmit={async data => {
    await new Promise(resolve => setTimeout(resolve, 150));
    if (++submits === 1) return { status: 'error', message: 'Check your input', fieldErrors: { email: 'Use a valid email' } };
    return { status: 'success', message: 'Saved safely' };
  }}>
    <FormInput name="email" label="Email" help="Work address" type="email" required />
    <FormInput name="password" label="Password" type="password" />
    <FormInput name="locked" label="Locked" disabled defaultValue="Read only" />
  </SharedForm>
  <DestructiveConfirmationDialog trigger={<Button>Schedule deletion</Button>} title="Schedule deletion?" description="Erasure starts after retention. You can restore before then." confirmLabel="Schedule deletion" onConfirm={async () => { if (++confirmations === 1) throw new Error('private error'); }} />
</>);` } });
const browser = await chromium.launch({ headless: true });
const evidence = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.route("**/*", route => route.abort());
    await page.setContent('<html lang="en"><title>F1 browser proof</title><div id="root"></div></html>');
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: outputFiles[0].text });
    const email = page.getByLabel("Email", { exact: true });
    const password = page.getByLabel("Password", { exact: true });
    await email.fill("person@example.test");
    await password.fill("example-password");
    await expect(page.getByLabel("Locked", { exact: true })).toBeDisabled();
    const before = await email.getAttribute("id");
    const targetSizes = await page.getByRole("button").evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    assert(targetSizes.every(height => height >= 44), "Default shared controls reach the 44px product target");
    assert((await email.boundingBox()).height >= 44, "Default shared input reaches 44px");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(email).toBeDisabled();
    await expect(page.getByRole("status")).toHaveText("Saving…");
    await expect(page.getByRole("alert").filter({ hasText: "Check your changes" })).toBeFocused();
    await expect(email).toHaveValue("person@example.test");
    await expect(password).toHaveValue("");
    assert.equal(await email.getAttribute("id"), before);
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toHaveAttribute("aria-describedby", "proof-email-help proof-email-error");
    await page.getByRole("link", { name: "Use a valid email" }).click();
    await expect(email).toBeFocused();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("status")).toHaveText("Saved safely");
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Schedule deletion?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Schedule deletion", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
    await dialog.getByRole("button", { name: "Schedule deletion", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("The action couldn’t be completed. Please try again.");
    await expect(page.getByText("private error")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Schedule deletion", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    evidence.push({ width, fields: "label/help/error/stable-id/pending/disabled", retry: "safe input retained; password cleared; polite success", dialog: "cancel initial focus; Escape restores trigger; explicit confirm; rejected confirm retries", pass: true });
    await page.close();
  }
  await mkdir("/tmp/f1-proof", { recursive: true });
  await writeFile("/tmp/f1-proof/browser.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log("PASS F1 browser proof at 390 and 1440; /tmp/f1-proof/browser.json");
} finally { await browser.close(); }
