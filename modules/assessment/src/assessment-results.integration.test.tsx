import React, { StrictMode, type MutableRefObject } from "react"
import { act, create, type ReactTestRenderer, type ReactTestInstance } from "react-test-renderer"
import { describe, expect, it, vi } from "vitest"

const pdfMock = vi.hoisted(() => ({ downloadAssessmentPdf: vi.fn() }))
vi.mock("./pdf", () => pdfMock)

vi.mock("@opentenant/design-system", () => {
  const Primitive = ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => React.createElement("div", props, children)
  return {
    Badge: Primitive,
    Button: Primitive,
    DropdownMenu: Primitive,
    DropdownMenuContent: Primitive,
    DropdownMenuItem: Primitive,
    DropdownMenuTrigger: Primitive,
    Empty: Primitive,
    EmptyContent: Primitive,
    EmptyDescription: Primitive,
    EmptyHeader: Primitive,
    EmptyMedia: Primitive,
    EmptyTitle: Primitive,
    Table: Primitive,
    TableBody: Primitive,
    TableCell: Primitive,
    TableHead: Primitive,
    TableHeader: Primitive,
    TableRow: Primitive,
    cn: (...classes: unknown[]) => classes.filter(Boolean).join(" "),
  }
})
import { ResultsScreen } from "./assessment-results"
import { AssessmentProvider, readoutInputDigest, useAssessment, type AssessmentSession } from "./store"
import type { AssessmentRepository } from "./persistence/assessment-repository"
import { engagementFromSession, type EngagementDocument, type EngagementReadout } from "./persistence/engagement-schema"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type AssessmentValue = ReturnType<typeof useAssessment>
type RepositoryCalls = { imports: number; claims: number }
const session: AssessmentSession = { clientInfo: { name: "Synthetic Organisation", department: "Ops", operatingProfile: "", date: "", facilitator: "Facilitator" }, scores: { "strategy__ai_vision": 3 }, evidence: {}, currentPillar: 0 }
function Capture({ current }: { current: MutableRefObject<AssessmentValue | undefined> }) { current.current = useAssessment(); return null }
function baseDocument(readout: EngagementReadout | null = null): EngagementDocument { return engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session, respondents: [], engagementId: "eng_1", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z", readout }) }
function repository(document: EngagementDocument, save: (next: EngagementDocument) => void = () => undefined, calls?: RepositoryCalls): AssessmentRepository {
  return { load: async () => ({ status: "ready", document }), save: async (next) => { save(next); return { ok: true, document: next } }, exportJson: async () => null, exportEngagement: async () => null, exportLegacyRaw: async () => null, exportLegacyRawKey: async () => null, importJson: async () => { if (calls) calls.imports += 1; return { ok: true, document } }, startNewEngagement: async (_previous, next) => ({ ok: true, document: next }), restoreBackup: async () => ({ ok: true, document }), clear: async () => ({ ok: true }), claimLegacy: async () => { if (calls) calls.claims += 1; return { ok: false, code: "invalid", errors: ["synthetic"] } } }
}
async function settle() { await act(async () => { await Promise.resolve(); await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }) }
async function waitUntil(predicate: () => boolean, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 2)) })
  }
  throw new Error(message)
}
function text(node: ReactTestInstance): string { return node.children.map((child) => typeof child === "string" ? child : typeof child === "object" && child !== null && "children" in child ? text(child as ReactTestInstance) : "").join("") }
function regenerate(renderer: ReactTestRenderer): ReactTestInstance {
  const match = renderer.root.findAll((node) => typeof node.props?.onClick === "function" && text(node).includes("Regenerate"))[0]
  if (!match) throw new Error("Regenerate button not found")
  return match
}
async function mountResults(document: EngagementDocument, current: MutableRefObject<AssessmentValue | undefined>, save?: (next: EngagementDocument) => void): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  act(() => { renderer = create(<StrictMode><AssessmentProvider repository={repository(document, save)} tenantId="tenant-a"><Capture current={current} /><ResultsScreen onBack={() => undefined} /></AssessmentProvider></StrictMode>) })
  await settle()
  return renderer
}
function sse(textValue: string, status = 200) { return new Response(`data: ${JSON.stringify({ delta: textValue })}\n\ndata: {"done":true}\n\n`, { status, headers: { "Content-Type": "text/event-stream" } }) }

