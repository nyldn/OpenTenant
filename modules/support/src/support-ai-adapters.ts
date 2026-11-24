import type {
  AdapterSuggestion,
  KnowledgeArticle,
  SuggestionAdapter,
  SupportAiEvidence,
  SupportAiInferenceEvidence,
} from "./support-ai-types";

export class InMemorySupportAiStore {
  readonly articles: KnowledgeArticle[] = [];
  readonly inferences: SupportAiInferenceEvidence[] = [];
  readonly evidence: SupportAiEvidence[] = [];
  disabledTenants = new Set<string>();
  exhaustedBudgetTenants = new Set<string>();
  private sequence = 0;

  nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(6, "0")}`;
  }
}

export class SyntheticSuggestionAdapter implements SuggestionAdapter {
  next: AdapterSuggestion = { kind: "abstain", reason: "insufficient_information" };
  throwNext: Error | null = null;
  readonly calls: Array<Parameters<SuggestionAdapter["suggest"]>[0]> = [];

  async suggest(input: Parameters<SuggestionAdapter["suggest"]>[0]): Promise<AdapterSuggestion> {
    this.calls.push(input);
    if (this.throwNext) {
      const error = this.throwNext;
      this.throwNext = null;
      throw error;
    }
    return this.next;
  }
}
