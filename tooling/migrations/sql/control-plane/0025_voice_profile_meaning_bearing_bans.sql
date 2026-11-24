-- Refuse meaning-bearing words as bannedWords entries.
--
-- Suggestion containment is additive: it checks that every token in a draft is
-- attributable to a cited span, the prompt scaffold, or a sanctioned voice
-- field. It cannot see deletion. A span-faithful sentence rewritten to avoid a
-- banned 'not' inverts its meaning and passes every token check, so the ban has
-- to be refused at write time. See docs/product/support-ai-boundary.md 3.8.
--
-- This is a separate constraint rather than a rewrite of
-- validate_tenant_voice_profile, so the failure names the rule that fired
-- instead of collapsing into a generic profile-invalid error, and so the two
-- rules stay independently readable.
--
-- The constraint validates rows already present. That is deliberate: a stored
-- profile banning a negation is exactly the defect being closed, so a migration
-- that stops on one is reporting a real finding rather than a nuisance.

create function tenant_voice_profile_word_is_meaning_bearing(value text) returns boolean
language sql immutable strict
set search_path = pg_catalog, public
as $$
  -- Separators are stripped so can't, can’t and cant resolve to one key. Kept
  -- in the same order and content as VOICE_PROFILE_MEANING_BEARING_WORDS in
  -- packages/platform-core/src/voice-profile.ts; the integration suite proves
  -- the two agree by executing every entry against this function.
  select translate(lower(value), '''’‐‑-', '') = any (array[
    -- Negation and absence. Removing any of these reverses the claim.
    'no','not','never','none','nobody','noone','nothing','nowhere',
    'neither','nor','without','nope','nay',
    'cannot','cant','dont','doesnt','didnt','wont','wouldnt','shouldnt',
    'couldnt','isnt','arent','wasnt','werent','hasnt','havent','hadnt',
    'mustnt','shant','aint',
    -- Modality. Removing one turns a hedge into a commitment.
    'must','should','shall','may','might','can','could','will','would',
    -- Condition, exception and contrast.
    'if','unless','except','but','however','although','though',
    'otherwise','whereas',
    -- Scope and quantity.
    'all','any','every','each','only','always','some','most','few',
    'both','either',
    -- Conjunction.
    'and','or'
  ]::text[]);
$$;

comment on function tenant_voice_profile_word_is_meaning_bearing(text) is
  'True when banning the word would let a rewrite invert meaning while passing suggestion containment';

create function tenant_voice_profile_bans_are_safe(profile jsonb) returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
begin
  if jsonb_typeof(profile->'bannedWords') is distinct from 'array' then
    -- Shape is validate_tenant_voice_profile's job. Defer rather than
    -- duplicate, so a malformed profile fails against one rule, not two.
    return true;
  end if;
  for item in select value from jsonb_array_elements(profile->'bannedWords') loop
    if jsonb_typeof(item) = 'string'
       and tenant_voice_profile_word_is_meaning_bearing(item #>> '{}') then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

alter table tenant_voice_profile_versions
  add constraint tenant_voice_profile_bans_exclude_meaning_bearing_words
  check (tenant_voice_profile_bans_are_safe(profile));
