-- Immutable, tenant-private voice-profile versions and revocation evidence.
-- Transaction management is owned by the migration runner.

create collation tenant_voice_profile_unicode (
  provider = builtin,
  locale = 'C.UTF-8'
);

create function tenant_voice_profile_codepoint_is_mark(codepoint integer) returns boolean
language sql immutable strict parallel safe
as $$
  -- Frozen from the Node 22 Unicode 17 \p{M} table used by application validation.
  select codepoint <@ '{
    [768,880),[1155,1162),[1425,1470),[1471,1472),[1473,1475),[1476,1478),
    [1479,1480),[1552,1563),[1611,1632),[1648,1649),[1750,1757),[1759,1765),
    [1767,1769),[1770,1774),[1809,1810),[1840,1867),[1958,1969),[2027,2036),
    [2045,2046),[2070,2074),[2075,2084),[2085,2088),[2089,2094),[2137,2140),
    [2199,2208),[2250,2274),[2275,2308),[2362,2365),[2366,2384),[2385,2392),
    [2402,2404),[2433,2436),[2492,2493),[2494,2501),[2503,2505),[2507,2510),
    [2519,2520),[2530,2532),[2558,2559),[2561,2564),[2620,2621),[2622,2627),
    [2631,2633),[2635,2638),[2641,2642),[2672,2674),[2677,2678),[2689,2692),
    [2748,2749),[2750,2758),[2759,2762),[2763,2766),[2786,2788),[2810,2816),
    [2817,2820),[2876,2877),[2878,2885),[2887,2889),[2891,2894),[2901,2904),
    [2914,2916),[2946,2947),[3006,3011),[3014,3017),[3018,3022),[3031,3032),
    [3072,3077),[3132,3133),[3134,3141),[3142,3145),[3146,3150),[3157,3159),
    [3170,3172),[3201,3204),[3260,3261),[3262,3269),[3270,3273),[3274,3278),
    [3285,3287),[3298,3300),[3315,3316),[3328,3332),[3387,3389),[3390,3397),
    [3398,3401),[3402,3406),[3415,3416),[3426,3428),[3457,3460),[3530,3531),
    [3535,3541),[3542,3543),[3544,3552),[3570,3572),[3633,3634),[3636,3643),
    [3655,3663),[3761,3762),[3764,3773),[3784,3791),[3864,3866),[3893,3894),
    [3895,3896),[3897,3898),[3902,3904),[3953,3973),[3974,3976),[3981,3992),
    [3993,4029),[4038,4039),[4139,4159),[4182,4186),[4190,4193),[4194,4197),
    [4199,4206),[4209,4213),[4226,4238),[4239,4240),[4250,4254),[4957,4960),
    [5906,5910),[5938,5941),[5970,5972),[6002,6004),[6068,6100),[6109,6110),
    [6155,6158),[6159,6160),[6277,6279),[6313,6314),[6432,6444),[6448,6460),
    [6679,6684),[6741,6751),[6752,6781),[6783,6784),[6832,6878),[6880,6892),
    [6912,6917),[6964,6981),[7019,7028),[7040,7043),[7073,7086),[7142,7156),
    [7204,7224),[7376,7379),[7380,7401),[7405,7406),[7412,7413),[7415,7418),
    [7616,7680),[8400,8433),[11503,11506),[11647,11648),[11744,11776),[12330,12336),
    [12441,12443),[42607,42611),[42612,42622),[42654,42656),[42736,42738),[43010,43011),
    [43014,43015),[43019,43020),[43043,43048),[43052,43053),[43136,43138),[43188,43206),
    [43232,43250),[43263,43264),[43302,43310),[43335,43348),[43392,43396),[43443,43457),
    [43493,43494),[43561,43575),[43587,43588),[43596,43598),[43643,43646),[43696,43697),
    [43698,43701),[43703,43705),[43710,43712),[43713,43714),[43755,43760),[43765,43767),
    [44003,44011),[44012,44014),[64286,64287),[65024,65040),[65056,65072),[66045,66046),
    [66272,66273),[66422,66427),[68097,68100),[68101,68103),[68108,68112),[68152,68155),
    [68159,68160),[68325,68327),[68900,68904),[68969,68974),[69291,69293),[69370,69376),
    [69446,69457),[69506,69510),[69632,69635),[69688,69703),[69744,69745),[69747,69749),
    [69759,69763),[69808,69819),[69826,69827),[69888,69891),[69927,69941),[69957,69959),
    [70003,70004),[70016,70019),[70067,70081),[70089,70093),[70094,70096),[70188,70200),
    [70206,70207),[70209,70210),[70367,70379),[70400,70404),[70459,70461),[70462,70469),
    [70471,70473),[70475,70478),[70487,70488),[70498,70500),[70502,70509),[70512,70517),
    [70584,70593),[70594,70595),[70597,70598),[70599,70603),[70604,70609),[70610,70611),
    [70625,70627),[70709,70727),[70750,70751),[70832,70852),[71087,71094),[71096,71105),
    [71132,71134),[71216,71233),[71339,71352),[71453,71468),[71724,71739),[71984,71990),
    [71991,71993),[71995,71999),[72000,72001),[72002,72004),[72145,72152),[72154,72161),
    [72164,72165),[72193,72203),[72243,72250),[72251,72255),[72263,72264),[72273,72284),
    [72330,72346),[72544,72552),[72751,72759),[72760,72768),[72850,72872),[72873,72887),
    [73009,73015),[73018,73019),[73020,73022),[73023,73030),[73031,73032),[73098,73103),
    [73104,73106),[73107,73112),[73459,73463),[73472,73474),[73475,73476),[73524,73531),
    [73534,73539),[73562,73563),[78912,78913),[78919,78934),[90398,90416),[92912,92917),
    [92976,92983),[94031,94032),[94033,94088),[94095,94099),[94180,94181),[94192,94194),
    [113821,113823),[118528,118574),[118576,118599),[119141,119146),[119149,119155),[119163,119171),
    [119173,119180),[119210,119214),[119362,119365),[121344,121399),[121403,121453),[121461,121462),
    [121476,121477),[121499,121504),[121505,121520),[122880,122887),[122888,122905),[122907,122914),
    [122915,122917),[122918,122923),[123023,123024),[123184,123191),[123566,123567),[123628,123632),
    [124140,124144),[124398,124400),[124643,124644),[124646,124647),[124654,124656),[124661,124662),
    [125136,125143),[125252,125259),[917760,918000)
  }'::int4multirange