describe("mounted ResultsScreen persistence and lifecycle", () => {
  it("renders a restored current readout without a model call", async () => {
    const digest = await readoutInputDigest(session, [])
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const originalFetch = globalThis.fetch; let fetchCalls = 0
    globalThis.fetch = async () => { fetchCalls += 1; return sse("Unexpected") }
    try {
      const renderer = await mountResults(baseDocument({ text: "Restored current", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), current)
      expect(renderer.root.findAll((node) => text(node).includes("Restored current")).length).toBeGreaterThan(0)
      expect(fetchCalls).toBe(0)
      await waitUntil(
        () => renderer.root.findAll((node) => text(node).includes("This readout is stale")).length === 0,
        "restored readout never became current",
      )
      const pdfButton = renderer.root.findAll((node) => typeof node.props?.onClick === "function" && text(node).includes("Download PDF"))[0]
      await act(async () => { pdfButton.props.onClick(); await Promise.resolve() })
      expect(pdfMock.downloadAssessmentPdf).toHaveBeenCalledWith(expect.objectContaining({ name: session.clientInfo.name }), expect.anything(), expect.anything(), "Restored current")
      act(() => { renderer.unmount() })
    } finally { globalThis.fetch = originalFetch }
  })

  it("keeps progress-only changes current and includes current text in PDF", async () => {
    pdfMock.downloadAssessmentPdf.mockClear()
    const digest = await readoutInputDigest(session, [])
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const renderer = await mountResults(baseDocument({ text: "Current report", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), current)
    await act(async () => { current.current!.setCurrentPillar(4) }); await settle()
    expect(renderer.root.findAll((node) => text(node).includes("This readout is stale")).length).toBe(0)
    const pdfButton = renderer.root.findAll((node) => typeof node.props?.onClick === "function" && text(node).includes("Download PDF"))[0]
    await act(async () => { pdfButton.props.onClick(); await Promise.resolve() })
    expect(pdfMock.downloadAssessmentPdf).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), "Current report")
    act(() => { renderer.unmount() })
  })

  it.each([
    ["client name", (value: AssessmentValue) => value.setClientField("name", "Changed Organisation")],
    ["client department", (value: AssessmentValue) => value.setClientField("department", "Finance")],
    ["client operating profile", (value: AssessmentValue) => value.setClientField("operatingProfile", "carrier")],
    ["client date", (value: AssessmentValue) => value.setClientField("date", "2026-09-07")],
    ["client facilitator", (value: AssessmentValue) => value.setClientField("facilitator", "New Facilitator")],
    ["active score", (value: AssessmentValue) => value.setScore("strategy", "ai_vision", 5)],
    ["active evidence", (value: AssessmentValue) => value.setEvidence("strategy", "ai_vision", "New evidence")],
  ] as const)("marks %s edits stale and omits stale text from PDF", async (_label, mutate) => {
    pdfMock.downloadAssessmentPdf.mockClear()
    const digest = await readoutInputDigest(session, [])
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const renderer = await mountResults(baseDocument({ text: "Previous report", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), current)
    await act(async () => { mutate(current.current!) }); await settle()
    expect(renderer.root.findAll((node) => text(node).includes("This readout is stale")).length).toBeGreaterThan(0)
    const pdfButton = renderer.root.findAll((node) => typeof node.props?.onClick === "function" && text(node).includes("Download PDF"))[0]
    await act(async () => { pdfButton.props.onClick(); await Promise.resolve() })
    expect(pdfMock.downloadAssessmentPdf).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), expect.anything(), "")
    act(() => { renderer.unmount() })
  })

  it.each([
    ["name", null, "Blair", "Director"],
    ["role", null, "Alex", "VP"],
    ["company", (value: AssessmentValue) => value.setClientField("name", "Changed Company"), "Alex", "Director"],
    ["department", (value: AssessmentValue) => value.setClientField("department", "Finance"), "Alex", "Director"],
    ["operating profile", (value: AssessmentValue) => value.setClientField("operatingProfile", "carrier"), "Alex", "Director"],
    ["scores", (value: AssessmentValue) => value.setScore("strategy", "ai_vision", 5), "Alex", "Director"],
    ["evidence", (value: AssessmentValue) => value.setEvidence("strategy", "ai_vision", "Changed respondent evidence"), "Alex", "Director"],
  ] as const)("marks respondent %s changes stale", async (_label, prepare, name, role) => {
    const respondent = { id: "respondent-1", company: session.clientInfo.name, department: session.clientInfo.department, operatingProfile: session.clientInfo.operatingProfile, name: "Alex", role: "Director", timestamp: "2026-09-06T00:00:00.000Z", scores: { ...session.scores }, evidence: { ...session.evidence } }
    const source = engagementFromSession({ tenantId: "tenant-a", appVersion: "v1.0.0", session, respondents: [respondent], engagementId: "eng_1", createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z" })
    const digest = await readoutInputDigest(source.session, source.respondents)
    source.readout = { text: "Previous respondent report", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }
    const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
    const renderer = await mountResults(source, current)
    await act(async () => { current.current!.beginRespondentEdit(source.respondents[0]!) })
    if (prepare) { await act(async () => { prepare(current.current!) }); await settle() }
    await act(async () => { current.current!.saveRespondent(name, role) }); await settle()
    expect(renderer.root.findAll((node) => text(node).includes("This readout is stale")).length).toBeGreaterThan(0)
    expect(current.current?.readout?.text).toBe("Previous respondent report")
    act(() => { renderer.unmount() })
  })

  it("runs exactly one stream and one repository save for one Strict Mode regenerate click", async () => {
    let fetchCalls = 0; let saveCalls = 0; const originalFetch = globalThis.fetch
    globalThis.fetch = async () => { fetchCalls += 1; return sse("Generated once") }
    try {
      const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
      const renderer = await mountResults(baseDocument(), current, () => { saveCalls += 1 })
      await act(async () => { await regenerate(renderer).props.onClick() })
      await settle()
      expect(fetchCalls).toBe(1)
      expect(saveCalls).toBe(1)
      expect(current.current?.readout?.text).toBe("Generated once")
      act(() => { renderer.unmount() })
    } finally { globalThis.fetch = originalFetch }
  })

  it("keeps the real readout when demo regeneration succeeds and demo exit restores it", async () => {
    let fetchCalls = 0; let saveCalls = 0; const originalFetch = globalThis.fetch
    const calls: RepositoryCalls = { imports: 0, claims: 0 }
    globalThis.fetch = async () => { fetchCalls += 1; return sse("Demo generated") }
    try {
      const digest = await readoutInputDigest(session, [])
      const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
      let renderer!: ReactTestRenderer
      act(() => { renderer = create(<StrictMode><AssessmentProvider repository={repository(baseDocument({ text: "Real readout", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), () => { saveCalls += 1 }, calls)} tenantId="tenant-a"><Capture current={current} /><ResultsScreen onBack={() => undefined} /></AssessmentProvider></StrictMode>) })
      await settle()
      await act(async () => { current.current!.setDemoMode(true) }); await settle()
      await act(async () => { await current.current!.restoreEngagement("demo-import"); await current.current!.claimLegacy("v26") })
      expect(calls.imports).toBe(0); expect(calls.claims).toBe(0)
      await act(async () => { await regenerate(renderer).props.onClick() }); await settle()
      expect(fetchCalls).toBe(1); expect(saveCalls).toBe(0); expect(current.current?.readout?.text).toBe("Demo generated")
      await act(async () => { current.current!.setDemoMode(false) }); await settle()
      expect(current.current?.readout?.text).toBe("Real readout")
      act(() => { renderer.unmount() })
    } finally { globalThis.fetch = originalFetch }
  })

  it.each([500, 200])("preserves the previous readout on failed or malformed stream (%s)", async (status) => {
    const digest = await readoutInputDigest(session, []); const previous = { text: "Previous", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }
    const originalFetch = globalThis.fetch; globalThis.fetch = async () => status === 500 ? sse("ignored", 500) : new Response("not sse", { status: 200 })
    try {
      const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }; const renderer = await mountResults(baseDocument(previous), current)
      await act(async () => { regenerate(renderer).props.onClick(); await Promise.resolve(); await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }); await settle()
      expect(current.current?.readout?.text).toBe("Previous")
      act(() => { renderer.unmount() })
    } finally { globalThis.fetch = originalFetch }
  })

  it("does not publish a stream that finishes after the assessment inputs change", async () => {
    let release!: (response: Response) => void
    let requestSignal: AbortSignal | null | undefined
    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => { requestSignal = init?.signal; return new Promise<Response>((resolve) => { release = resolve }) }
    try {
      const digest = await readoutInputDigest(session, [])
      const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
      const renderer = await mountResults(baseDocument({ text: "Previous", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), current)
      await act(async () => { regenerate(renderer).props.onClick(); await Promise.resolve() })
      await act(async () => { current.current!.setClientField("name", "Changed while streaming") })
      expect(requestSignal?.aborted).toBe(true)
      release(sse("Stale"))
      await settle()
      expect(current.current?.readout?.text).toBe("Previous")
      act(() => { renderer.unmount() })
    } finally { globalThis.fetch = originalFetch }
  })

  it("does not publish a stream that finishes after the mounted Results screen aborts", async () => {
    let release!: (response: Response) => void
    let saveCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = async () => new Promise<Response>((resolve) => { release = resolve })
    try {
      const digest = await readoutInputDigest(session, [])
      const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
      const renderer = await mountResults(baseDocument({ text: "Previous", generatedAt: "2026-09-06T00:00:00.000Z", inputDigest: digest }), current, () => { saveCalls += 1 })
      await act(async () => { regenerate(renderer).props.onClick(); await Promise.resolve() })
      act(() => { renderer.unmount() })
      release(sse("Aborted"))
      await settle()
      expect(saveCalls).toBe(0)
      expect(current.current?.readout?.text).toBe("Previous")
    } finally { globalThis.fetch = originalFetch }
  })
})

it("exports only B's document roster and score after replacing scored A", async () => {
  const exports = await import("./assessment-exports")
  const { PILLARS } = await import("./data/pillars")
  const csv = vi.spyOn(exports, "downloadAssessmentCsv").mockImplementation(() => undefined)
  const json = vi.spyOn(exports, "downloadAssessmentJson").mockImplementation(() => undefined)
  pdfMock.downloadAssessmentPdf.mockClear()
  const a = baseDocument({ text: "Client A readout", generatedAt: null, inputDigest: null })
  a.session.clientInfo.name = "Client A"
  a.respondents = [{ id: "a", company: "Client A", department: "Ops", operatingProfile: "", name: "Respondent A", role: "", timestamp: a.createdAt, scores: { "strategy__ai_vision": 3 }, evidence: {} }]
  const current: MutableRefObject<AssessmentValue | undefined> = { current: undefined }
  const renderer = await mountResults(a, current)
  try {
    await act(async () => { expect((await current.current!.startNewEngagement()).ok).toBe(true) })
    await act(async () => {
      current.current!.setClientField("name", "Client B")
      for (const pillar of PILLARS) for (const dimension of pillar.dimensions) current.current!.setScore(pillar.key, dimension.key, 4)
    })
    await act(async () => { current.current!.saveRespondent("Respondent B", "Director") })
    await settle()
    await act(async () => {
      renderer.root.findAll(node => typeof node.props.onSelect === "function" && text(node) === " Export CSV")[0]!.props.onSelect()
      renderer.root.findAll(node => typeof node.props.onSelect === "function" && text(node) === " Export report JSON")[0]!.props.onSelect()
      renderer.root.findAll(node => typeof node.props.onClick === "function" && text(node).includes("Download PDF"))[0]!.props.onClick()
    })
    expect(csv).toHaveBeenCalledWith("Client B", expect.any(Object), {})
    expect(Object.values(csv.mock.calls[0]![1])).toEqual(Array(25).fill(4))
    const [client, dashboard, priorities, respondents] = json.mock.calls[0]!
    expect(dashboard.overallScore).toBe(4)
    expect(respondents).toHaveLength(1)
    expect(respondents[0]!.name).toBe("Respondent B")
    expect(exports.buildAssessmentJson(client, dashboard, priorities, respondents)).not.toContain("Client A")
    expect(pdfMock.downloadAssessmentPdf).toHaveBeenCalledWith(client, dashboard, priorities, "")
    expect(JSON.stringify(pdfMock.downloadAssessmentPdf.mock.calls)).not.toContain("Client A")
  } finally { act(() => { renderer.unmount() }); csv.mockRestore(); json.mockRestore() }
})
