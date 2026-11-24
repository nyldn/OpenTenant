import type { TenantId } from "@opentenant/auth";

export const VOICE_PROFILE_MAX_LIST_ITEMS = 200;
export const VOICE_PROFILE_MAX_EXAMPLES = 20;
export const VOICE_PROFILE_MAX_WORD_LENGTH = 64;
export const VOICE_PROFILE_MAX_REWRITE_BEFORE_LENGTH = 1_000;
export const VOICE_PROFILE_MAX_REWRITE_AFTER_LENGTH = 1_000;

export const READING_LEVELS = ["general", "professional", "technical"] as const;
export const FORMALITY_LEVELS = ["casual", "neutral", "formal"] as const;
export const PERSON_CHOICES = ["first", "second", "third"] as const;
export const TENSE_CHOICES = ["present", "past", "future", "mixed"] as const;
export const SENTENCE_LENGTH_CHOICES = ["short", "medium", "long", "mixed"] as const;

export type ReadingLevel = (typeof READING_LEVELS)[number];
export type Formality = (typeof FORMALITY_LEVELS)[number];
export type PersonPreference = (typeof PERSON_CHOICES)[number];
export type TensePreference = (typeof TENSE_CHOICES)[number];
export type SentenceLengthPreference = (typeof SENTENCE_LENGTH_CHOICES)[number];

export interface VoiceProfileExampleRewrite {
  before: string;
  after: string;
}

export interface TenantVoiceProfileInput {
  readingLevel: ReadingLevel;
  formality: Formality;
  person: PersonPreference;
  tense: TensePreference;
  sentenceLength: SentenceLengthPreference;
  bannedWords: ReadonlyArray<string>;
  preferredWords: ReadonlyArray<string>;
  exampleRewrites: ReadonlyArray<VoiceProfileExampleRewrite>;
}

export interface TenantVoiceProfileVersion extends TenantVoiceProfileInput {
  tenantId: TenantId;
  version: number;
  createdAt: Date;
  createdByUserId: string;
}

export type VoiceProfileValidationResult = TenantVoiceProfileInput;