$$;

create function tenant_voice_profile_text_is_safe(value text) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  char_index integer;
  codepoint integer;
begin
  for char_index in 1..char_length(value) loop
    codepoint := ascii(substr(value, char_index, 1));
    if codepoint between 0 and 31
       or codepoint between 127 and 159
       or codepoint = 173
       or codepoint between 1536 and 1541
       or codepoint in (1564, 1757, 1807, 2274, 6158, 65279, 69821, 69837, 917505)
       or codepoint between 2192 and 2193
       or codepoint between 8203 and 8207
       or codepoint between 8232 and 8233
       or codepoint between 8234 and 8238
       or codepoint between 8288 and 8292
       or codepoint between 8294 and 8303
       or codepoint between 65529 and 65531
       or codepoint between 78896 and 78911
       or codepoint between 113824 and 113827
       or codepoint between 119155 and 119162
       or codepoint between 917536 and 917631 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create function tenant_voice_profile_text_is_trimmed(value text) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  first_codepoint integer;
  last_codepoint integer;
begin
  if char_length(value) = 0 then return false; end if;
  first_codepoint := ascii(substr(value, 1, 1));
  last_codepoint := ascii(substr(value, char_length(value), 1));
  return not (
    first_codepoint between 9 and 13
    or first_codepoint in (32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279)
    or first_codepoint between 8192 and 8202
    or last_codepoint between 9 and 13
    or last_codepoint in (32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279)
    or last_codepoint between 8192 and 8202
  );
end;
$$;

create function tenant_voice_profile_word_is_valid(value text) returns boolean
language plpgsql immutable strict
set search_path = pg_catalog, public
as $$
declare
  char_index integer;
  char_value text;
  is_separator boolean;
  previous_was_separator boolean := false;
