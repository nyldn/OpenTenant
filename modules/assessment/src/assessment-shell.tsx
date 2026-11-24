"use client"

import { dispatchBrowserEvent } from "@opentenant/platform-core/runtime-globals"

import { useMemo, useRef, useState, type ChangeEvent } from "react"
import { Check, FlaskConical, LogOut, Pencil, RotateCcw, Users, X } from "lucide-react"
import { toast } from "sonner"
import {
  Badge,
  Button,
  DestructiveConfirmationDialog,
  Input,
  FormField,
  FormStatus,
  Progress,
  Toaster,
} from "@opentenant/design-system"
import { OPERATING_PROFILES } from "./data/operatingProfiles"
import { totalDims } from "./engine"
import { Panel, Eyebrow, OpenTenantLogo } from "./assessment-primitives"
import { PillarRail, QuestionnaireScreen, RESPONSES, RESULTS } from "./assessment-questionnaire"
import { ResponsesScreen } from "./assessment-responses"
import { ResultsScreen } from "./assessment-results"
import { createRespondentEdit } from "./respondents"
import { ASSESSMENT_SIGN_OUT_EVENT, ASSESSMENT_VERSION } from "./runtime"
import { assessmentEngagementExportName, downloadText } from "./assessment-exports"
import { assessmentSaveStatusLabel, useAssessment } from "./store"

const SESSION_RESPONSE_PREVIEW_LIMIT = 8

