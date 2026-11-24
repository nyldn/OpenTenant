"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, Pencil, Users, X } from "lucide-react"
import {
  Badge,
  DestructiveConfirmationDialog,
  Button,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  Pagination,
  PaginationContent,
  PaginationItem,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@opentenant/design-system"
import { LEVEL_COLORS, levelText } from "./constants"
import { PILLARS } from "./data/pillars"
import { scoreKey, totalDims } from "./engine"
import { Eyebrow, Panel } from "./assessment-primitives"
import { AssessmentTable } from "./assessment-table"
import { useAssessment } from "./store"
import type { Respondent } from "./types"

const ROSTER_PAGE_SIZE = 25
const MATRIX_PAGE_SIZE = 8

function Chip({ value }: { value: number }) {
  if (!value) return <span className="text-muted-foreground">n/a</span>
  const lvl = Math.round(value)
  return <span className="inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-[11px] font-bold" style={{ background: LEVEL_COLORS[lvl], color: levelText(value) }}>{value}</span>
}

function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / pageSize))
}

function clampPage(page: number, total: number, pageSize: number) {
  return Math.min(Math.max(page, 0), pageCount(total, pageSize) - 1)
}

function pageSlice<T>(items: T[], page: number, pageSize: number) {
  const start = page * pageSize
  return { start, end: Math.min(items.length, start + pageSize), items: items.slice(start, start + pageSize) }
}

function PaginationControls({
  page,
  total,
  pageSize,
  noun,
  onPageChange,
}: {
  page: number
  total: number
  pageSize: number
  noun: string
  onPageChange: (page: number) => void
}) {
  const pages = pageCount(total, pageSize)
  const start = total ? page * pageSize + 1 : 0
  const end = total ? Math.min(total, (page + 1) * pageSize) : 0
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
      <span className="tabular-nums">{start}-{end} of {total} {noun}</span>
      <span className="tabular-nums">Page {page + 1} of {pages}</span>
      <Pagination className="mx-0 w-auto justify-start">
        <PaginationContent>
          <PaginationItem>
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPageChange(0)}>First</Button>
          </PaginationItem>
          <PaginationItem>
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => onPageChange(page - 1)}><ChevronLeft data-icon="inline-start" /> Prev</Button>
          </PaginationItem>
          <PaginationItem>
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => onPageChange(page + 1)}>Next <ChevronRight data-icon="inline-end" /></Button>
          </PaginationItem>
          <PaginationItem>
            <Button size="sm" variant="outline" disabled={page >= pages - 1} onClick={() => onPageChange(pages - 1)}>Last</Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}

