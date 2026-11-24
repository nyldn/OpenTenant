"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  AccessDenied, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle,
  EmptyState, FormField, FormStatus, Input,
} from "@opentenant/design-system";

/** The host supplies a short-lived, read-only context after live authorization.
 * Modules never receive the host's signing private key. */
export type BrainBrowserAvailability =
  | { state: "unavailable" | "api-only" | "denied" }
  | { state: "local" | "configured"; contextToken: string };

export interface BrainSearchResult {
  id: string;
  content: string;
}

export interface BrainSurfaceProps {
  availability?: BrainBrowserAvailability;
  apiPath?: string;
}

/** Decode only the search fields this page displays. Tenant text stays plain text. */
export function brainSearchResults(body: unknown): BrainSearchResult[] {
  const envelope = body as { resultType?: unknown; content?: { type?: unknown; text?: unknown }[] } | null;
  if (envelope?.resultType !== "complete" || !Array.isArray(envelope.content)) throw new Error("Invalid Brain response");
  const block = envelope.content.find(item => item.type === "text" && typeof item.text === "string");
  if (!block || typeof block.text !== "string") throw new Error("Invalid Brain response");
  const rows: unknown = JSON.parse(block.text);
  if (!Array.isArray(rows) || rows.length > 50) throw new Error("Invalid Brain response");
  return rows.map(row => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || typeof row.content !== "string") throw new Error("Invalid Brain response");
    return { id: row.id, content: row.content.slice(0, 8000) };
  });
}

function BrainSearch({ availability, apiPath }: { availability: Extract<BrainBrowserAvailability, { contextToken: string }>; apiPath: string }) {
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [results, setResults] = useState<BrainSearchResult[] | null>(null);
  const [outcome, setOutcome] = useState<{ status: "success" | "error"; message: string } | null>(null);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const query = String(new FormData(event.currentTarget).get("query") ?? "").trim();
    if (!query || query.length > 4000) {
      setOutcome({ status: "error", message: "Enter a search query of up to 4,000 characters." });
      return;
    }
    submitting.current = true;
    setPending(true);
    setOutcome(null);
    setResults(null);
    try {
      const response = await fetch(apiPath, {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-opentenant-module-context": availability.contextToken },
        body: JSON.stringify({ method: "tools/call", params: { name: "search", arguments: { query, limit: 10 } } }),
      });
      if (response.status === 403) { setDenied(true); return; }
      if (response.status === 401) {
        setOutcome({ status: "error", message: "Your Brain authorization expired. Reload this page to continue." });
        return;
      }
      if (!response.ok) throw new Error("Brain unavailable");
      const rows = brainSearchResults(await response.json());
      setResults(rows);
      setOutcome({ status: "success", message: `${rows.length} search ${rows.length === 1 ? "result" : "results"}.` });
    } catch {
      setOutcome({ status: "error", message: "Brain search could not complete. Please try again." });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (denied) return <BrainDenied />;

  return <section className="min-w-0 space-y-6 break-words">
    <h1 className="font-display text-2xl font-bold">Brain</h1>
    <p className="text-sm text-muted-foreground">{availability.state === "local"
      ? "Local deterministic search uses token hashing. It does not provide hosted semantic search. Results include only this tenant's available signals."
      : "Brain search is configured by your tenant administrator. Results include only this tenant's available signals."}</p>
    <form onSubmit={search} className="min-w-0 space-y-4" aria-busy={pending}>
      <FormField name="query" label="Search Brain" help="Search signal content in this tenant. Up to 4,000 characters." pending={pending}>
        {control => <Input {...control} type="search" required maxLength={4000} autoComplete="off" className="w-full min-w-0" />}
      </FormField>
      <Button type="submit" disabled={pending}>{pending ? "Searching…" : "Search"}</Button>
      {pending ? <p role="status">Searching Brain…</p> : null}
      {outcome ? <FormStatus status={outcome.status}>{outcome.message}</FormStatus> : null}
    </form>
    <BrainResults results={results} />
  </section>;
}

function BrainResults({ results }: { results: BrainSearchResult[] | null }) {
  return results === null ? <Empty>

      <EmptyHeader><EmptyTitle><h2>Search your tenant's signals</h2></EmptyTitle>
        <EmptyDescription>Enter a query to find available signal content.</EmptyDescription></EmptyHeader>
    </Empty> : results.length === 0 ? <Empty>
      <EmptyHeader><EmptyTitle><h2>No matching signals</h2></EmptyTitle>
        <EmptyDescription>No available content matched this query. Try another search.</EmptyDescription></EmptyHeader>
    </Empty> : <section aria-labelledby="brain-results" className="min-w-0 space-y-3">
      <h2 id="brain-results" className="text-lg font-semibold">Search results</h2>
      <ul className="min-w-0 space-y-3">{results.map((result, index) => <li key={`${result.id}-${index}`}
        className="min-w-0 whitespace-pre-wrap break-words rounded-lg border border-border bg-card p-4 text-card-foreground [overflow-wrap:anywhere]">{result.content}</li>)}</ul>
    </section>;
}

function BrainDenied() {
  return <AccessDenied state="forbidden"
    description="Your account does not have permission to use Brain in this tenant."
    action={{ label: "Go to Home", href: "/" }} />;
}

function BrainContent({ availability, apiPath }: { availability: BrainBrowserAvailability; apiPath: string | undefined }) {
  if (availability.state === "denied") return <BrainDenied />;
  if ("contextToken" in availability && apiPath) return <BrainSearch availability={availability} apiPath={apiPath} />;
  return <EmptyState state="unavailable" heading="Brain browser tools unavailable"
    description={availability.state === "api-only"
      ? "Brain is available through the tenant-authorized API only. Browser authorization and search are not configured. Local deterministic token hashing is not hosted semantic search."
      : "Brain browser authorization and search are not configured. Ask your tenant administrator about availability. Local deterministic token hashing is not hosted semantic search."}
    action={{ label: "Go to Home", href: "/" }} />;
}

export function BrainSurface({ availability = { state: "unavailable" }, apiPath }: BrainSurfaceProps = {}) {
  return <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-8 sm:px-6">
    <BrainContent availability={availability} apiPath={apiPath} />
  </main>;
}