export function AssessmentShell() {
  const { engagementId, startNewEngagement, addRespondent, scores, currentPillar, setCurrentPillar, respondents, saveRespondent, editingRespondentId, beginRespondentEdit, cancelRespondentEdit, removeRespondent, clientInfo, setClientField, demoMode, setDemoMode, resetSession, exportEngagement, exportLegacyRawKey, restoreEngagement, repositoryStatus, legacyClaimSource, operationFeedback, claimLegacy, resumeLegacyClaim, restoreBackup, hydrated, saveStatus, retrySave } = useAssessment()
  const importRef = useRef<HTMLInputElement>(null)
  const [respName, setRespName] = useState("")
  const [respRole, setRespRole] = useState("")

  const scoredCount = Object.values(scores).filter((s) => s > 0).length
  const total = totalDims()
  const completion = Math.round((scoredCount / total) * 100)
  const atResponses = currentPillar === RESPONSES
  const atResults = currentPillar === RESULTS
  const pendingRecoveryLabel = legacyClaimSource === "engagement_v1" ? "engagement backup" : "saved session"
  const sessionPreviewRespondents = useMemo(
    () => [...respondents].sort((a, b) => b.timestamp.localeCompare(a.timestamp)).slice(0, SESSION_RESPONSE_PREVIEW_LIMIT),
    [respondents],
  )

  const signOut = () => dispatchBrowserEvent(new CustomEvent(ASSESSMENT_SIGN_OUT_EVENT))
  const exitDemo = () => {
    setDemoMode(false)
    setRespName("")
    setRespRole("")
  }
  const enterDemo = () => {
    setDemoMode(true)
    setRespName("")
    setRespRole("")
  }
  const downloadEngagement = async () => {
    if (demoMode) return
    const content = await exportEngagement()
    if (content) downloadText(assessmentEngagementExportName(clientInfo.name), content, "application/json")
  }
  const importEngagement = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file || demoMode) return
    const result = await restoreEngagement(await file.text())
    if (!result.ok) toast.error("That engagement backup could not be restored.")
  }
  const downloadLegacyRaw = async (key: "assessment_session_v26" | "assessment_respondents_v26" | "assessment_engagement_v1") => {
    if (demoMode) return
    const content = await exportLegacyRawKey(key)
    if (content) downloadText(`${key}_recovery.json`, content, "application/json")
  }
  const newAssessment = async () => {
    if (demoMode) { exitDemo(); return }
    const result = await startNewEngagement()
    if (!result.ok) throw new Error("Engagement replacement failed")
    setRespName(""); setRespRole("")
  }
  const saveResponse = () => {
    if (!respName.trim()) return
    saveRespondent(respName, respRole)
    toast.success(`Response saved for ${respName.trim()}`)
    setRespName(""); setRespRole("")
  }
  const cancelEdit = () => {
    cancelRespondentEdit()
    setRespName("")
    setRespRole("")
  }
  const openRespondentEditor = (id: string) => {
    const r = respondents.find((x) => x.id === id)
    if (!r) return
    beginRespondentEdit(createRespondentEdit(r))
    setRespName(r.name); setRespRole(r.role)
    setCurrentPillar(0)
    toast(`Loaded ${r.name}, edit and save to update this response`)
  }
  if (!hydrated) return <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground" role="status">Loading saved assessment…</div>

  return (
    <div className="assessment-root min-h-svh bg-background text-foreground">
      {/* top-of-page demo strip (dark OpenTenant orange) */}
      {demoMode && (
        <div className="flex flex-wrap items-center justify-center gap-2 px-3 py-2 text-[13px] font-semibold bg-info text-info-foreground">
          <FlaskConical className="h-3.5 w-3.5" /> Demo mode is on. Sample data is active, nothing is saved.
          <Button size="xs" variant="outline" className="ml-1" onClick={exitDemo}>Exit demo</Button>
        </div>
      )}
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex items-center gap-3">
            <OpenTenantLogo />
            <Badge className="hidden border-0 bg-primary/15 text-accent-text sm:inline-flex">AI Maturity Assessment</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={atResponses ? "default" : "outline"} onClick={() => setCurrentPillar(RESPONSES)}>
              <Users data-icon="inline-start" /> Responses
              {respondents.length > 0 && <span className="ml-1 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">{respondents.length}</span>}
            </Button>
            <Button size="sm" variant="ghost" onClick={signOut} aria-label="Sign out"><LogOut /></Button>
          </div>
          <div className="order-3 w-full sm:order-none sm:w-44">
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>Completion</span>
              <span className="tabular-nums">{scoredCount}/{total} · {completion}%</span>
            </div>
            <Progress
              value={completion}
              aria-label="Assessment completion"
              aria-valuetext={`${scoredCount} of ${total} dimensions scored`}
              className="h-1.5 bg-muted"
            />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-6xl px-3 pb-16 pt-5 sm:px-5">
        {/* slim hero */}
        <div className="mb-4">
          <h1 className="font-display text-2xl font-black tracking-tight">AI Maturity Assessment</h1>
          <p className="text-[14px] text-muted-foreground">Scored baseline of organizational AI readiness across 5 weighted pillars and 25 dimensions, benchmarked against public data.</p>
        </div>

        {/* session */}
        <Panel>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>Session</Eyebrow>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant={demoMode ? "default" : "outline"} onClick={() => (demoMode ? exitDemo() : enterDemo())}><FlaskConical data-icon="inline-start" /> {demoMode ? "Exit demo" : "Demo data"}</Button>
              <DestructiveConfirmationDialog
                trigger={<Button size="sm" variant="ghost" disabled={demoMode || !["empty", "ready"].includes(repositoryStatus)}><RotateCcw data-icon="inline-start" /> New engagement</Button>}
                title="Start a new engagement?"
                description="The current engagement, including its scores and respondents, will be backed up and replaced with an empty engagement. You can restore it using Restore verified backup. No respondents or scores will carry over."
                confirmLabel="Start new engagement"
                onConfirm={newAssessment}
              />
              <Button size="sm" variant="ghost" onClick={() => { resetSession(); setRespName(""); setRespRole("") }}>Clear draft</Button>
              <Button size="sm" variant="outline" disabled={demoMode || !hydrated} onClick={() => void downloadEngagement()}>Download engagement backup</Button>
              <Button size="sm" variant="outline" disabled={demoMode || !hydrated || repositoryStatus === "legacy_claim_pending"} onClick={() => importRef.current?.click()}>Restore engagement backup</Button>
              <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importEngagement(event)} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <FormField name="client" label="Client / organization">{control => <Input {...control} value={clientInfo.name} onChange={(e) => setClientField("name", e.target.value)} />}</FormField>
            <FormField name="department" label="Department">{control => <Input {...control} value={clientInfo.department} onChange={(e) => setClientField("department", e.target.value)} />}</FormField>
            <FormField name="operatingProfile" label="Operating profile">{control => <select
              {...control}
              value={clientInfo.operatingProfile}
              onChange={(e) => setClientField("operatingProfile", e.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <option value="">Select operating profile</option>
              {OPERATING_PROFILES.map((profile) => <option key={profile.value} value={profile.value}>{profile.label}</option>)}
            </select>}</FormField>
            <FormField name="date" label="Assessment date">{control => <Input {...control} type="date" value={clientInfo.date} onChange={(e) => setClientField("date", e.target.value)} />}</FormField>
            <FormField name="facilitator" label="Facilitator">{control => <Input {...control} value={clientInfo.facilitator} onChange={(e) => setClientField("facilitator", e.target.value)} />}</FormField>
          </div>
          <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
            <FormField name="respondent" label="Respondent name" help="The same client, department, and name updates that response.">{control => <Input {...control} value={respName} onChange={(e) => setRespName(e.target.value)} />}</FormField>
            <FormField name="role" label="Role" help="Optional. Record the respondent's role in the organization.">{control => <Input {...control} value={respRole} onChange={(e) => setRespRole(e.target.value)} />}</FormField>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button size="sm" onClick={saveResponse} disabled={!respName.trim()}><Check data-icon="inline-start" /> {editingRespondentId ? "Save edit" : "Save response"}</Button>
              <Button size="sm" variant="outline" onClick={() => { addRespondent(); setRespName(""); setRespRole("") }}>Add respondent</Button>
              {editingRespondentId && <Button size="sm" variant="ghost" onClick={cancelEdit}>Cancel edit</Button>}
            </div>
          </div>
          {/* submitted responses */}
          {respondents.length > 0 && (
            <div className="mt-3 border-t border-white/[0.06] pt-3">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12px] font-semibold text-muted-foreground">Recent responses ({sessionPreviewRespondents.length} of {respondents.length})</p>
                {respondents.length > sessionPreviewRespondents.length && (
                  <Button size="sm" variant="ghost" onClick={() => setCurrentPillar(RESPONSES)}>View all</Button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sessionPreviewRespondents.map((r) => (
                  <span key={r.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-background/60 px-2 py-1 text-[13px] ring-1 ring-white/[0.06]">
                    <span className="max-w-40 truncate font-semibold">{r.name}</span>{r.role && <span className="max-w-32 truncate text-muted-foreground">· {r.role}</span>}{r.department && <span className="max-w-36 truncate text-muted-foreground">· {r.department}</span>}
                    <button type="button" onClick={() => openRespondentEditor(r.id)} aria-label={`Edit ${r.name}`} className="text-accent-text hover:opacity-80"><Pencil className="h-3 w-3" /></button>
                    <button type="button" onClick={() => removeRespondent(r.id)} aria-label={`Remove ${r.name}`} className="text-muted-foreground hover:text-danger-text"><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">{demoMode ? <span>Demo data, exploratory, nothing is saved.</span> : saveStatus === "unsaved" ? <><FormStatus status="error">{assessmentSaveStatusLabel(saveStatus)}</FormStatus><Button size="xs" variant="outline" onClick={() => void retrySave()}>Retry save</Button></> : saveStatus === "saved" ? <FormStatus status="success">{assessmentSaveStatusLabel(saveStatus)}</FormStatus> : <span role="status">{assessmentSaveStatusLabel(saveStatus)}</span>}</div>
          {operationFeedback && !demoMode && <FormStatus status="error">{operationFeedback}</FormStatus>}
          {repositoryStatus === "legacy_available" && !demoMode && <div className="mt-3 rounded-md border border-amber-400/40 p-3 text-[13px] text-warning-text"><p>Legacy Assessment data is available in this browser. Choose a source to claim for this tenant before it can be restored.</p><div className="mt-2 flex gap-2"><Button size="sm" onClick={() => void claimLegacy("v26")}>Claim saved session</Button><Button size="sm" variant="outline" onClick={() => void claimLegacy("engagement_v1")}>Claim engagement backup</Button></div></div>}
          {repositoryStatus === "legacy_claim_pending" && !demoMode && <div className="mt-3 rounded-md border border-amber-400/40 p-3 text-[13px] text-warning-text"><p>Legacy recovery for the {pendingRecoveryLabel} is pending. Resume to complete the verified recovery.</p><Button className="mt-2" size="sm" onClick={() => void resumeLegacyClaim()}>Resume recovery</Button></div>}
          {repositoryStatus === "legacy_claimed_elsewhere" && !demoMode && <div className="mt-3 rounded-md border border-amber-400/40 p-3 text-[13px] text-warning-text">Legacy recovery is already assigned to another tenant and is not available here.</div>}
          {!demoMode && (repositoryStatus === "invalid" || repositoryStatus === "ready") && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">{repositoryStatus === "invalid" && <span>Saved Assessment data needs recovery.</span>}<Button size="sm" variant="outline" onClick={() => void restoreBackup()}>Restore verified backup</Button></div>}
          {!demoMode && <details className="mt-3 text-sm">
            <summary className="min-h-11 cursor-pointer py-3 text-primary-text">Advanced recovery</summary>
            <p className="text-muted-foreground">Restore a verified browser backup or download original legacy material when available.</p>
            {(repositoryStatus === "ready" || repositoryStatus === "legacy_claim_pending") && <div className="mt-2 flex flex-wrap items-center gap-2 text-muted-foreground"><span>Original legacy recovery:</span><Button size="xs" variant="ghost" onClick={() => void downloadLegacyRaw("assessment_session_v26")}>Session</Button><Button size="xs" variant="ghost" onClick={() => void downloadLegacyRaw("assessment_respondents_v26")}>Respondents</Button><Button size="xs" variant="ghost" onClick={() => void downloadLegacyRaw("assessment_engagement_v1")}>Engagement v1</Button></div>}
            <p className="mt-2 text-muted-foreground">Assessment version {ASSESSMENT_VERSION}</p>
          </details>}

        </Panel>

        {/* two-pane working area */}
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <aside className="min-w-0 lg:sticky lg:top-[76px] lg:self-start"><PillarRail /></aside>
          <div className="min-w-0">
            {atResults ? (
              <ResultsScreen key={engagementId} onBack={() => setCurrentPillar(RESPONSES)} />
            ) : atResponses ? (
              <ResponsesScreen onEdit={openRespondentEditor} />
            ) : (
              <QuestionnaireScreen />
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-4 text-center text-[12px] text-muted-foreground">AI Maturity Assessment</footer>
      <Toaster position="bottom-center" />
    </div>
  )
}
