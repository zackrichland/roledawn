-- D-143: a restarted employer form can rotate its field fingerprints within
-- the same send. Reuse only original candidate replies under the existing
-- candidate/input/job/wording/option and protected-question checks.
create or replace function private.autopilot_remembered_value(p_candidate_id uuid, p_workspace_id uuid, p_autopilot_id uuid, p_descriptor jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_prior record; v_context record; v_value jsonb;
  v_reusable boolean := private.autopilot_answer_context_independent(p_descriptor);
begin
  -- Consent, legal, signature and demographic responses are application-specific.
  -- An exact response in this send is still usable; never copy it from another.
  if private.autopilot_question_candidate_only(p_descriptor) then return null; end if;
  select r.job_version_id, s.candidate_input_version into v_context
    from public.application_autopilots p
    join public.application_revisions r on r.id = p.revision_id and r.application_id = p.application_id
    join public.application_input_snapshots s on s.id = r.input_snapshot_id
    where p.id = p_autopilot_id and p.candidate_id = p_candidate_id and p.workspace_id = p_workspace_id;
  if not found then return null; end if;
  for v_prior in
    select q.descriptor as descriptor, a.value_json as value
      from public.application_autopilot_questions q
      join public.application_autopilot_answers a on a.question_id=q.id
      join public.application_autopilots p on p.id=q.autopilot_id
      join public.application_revisions r on r.id=p.revision_id and r.application_id=p.application_id
      join public.application_input_snapshots s on s.id=r.input_snapshot_id
      where p.candidate_id=p_candidate_id and p.workspace_id=p_workspace_id and q.status='ANSWERED'
        and a.source='CANDIDATE'
        and s.candidate_input_version=v_context.candidate_input_version
        and (v_reusable or r.job_version_id=v_context.job_version_id)
        and q.descriptor->>'kind'=p_descriptor->>'kind'
        and private.autopilot_question_key(q.descriptor->>'label')=private.autopilot_question_key(p_descriptor->>'label')
      order by a.created_at desc limit 5
  loop
    v_value:=null;
    case p_descriptor->>'kind'
      when 'TEXT','LONG_TEXT' then
        if jsonb_typeof(v_prior.value)='string' and char_length(v_prior.value#>>'{}')<=8000
          and (not (p_descriptor->>'required')::boolean or btrim(v_prior.value#>>'{}')<>'') then v_value:=v_prior.value; end if;
      when 'BOOLEAN' then
        if jsonb_typeof(v_prior.value)='boolean' then v_value:=v_prior.value; end if;
      when 'SINGLE_SELECT' then
        if jsonb_typeof(v_prior.value)='string' then
          select o->'value' into v_value from jsonb_array_elements(p_descriptor->'options') o
            where private.autopilot_option_key(o->>'label')=(select private.autopilot_option_key(po->>'label')
              from jsonb_array_elements(v_prior.descriptor->'options') po where po->'value'=v_prior.value limit 1)
            limit 1;
        end if;
      when 'MULTI_SELECT' then
        if jsonb_typeof(v_prior.value)='array' and jsonb_array_length(v_prior.value)>0 then
          select jsonb_agg(o->'value') into v_value from jsonb_array_elements(p_descriptor->'options') o
            where private.autopilot_option_key(o->>'label') in (select private.autopilot_option_key(po->>'label')
              from jsonb_array_elements(v_prior.descriptor->'options') po join jsonb_array_elements(v_prior.value) c(choice) on po->'value'=c.choice);
          if v_value is null or jsonb_array_length(v_value)<>jsonb_array_length(v_prior.value) then v_value:=null; end if;
        end if;
      else v_value:=null;
    end case;
    if v_value is not null then return v_value; end if;
  end loop;
  return null;
end; $$;