export function ResponsesScreen({ onEdit }: { onEdit: (id: string) => void }) {
  const { respondents, removeRespondent, clearRespondents } = useAssessment()
  const [rosterPage, setRosterPage] = useState(0)
  const [matrixPage, setMatrixPage] = useState(0)
  const total = totalDims()
  const safeRosterPage = clampPage(rosterPage, respondents.length, ROSTER_PAGE_SIZE)
  const safeMatrixPage = clampPage(matrixPage, respondents.length, MATRIX_PAGE_SIZE)
  const roster = pageSlice(respondents, safeRosterPage, ROSTER_PAGE_SIZE)
  const matrix = pageSlice(respondents, safeMatrixPage, MATRIX_PAGE_SIZE)
  const dimensionRows = useMemo(() => PILLARS.flatMap((p) => p.dimensions.map((d) => ({ pillar: p.name, dim: d, id: scoreKey(p.key, d.key) }))), [])
  const fmtTime = (iso: string) => { try { return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) } catch { return "n/a" } }
  const done = (r: Pick<Respondent, "scores">) => Object.values(r.scores).filter((v) => v > 0).length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black">Responses</h2>
          <p className="mt-0.5 text-[14px] text-muted-foreground">{respondents.length} saved response(s). Results use the per-dimension mean across all saved responses.</p>
        </div>
        {respondents.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{pageCount(respondents.length, ROSTER_PAGE_SIZE)} roster page(s)</Badge>
            <Badge variant="outline">{pageCount(respondents.length, MATRIX_PAGE_SIZE)} matrix page(s)</Badge>
          </div>
        )}
      </div>
      {respondents.length === 0 ? (
        <Panel>
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon"><Users /></EmptyMedia>
              <EmptyTitle>No responses saved yet</EmptyTitle>
              <EmptyDescription>Score dimensions, then use “Save response” in the Session panel.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </Panel>
      ) : (
        <Tabs defaultValue="roster">
          <TabsList variant="line" aria-label="Response views" className="mb-3">
            <TabsTrigger value="roster">Respondent roster</TabsTrigger>
            <TabsTrigger value="matrix">Score matrix</TabsTrigger>
          </TabsList>
          <TabsContent value="roster">
            <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Eyebrow>Respondent roster</Eyebrow>
                <p className="mt-1 text-[12px] text-muted-foreground">Manage saved responses without rendering the full roster at once.</p>
              </div>
              <DestructiveConfirmationDialog
                trigger={<Button size="sm" variant="outline">Clear all responses</Button>}
                title="Clear all saved responses?"
                description={`Clear all ${respondents.length} saved responses? This cannot be undone.`}
                confirmLabel="Clear responses"
                onConfirm={clearRespondents}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <PaginationControls page={safeRosterPage} total={respondents.length} pageSize={ROSTER_PAGE_SIZE} noun="responses" onPageChange={setRosterPage} />
            </div>
            <div className="mt-3 rounded-lg ring-1 ring-white/[0.06]">
              <AssessmentTable label="Respondent roster" className="text-[12px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-muted/50">
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">#</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Name</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Role</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Client</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Department</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Submitted</TableHead>
                    <TableHead className="px-3 py-2 font-semibold text-muted-foreground">Dimensions</TableHead>
                    <TableHead className="px-3 py-2 text-right font-semibold text-muted-foreground">Manage</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roster.items.map((r, i) => (
                    <TableRow key={r.id} className="border-white/[0.06]">
                      <TableCell className="px-3 py-2 text-muted-foreground">{roster.start + i + 1}</TableCell>
                      <TableCell className="px-3 py-2 font-semibold">{r.name}</TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">{r.role || "n/a"}</TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">{r.company || "Legacy response"}</TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">{r.department || "Not recorded"}</TableCell>
                      <TableCell className="px-3 py-2 text-muted-foreground">{fmtTime(r.timestamp)}</TableCell>
                      <TableCell className="px-3 py-2 tabular-nums">{done(r)}/{total}</TableCell>
                      <TableCell className="px-3 py-2">
                        <div className="flex justify-end gap-3">
                          <button type="button" onClick={() => onEdit(r.id)} className="inline-flex items-center gap-1 text-[11px] text-accent-text hover:underline"><Pencil className="h-3 w-3" /> Edit / overwrite</button>
                          <button type="button" onClick={() => removeRespondent(r.id)} aria-label={`Remove ${r.name}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-danger-text"><X className="h-3 w-3" /> Remove</button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </AssessmentTable>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Edit loads the response and its client and department context into the session.</p>
            </Panel>
          </TabsContent>
          <TabsContent value="matrix">
            <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Eyebrow>Dimension score matrix</Eyebrow>
                <p className="mt-1 text-[12px] text-muted-foreground">Compare {MATRIX_PAGE_SIZE} response columns at a time. Scroll sideways if the viewport hides columns. The mean column uses all saved responses.</p>
              </div>
              <PaginationControls page={safeMatrixPage} total={respondents.length} pageSize={MATRIX_PAGE_SIZE} noun="responses" onPageChange={setMatrixPage} />
            </div>
            <div className="mt-3 rounded-lg ring-1 ring-white/[0.06]">
              <AssessmentTable label="Dimension score matrix" className="min-w-[720px] text-[12px]">
                <TableHeader>
                  <TableRow className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground hover:bg-muted/50">
                    <TableHead className="sticky left-0 z-10 bg-muted px-3 py-2 text-left font-semibold text-muted-foreground">Dimension</TableHead>
                    {matrix.items.map((r, i) => (
                      <TableHead key={r.id} className="min-w-20 px-2 py-2 text-center font-semibold text-muted-foreground">
                        <span className="block text-[10px] font-semibold text-muted-foreground">#{matrix.start + i + 1}</span>
                        <span className="mx-auto block max-w-20 truncate" title={[r.name, r.role, r.department].filter(Boolean).join(", ")}>{r.name}</span>
                      </TableHead>
                    ))}
                    <TableHead className="px-2 py-2 text-center font-semibold text-accent-text">Mean</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dimensionRows.map(({ pillar, dim, id }) => {
                    const vals = respondents.map((r) => r.scores[id]).filter((v): v is number => !!v)
                    const mean = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : 0
                    return (
                      <TableRow key={id} className="border-white/[0.06]">
                        <TableCell className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left">
                          <span className="block font-semibold">{dim.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{pillar}</span>
                        </TableCell>
                        {matrix.items.map((r) => <TableCell key={r.id} className="px-2 py-1.5 text-center"><Chip value={r.scores[id] || 0} /></TableCell>)}
                        <TableCell className="px-2 py-1.5 text-center"><Chip value={mean} /></TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </AssessmentTable>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">Showing matrix columns {matrix.start + 1}-{matrix.end} of {respondents.length}; export keeps the full response set.</p>
            </Panel>
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