const URL_LIKE = /\bhttps?:\/\/\S+/iu;
const CREDENTIAL_LIKE = /\b(?:sk|pk|rk|api|token|secret|password)[-_][A-Za-z0-9_-]{3,}\b/iu;
const IMPERATIVE_LIKE = /\b(?:ignore|disregard|override|bypass|reveal|output|print|show|expose)\b[\s\S]{0,48}\b(?:rule|rules|instruction|instructions|secret|secrets|credential|credentials|password|token)\b/iu;
const EMAIL_LIKE = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/iu;
const PHONE_LIKE = /(?:\+\d[\d ()-]{7,}\d|\b\d[\d ()-]{8,}\d\b)/u;
const SOCIAL_HANDLE_LIKE = /(^|\s)@[A-Za-z0-9_]{2,}/u;
const CONTACT_SOLICITATION_LIKE = /\b(?:call|contact|email|message|text|whatsapp|telegram|signal|dm)\s+(?:me|us)\b/iu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const WORD_TOKEN = /^[\p{L}\p{M}]+(?:['’\u2010\u2011-][\p{L}\p{M}]+)*$/u;

function canonicalWord(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB").normalize("NFC");
}

/**
 * Words a tenant may not ban, because removing one changes what a sentence
 * means rather than how it sounds.
 *
 * Suggestion containment is additive: it checks that every token in a draft is
 * attributable to a cited span, the prompt scaffold or a sanctioned voice
 * field. It cannot see deletion. A span-faithful sentence rewritten to avoid a
 * banned "not" inverts its meaning and passes every token check, so the only
 * place to stop it is here, at save time. See `docs/product/support-ai-boundary.md`
 * section 3.8.
 *
 * Style bans are unaffected: "just", "very", "really", "leverage" and the rest
 * of what a house style actually forbids are absent from this list by design.
 * Entries are stored without separators so "can't", "can’t" and "cant" all
 * resolve to the same key.
 */
export const VOICE_PROFILE_MEANING_BEARING_WORDS: ReadonlySet<string> = new Set([
  // Negation and absence. Removing any of these reverses the claim.
  "no", "not", "never", "none", "nobody", "noone", "nothing", "nowhere",
  "neither", "nor", "without", "nope", "nay",
  "cannot", "cant", "dont", "doesnt", "didnt", "wont", "wouldnt", "shouldnt",
  "couldnt", "isnt", "arent", "wasnt", "werent", "hasnt", "havent", "hadnt",
  "mustnt", "shant", "aint",
  // Modality. Removing one turns a hedged statement into a commitment, which is
  // the difference between "we may refund" and "we refund".
  "must", "should", "shall", "may", "might", "can", "could", "will", "would",
  // Condition, exception and contrast. Removing one detaches a claim from the
  // circumstance that qualified it.
  "if", "unless", "except", "but", "however", "although", "though",
  "otherwise", "whereas",
  // Scope and quantity. "Only eligible orders" and "eligible orders" are
  // different promises.
  "all", "any", "every", "each", "only", "always", "some", "most", "few",
  "both", "either",
  // Conjunction. Dropping "or" collapses alternatives into a single option.
  "and", "or",
]);

function meaningBearingKey(canonical: string): string {
  return canonical.replace(/['’‐‑-]/gu, "");
}

export function isMeaningBearingWord(value: string): boolean {
  return VOICE_PROFILE_MEANING_BEARING_WORDS.has(meaningBearingKey(canonicalWord(value)));
}

function containsUnsafeText(value: string): boolean {
  return URL_LIKE.test(value)
    || CREDENTIAL_LIKE.test(value)
    || IMPERATIVE_LIKE.test(value)
    || EMAIL_LIKE.test(value)
    || PHONE_LIKE.test(value)
    || SOCIAL_HANDLE_LIKE.test(value)
    || CONTACT_SOLICITATION_LIKE.test(value);
}

function validateEnum<T extends string>(
  label: string,
  value: string,
  allowed: readonly T[],
): asserts value is T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function normalizeWordList(
  label: string,
  values: ReadonlyArray<string>,
  refuseMeaningBearing: boolean,
): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`);
  if (values.length > VOICE_PROFILE_MAX_LIST_ITEMS) {
    throw new Error(`${label} accepts at most ${VOICE_PROFILE_MAX_LIST_ITEMS} words`);
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    if (typeof value !== "string") throw new Error(`${label}[${index}] must be text`);
    const canonical = canonicalWord(value);
    if ([...canonical].length > VOICE_PROFILE_MAX_WORD_LENGTH || !WORD_TOKEN.test(canonical)) {
      throw new Error(`${label}[${index}] must be a bounded word token`);
    }
    if (containsUnsafeText(canonical)) {
      throw new Error(`${label}[${index}] contains an unsafe token`);
    }
    if (refuseMeaningBearing && VOICE_PROFILE_MEANING_BEARING_WORDS.has(meaningBearingKey(canonical))) {
      throw new Error(
        `${label}[${index}] is a meaning-bearing word: banning "${canonical}" would let a rewrite invert meaning while passing suggestion containment`,
      );
    }
    if (seen.has(canonical)) throw new Error(`${label} contains duplicate word: ${canonical}`);
    seen.add(canonical);
    return canonical;
  });
}

function normalizeExample(example: VoiceProfileExampleRewrite, index: number): VoiceProfileExampleRewrite {
  if (typeof example !== "object" || example === null) {
    throw new Error(`exampleRewrites[${index}] must be an object`);
  }
  const before = typeof example.before === "string" ? example.before.trim().normalize("NFC") : "";
  const after = typeof example.after === "string" ? example.after.trim().normalize("NFC") : "";
  if (!before || !after) {
    throw new Error(`exampleRewrites[${index}] requires before and after text`);
  }
  if ([...before].length > VOICE_PROFILE_MAX_REWRITE_BEFORE_LENGTH) {
    throw new Error(`exampleRewrites[${index}].before is too long`);
  }
  if ([...after].length > VOICE_PROFILE_MAX_REWRITE_AFTER_LENGTH) {
    throw new Error(`exampleRewrites[${index}].after is too long`);
  }
  if (before === after) {
    throw new Error(`exampleRewrites[${index}] must change the text`);
  }
  const combined = `${before}\n${after}`;
  if (CONTROL_OR_FORMAT.test(before) || CONTROL_OR_FORMAT.test(after)) {
    throw new Error(`exampleRewrites[${index}] contains control or format characters`);
  }
  if (URL_LIKE.test(combined)) throw new Error(`exampleRewrites[${index}] contains a URL`);
  if (CREDENTIAL_LIKE.test(combined)) {
    throw new Error(`exampleRewrites[${index}] contains a credential-like token`);
  }
  if (IMPERATIVE_LIKE.test(combined)) {
    throw new Error(`exampleRewrites[${index}] contains an imperative instruction`);
  }
  if (containsUnsafeText(combined)) throw new Error(`exampleRewrites[${index}] contains contact solicitation`);
  return { before, after };
}

export function validateVoiceProfile(input: TenantVoiceProfileInput): VoiceProfileValidationResult {
  validateEnum("readingLevel", input.readingLevel, READING_LEVELS);
  validateEnum("formality", input.formality, FORMALITY_LEVELS);
  validateEnum("person", input.person, PERSON_CHOICES);
  validateEnum("tense", input.tense, TENSE_CHOICES);
  validateEnum("sentenceLength", input.sentenceLength, SENTENCE_LENGTH_CHOICES);

  // Only bannedWords carries the meaning-bearing rule. A preferred word is
  // additive and sanctioned; a banned one is a deletion instruction, and
  // deletion is what containment cannot see.
  const bannedWords = normalizeWordList("bannedWords", input.bannedWords, true);
  const preferredWords = normalizeWordList("preferredWords", input.preferredWords, false);
  const banned = new Set(bannedWords);
  for (const word of preferredWords) {
    if (banned.has(word)) {
      throw new Error(`preferredWords overlaps bannedWords after canonicalisation: ${word}`);
    }
  }

  if (!Array.isArray(input.exampleRewrites)) {
    throw new Error("exampleRewrites must be an array");
  }
  if (input.exampleRewrites.length > VOICE_PROFILE_MAX_EXAMPLES) {
    throw new Error(`exampleRewrites accepts at most ${VOICE_PROFILE_MAX_EXAMPLES} entries`);
  }
  const exampleRewrites = input.exampleRewrites.map((example, index) => normalizeExample(example, index));

  return {
    readingLevel: input.readingLevel,
    formality: input.formality,
    person: input.person,
    tense: input.tense,
    sentenceLength: input.sentenceLength,
    bannedWords,
    preferredWords,
    exampleRewrites,
  };
}
