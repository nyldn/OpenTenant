// Branded PDF export of the Assessment Readiness Dashboard. The PDF is a
// printable deliverable using the tenant brand supplied by the runtime.

import type { DashboardResult, PriorityItem } from "./types"
import { BENCHMARK } from "./data/benchmark"
import { LEVEL_NAMES, PHASE_NAMES } from "./constants"
import type { ClientInfo } from "./store"
import { ASSESSMENT_VERSION, getAssessmentRuntimeConfig } from "./runtime"

const NAVY = "#0A1628"
const ORANGE = "#EA580C"
const SLATE = "#475569"
const MUTE = "#64748B"

type PdfMakeRuntime = {
  vfs?: unknown
  addVirtualFileSystem?: (vfs: unknown) => void
  createPdf: (def: unknown) => { download: (n: string) => void }
}
type PdfMakeModule = PdfMakeRuntime & { default?: PdfMakeRuntime }
type PdfFontsShape = { vfs?: unknown; pdfMake?: { vfs?: unknown } }
type PdfFontsModule = PdfFontsShape & { default?: unknown }

function stripMarkdown(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/^- /, "• ").trim())
    .filter(Boolean)
}

function stamp() {
  const d = new Date()
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`
}

export async function loadPdfMakeRuntime(): Promise<PdfMakeRuntime> {
  const pdfMakeMod = (await import("pdfmake/build/pdfmake.js")) as unknown as PdfMakeModule
  const pdfFontsMod = (await import("pdfmake/build/vfs_fonts.js")) as unknown as PdfFontsModule
  const pdfMake = pdfMakeMod.default ?? pdfMakeMod
  const defaultFonts = pdfFontsMod.default
  const defaultShape = defaultFonts && typeof defaultFonts === "object" ? defaultFonts as PdfFontsShape : undefined
  const vfs = defaultShape?.vfs ?? pdfFontsMod.vfs ?? defaultShape?.pdfMake?.vfs ?? pdfFontsMod.pdfMake?.vfs ?? defaultFonts
  if (vfs && typeof pdfMake.addVirtualFileSystem === "function") pdfMake.addVirtualFileSystem(vfs)
  else if (vfs) pdfMake.vfs = vfs
  return pdfMake
}

export async function downloadAssessmentPdf(
  clientInfo: ClientInfo,
  dash: DashboardResult,
  priorities: PriorityItem[],
  readout?: string,
) {
  const pdfMake = await loadPdfMakeRuntime()

  const viability =
    dash.overallScore >= 3.5 ? "AI-Ready" :
    dash.overallScore >= 2.5 ? "Ready with Investment" :
    "Foundational Work Needed"

  const pillarBody = [
    [
      { text: "Pillar", style: "th" }, { text: "Weight", style: "th", alignment: "right" },
      { text: "Your score", style: "th", alignment: "right" }, { text: "Industry median", style: "th", alignment: "right" },
      { text: "High performer", style: "th", alignment: "right" },
    ],
    ...dash.pillarResults.map((p) => {
      const b = BENCHMARK.pillars[p.key]
      return [
        p.name,
        { text: `${Math.round(p.weight * 100)}%`, alignment: "right" },
        { text: String(p.avg || "—"), alignment: "right", bold: true, color: NAVY },
        { text: String(b?.industry_median ?? "—"), alignment: "right", color: MUTE },
        { text: String(b?.high_performer ?? "—"), alignment: "right", color: MUTE },
      ]
    }),
  ]

  const sprint = priorities.slice(0, 7)

  // Executive readout leads the report (matches the on-screen order).
  const readoutBlocks = readout && readout.trim()
    ? [{ text: "Executive readout", style: "h2", margin: [0, 0, 0, 4] }, ...stripMarkdown(readout).map((line) => ({ text: line, style: "body", margin: [0, 0, 0, 3] })), { text: "", margin: [0, 0, 0, 10] }]
    : []

  const content: unknown[] = [
    { text: "AI Maturity Assessment", style: "title" },
    { canvas: [{ type: "rect", x: 0, y: 0, w: 80, h: 3, color: ORANGE }], margin: [0, 2, 0, 6] },
    {
      text: [
        clientInfo.name || "Organization",
        clientInfo.department ? `  ·  ${clientInfo.department}` : "",
        clientInfo.date ? `  ·  ${clientInfo.date}` : "",
        clientInfo.facilitator ? `  ·  ${clientInfo.facilitator}` : "",
      ].join(""),
      style: "sub",
      margin: [0, 0, 0, 14],
    },
    {
      columns: [
        { width: "auto", stack: [
          { text: String(dash.overallScore || "—"), fontSize: 40, bold: true, color: ORANGE },
          { text: `Level ${dash.overallLevel} · ${LEVEL_NAMES[dash.overallLevel]}`, style: "sub" },
        ] },
        { width: "*", margin: [16, 6, 0, 0], stack: [
          { text: viability, bold: true, color: NAVY, fontSize: 12 },
          { text: `70-20-10 readiness ${dash.readiness}/5  (People & Process ${dash.ppAvg} · Tech & Data ${dash.tdAvg} · Algorithms ${dash.algoAvg})`, style: "sub", margin: [0, 3, 0, 0] },
          { text: `Strategic quadrant: ${dash.qName}  (technical ${dash.qX} · strategic ${dash.qY})`, style: "sub", margin: [0, 2, 0, 0] },
          ...(dash.highVariance && dash.bottleneckPillar ? [{ text: `High cross-pillar variance (${dash.stdDev}); bottleneck: ${dash.bottleneckPillar}`, style: "sub", color: "#B45309", margin: [0, 2, 0, 0] }] : []),
        ] },
      ],
      margin: [0, 0, 0, 14],
    },
    ...readoutBlocks,
    { text: "Pillar scores vs public benchmark", style: "h2" },
    { table: { headerRows: 1, widths: ["*", "auto", "auto", "auto", "auto"], body: pillarBody }, layout: "lightHorizontalLines", margin: [0, 4, 0, 6] },
    { text: BENCHMARK.method_note, style: "fine", margin: [0, 0, 0, 14] },
  ]

  if (dash.critical.length || dash.moderate.length) {
    content.push({ text: "Gaps to budget level 4", style: "h2" })
    if (dash.critical.length) content.push({ text: `Critical (gap ≥ 2): ${dash.critical.map((g) => `${g.name} (${g.score})`).join("; ")}`, style: "body", margin: [0, 2, 0, 4] })
    if (dash.moderate.length) content.push({ text: `Moderate: ${dash.moderate.slice(0, 10).map((g) => g.name).join("; ")}`, style: "body", margin: [0, 0, 0, 14] })
  }

  if (sprint.length) {
    content.push({ text: "30-day sprint — top priorities", style: "h2" })
    content.push({
      ol: sprint.map((it) => ({
        text: [
          { text: `${it.dimName} `, bold: true, color: NAVY },
          { text: `(${it.pillarName} · ${PHASE_NAMES[it.phase]} · PS ${it.priorityScore})\n`, color: MUTE, fontSize: 9 },
          { text: it.activity, color: SLATE },
        ],
        margin: [0, 0, 0, 4],
      })),
      margin: [0, 4, 0, 14],
    })
  }

  const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })

  const def = {
    pageMargins: [40, 64, 40, 52],
    content,
    // Running OpenTenant brand header + orange hairline on every page.
    header: () => ({
      margin: [40, 22, 40, 0],
      stack: [
        {
          columns: [
            { text: [{ text: "opentenant", bold: true, color: NAVY, fontSize: 13 }, { text: "/.", bold: true, color: ORANGE, fontSize: 13 }], width: "auto" },
            { text: "AI MATURITY ASSESSMENT", color: MUTE, fontSize: 8, characterSpacing: 1.5, alignment: "right", margin: [0, 3, 0, 0] },
          ],
        },
        { canvas: [{ type: "line", x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1, lineColor: "#E2E8F0" }] },
        { canvas: [{ type: "line", x1: 0, y1: 7, x2: 70, y2: 7, lineWidth: 2, lineColor: ORANGE }] },
      ],
    }),
    footer: (page: number, pages: number) => ({
      margin: [40, 0, 40, 0],
      columns: [
        { text: `Confidential  ·  Prepared by opentenant  ·  ${generated}`, color: MUTE, fontSize: 8 },
        { text: `Page ${page} of ${pages}`, alignment: "right", color: MUTE, fontSize: 8 },
      ],
    }),
    styles: {
      title: { fontSize: 22, bold: true, color: NAVY },
      sub: { fontSize: 10, color: MUTE },
      h2: { fontSize: 13, bold: true, color: NAVY, margin: [0, 6, 0, 0] },
      body: { fontSize: 10, color: SLATE },
      th: { fontSize: 9, bold: true, color: MUTE },
      fine: { fontSize: 8, color: MUTE, italics: true },
    },
    defaultStyle: { fontSize: 10, color: SLATE },
  }

  const name = `${stamp()}_Assessment_${(clientInfo.name || "assessment").replace(/\s+/g, "_")}_${ASSESSMENT_VERSION}_${getAssessmentRuntimeConfig().exportSuffix}.pdf`
  pdfMake.createPdf(def).download(name)
}