begin
  if value is distinct from lower(value collate tenant_voice_profile_unicode)
     or value is distinct from normalize(value, NFC)
     or char_length(value) not between 1 and 64
     or not tenant_voice_profile_text_is_safe(value) then
    return false;
  end if;

  for char_index in 1..char_length(value) loop
    char_value := substr(value, char_index, 1);
    is_separator := char_value = any(array['''', '’', '‐', '‑', '-']);
    if is_separator then
      if char_index = 1 or char_index = char_length(value) or previous_was_separator then
        return false;
      end if;
      previous_was_separator := true;
    else
      if char_value collate tenant_voice_profile_unicode !~ '^[[:alpha:]]$'
         and not tenant_voice_profile_codepoint_is_mark(ascii(char_value)) then
        return false;
      end if;
      previous_was_separator := false;
    end if;
  end loop;
  return true;
end;
$$;

create function validate_tenant_voice_profile(profile jsonb) returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  item jsonb;
  word text;
  banned text[] := array[]::text[];
  preferred text[] := array[]::text[];
begin
  if jsonb_typeof(profile) is distinct from 'object'
     or (select array_agg(key order by key) from jsonb_object_keys(profile) as keys(key))
        is distinct from array['bannedWords','exampleRewrites','formality','person','preferredWords',
                               'readingLevel','sentenceLength','tense']::text[]
     or profile->>'readingLevel' is null
     or profile->>'readingLevel' not in ('general','professional','technical')
     or profile->>'formality' is null
     or profile->>'formality' not in ('casual','neutral','formal')
     or profile->>'person' is null
     or profile->>'person' not in ('first','second','third')
     or profile->>'tense' is null
     or profile->>'tense' not in ('present','past','future','mixed')
     or profile->>'sentenceLength' is null
     or profile->>'sentenceLength' not in ('short','medium','long','mixed')
     or jsonb_typeof(profile->'bannedWords') is distinct from 'array'
     or jsonb_typeof(profile->'preferredWords') is distinct from 'array'
     or jsonb_typeof(profile->'exampleRewrites') is distinct from 'array'
     or jsonb_array_length(profile->'bannedWords') > 200
     or jsonb_array_length(profile->'preferredWords') > 200
     or jsonb_array_length(profile->'exampleRewrites') > 20 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(profile->'bannedWords') loop
    if jsonb_typeof(item) <> 'string' then return false; end if;
    word := item #>> '{}';
    if not tenant_voice_profile_word_is_valid(word)
       or word ~ '^(sk|pk|rk|api|token|secret|password)[_-][A-Za-z0-9_-]{3,}$'
    then return false; end if;
    if word = any(banned) then return false; end if;
    banned := array_append(banned, word);
  end loop;

  for item in select value from jsonb_array_elements(profile->'preferredWords') loop
    if jsonb_typeof(item) <> 'string' then return false; end if;
    word := item #>> '{}';
    if not tenant_voice_profile_word_is_valid(word)
       or word ~ '^(sk|pk|rk|api|token|secret|password)[_-][A-Za-z0-9_-]{3,}$'
       or word = any(preferred) or word = any(banned) then
      return false;
    end if;
    preferred := array_append(preferred, word);
  end loop;

  for item in select value from jsonb_array_elements(profile->'exampleRewrites') loop
    if jsonb_typeof(item) is distinct from 'object'
       or (select array_agg(key order by key) from jsonb_object_keys(item) as keys(key))
          is distinct from array['after','before']::text[]
       or jsonb_typeof(item->'before') is distinct from 'string'
       or jsonb_typeof(item->'after') is distinct from 'string'
       or char_length(item->>'before') not between 1 and 1000
       or char_length(item->>'after') not between 1 and 1000
       or not tenant_voice_profile_text_is_trimmed(item->>'before')
       or not tenant_voice_profile_text_is_trimmed(item->>'after')
       or item->>'before' is distinct from normalize(item->>'before', NFC)
       or item->>'after' is distinct from normalize(item->>'after', NFC)
       or not tenant_voice_profile_text_is_safe(item->>'before')
       or not tenant_voice_profile_text_is_safe(item->>'after')
       or normalize(item->>'before', NFC) = normalize(item->>'after', NFC) then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create table tenant_voice_profile_versions (
  tenant_id text not null references tenants (tenant_id),
  version integer not null check (version >= 1),
  profile jsonb not null check (validate_tenant_voice_profile(profile)),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  published_by_user_id text not null check (
    char_length(published_by_user_id) between 1 and 200
    and tenant_voice_profile_text_is_safe(published_by_user_id)
    and tenant_voice_profile_text_is_trimmed(published_by_user_id)
  ),
  reason text not null check (
    char_length(reason) between 1 and 1000
    and tenant_voice_profile_text_is_safe(reason)
    and tenant_voice_profile_text_is_trimmed(reason)
  ),
  published_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, version)
);

create table tenant_voice_profiles (
  tenant_id text primary key references tenants (tenant_id),
  current_version integer,
  next_version integer not null default 1 check (next_version >= 1),
  revision integer not null default 0 check (revision >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, current_version)
    references tenant_voice_profile_versions (tenant_id, version)
);

create table tenant_voice_profile_revocations (
  tenant_id text not null,
  version integer not null,
  revoked_by_user_id text not null check (
    char_length(revoked_by_user_id) between 1 and 200
    and tenant_voice_profile_text_is_safe(revoked_by_user_id)
    and tenant_voice_profile_text_is_trimmed(revoked_by_user_id)
  ),
  reason text not null check (
    char_length(reason) between 1 and 1000
    and tenant_voice_profile_text_is_safe(reason)
    and tenant_voice_profile_text_is_trimmed(reason)
  ),
  revoked_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, version),
  foreign key (tenant_id, version)
    references tenant_voice_profile_versions (tenant_id, version)
);

create function set_voice_profile_version_timestamp() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.published_at := clock_timestamp();
  return new;
end;
$$;
create trigger tenant_voice_profile_versions_server_timestamp
  before insert on tenant_voice_profile_versions
  for each row execute function set_voice_profile_version_timestamp();

create function set_voice_profile_revocation_timestamp() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.revoked_at := clock_timestamp();
  return new;
end;
$$;
create trigger tenant_voice_profile_revocations_server_timestamp
  before insert on tenant_voice_profile_revocations
  for each row execute function set_voice_profile_revocation_timestamp();

create function block_voice_profile_evidence_mutation() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin raise exception '% is append-only', tg_table_name; end;
$$;

create trigger tenant_voice_profile_versions_immutable
  before update or delete on tenant_voice_profile_versions
  for each row execute function block_voice_profile_evidence_mutation();
create trigger tenant_voice_profile_versions_no_truncate
  before truncate on tenant_voice_profile_versions
  for each statement execute function block_voice_profile_evidence_mutation();
create trigger tenant_voice_profile_revocations_immutable
  before update or delete on tenant_voice_profile_revocations
  for each row execute function block_voice_profile_evidence_mutation();
create trigger tenant_voice_profile_revocations_no_truncate
  before truncate on tenant_voice_profile_revocations
  for each statement execute function block_voice_profile_evidence_mutation();

create function guard_voice_profile_head() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'INSERT' then
    new.updated_at := clock_timestamp();
    if new.current_version is not null or new.next_version <> 1 or new.revision <> 0 then
      raise exception 'voice profile head must start empty';
    end if;
    return new;
  end if;
  if new.tenant_id <> old.tenant_id or new.revision <> old.revision + 1 then
    raise exception 'voice profile head transition requires one revision increment';
  end if;
  if new.current_version is null then
    if old.current_version is null or new.next_version <> old.next_version then
      raise exception 'voice profile revocation must clear the current version';
    end if;
  elsif new.current_version = old.next_version and new.next_version = old.next_version + 1 then
    if exists (select 1 from tenant_voice_profile_revocations r
               where r.tenant_id = new.tenant_id and r.version = new.current_version) then
      raise exception 'a revoked voice profile cannot become current';
    end if;
  else
    raise exception 'voice profile publication must consume next_version';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger tenant_voice_profiles_guard
  before insert or update on tenant_voice_profiles
  for each row execute function guard_voice_profile_head();
create trigger tenant_voice_profiles_no_delete
  before delete on tenant_voice_profiles
  for each row execute function block_voice_profile_evidence_mutation();
create trigger tenant_voice_profiles_no_truncate
  before truncate on tenant_voice_profiles
  for each statement execute function block_voice_profile_evidence_mutation();

create function guard_voice_profile_revocation() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if not exists (select 1 from tenant_voice_profiles h
                 where h.tenant_id = new.tenant_id and h.current_version = new.version) then
    raise exception 'only the current tenant voice profile may be revoked';
  end if;
  return new;
end;
$$;
create trigger tenant_voice_profile_revocations_current_only
  before insert on tenant_voice_profile_revocations
  for each row execute function guard_voice_profile_revocation();

create function enforce_voice_profile_revocation_consistency() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if exists (select 1 from tenant_voice_profiles h
             where h.tenant_id = new.tenant_id and h.current_version = new.version) then
    raise exception 'a revoked voice profile cannot remain current';
  end if;
  return null;
end;
$$;
create constraint trigger tenant_voice_profile_revocation_not_current
  after insert on tenant_voice_profile_revocations
  deferrable initially deferred
  for each row execute function enforce_voice_profile_revocation_consistency();

create function enforce_voice_profile_clear_has_revocation() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.current_version is not null and new.current_version is null
     and not exists (select 1 from tenant_voice_profile_revocations r
                     where r.tenant_id = new.tenant_id and r.version = old.current_version) then
    raise exception 'clearing a voice profile requires revocation evidence';
  end if;
  return null;
end;
$$;
create constraint trigger tenant_voice_profile_clear_requires_revocation
  after update on tenant_voice_profiles
  deferrable initially deferred
  for each row execute function enforce_voice_profile_clear_has_revocation();
