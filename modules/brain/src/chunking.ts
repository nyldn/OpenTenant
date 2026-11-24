export interface ChunkingProfile {
  minTokens: number;
  maxTokens: number;
}

export const BRAIN_CHUNKING_PROFILES = {
  slack: { minTokens: 200, maxTokens: 500 },
  transcript: { minTokens: 300, maxTokens: 600 },
  doc_email: { minTokens: 600, maxTokens: 1200 },
} satisfies Record<string, ChunkingProfile>;

export type ChunkingProfileName = keyof typeof BRAIN_CHUNKING_PROFILES;
