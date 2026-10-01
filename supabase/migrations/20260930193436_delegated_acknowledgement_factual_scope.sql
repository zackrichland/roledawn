-- Permission to acknowledge terms does not establish a new fact; reading the supplied notice is an acknowledgement.
-- Explicit candidate delegation handles employer acknowledgements without model inference.
-- Nothing is granted globally: a candidate must save the exact reserved authorization.
create or replace function private.autopilot_delegated_standing_value(p_descriptor jsonb, p_topic text, p_answer text, p_legal_name text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare label text:=lower(regexp_replace(btrim(p_descriptor->>'label'),'\s+',' ','g')); choice jsonb; matches integer;
  ack text:='\y(consent|agree\w*|accept\w*|acknowledg\w*|authoriz\w*|certify|attest\w*|terms|privacy|arbitrat\w*)\y';
  factual text:='\y(gender|sex|sexual|race|racial|ethnic\w*|veteran\w*|disabilit\w*|citizen\w*|nationality|criminal history|convicted|felony|clearance|ts[\s/-]*sci|polygraph|licensed|licensure|certified professional|degree|gpa|years of experience|authorized to work|require sponsorship|(i|you|applicant|candidate) (am|are|have (?!read\y|reviewed\y)|hold|possess|meet|reside|live|worked)|(at least|over|under) [0-9]+ (years|year)|bound by (a )?non[\s-]*compet\w*)\y';
  negative text:='\y(do not|don[''’]t|not agree|not consent|decline|refuse|without\s+using\s+(ai|artificial intelligence)|no\s+(ai|artificial intelligence))\y';
  affirmative text:='^(yes|(i )?(agree|accept|consent|acknowledge|acknowledged|certify|attest|authorize)|confirmed)$';
begin
  if not coalesce(private.autopilot_descriptor_valid(p_descriptor),false)
    or lower(regexp_replace(btrim(coalesce(p_topic,'')),'\s+',' ','g'))<>'delegated application acknowledgements'
    or p_answer is distinct from 'Authorize RoleDawn to accept application terms, privacy notices, processing and screening consents, certify the supplied application information, and enter my approved legal name as my signature.' then return null; end if;
  if label ~ '^(?:(?:candidate|applicant|your|digital|electronic|typed) )?(?:signature|sign here)(?: \((?:type|enter) (?:your )?(?:full |legal )?name\))?[ *:.]*$' then
    if p_descriptor->>'kind'<>'TEXT' or jsonb_array_length(p_descriptor->'options')<>0 or nullif(btrim(p_legal_name),'') is null then return null; end if;
    return to_jsonb(p_legal_name);
  end if;
  if label !~* ack or label ~* factual or label ~* negative then return null; end if;
  if p_descriptor->>'kind'='BOOLEAN' and jsonb_array_length(p_descriptor->'options')=0 then return 'true'::jsonb;
  elsif p_descriptor->>'kind'='SINGLE_SELECT' then
    select count(*),jsonb_agg(o) into matches,choice from jsonb_array_elements(p_descriptor->'options') o
      where lower(regexp_replace(btrim(o->>'label'),'\s+',' ','g')) ~ affirmative;
    if matches=1 then return choice->0->'value'; end if;
  elsif p_descriptor->>'kind'='MULTI_SELECT' and jsonb_array_length(p_descriptor->'options')=1 then
    choice:=p_descriptor->'options'->0;
    label:=lower(regexp_replace(btrim(choice->>'label'),'\s+',' ','g'));
    if label ~ affirmative or (label ~* ack and label !~* factual and label !~* negative) then return jsonb_build_array(choice->'value'); end if;
  end if;
  return null;
end; $$;
revoke all on function private.autopilot_delegated_standing_value(jsonb,text,text,text) from public,anon,authenticated,service_role;

