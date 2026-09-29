-- The recorded matching decision must refer to exactly the immutable job content
-- which the ranker scored, as well as the currently selected job version.
do $$
declare definition text; old_guard text:='and private.is_supported_autopilot_destination(v.apply_url)) then';
begin
  definition:=pg_get_functiondef('public.enqueue_auto_apply_match(uuid,uuid,bigint,uuid,uuid,text,text,jsonb)'::regprocedure);
  if position(old_guard in definition)=0 then raise exception 'AUTO_APPLY_MATCH_BINDING_DRIFT'; end if;
  execute replace(definition,old_guard,'and p_decision->>''jobContentHash''=v.content_hash and private.is_supported_autopilot_destination(v.apply_url)) then');
end; $$;
