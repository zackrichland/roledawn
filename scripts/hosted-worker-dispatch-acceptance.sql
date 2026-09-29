begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare token uuid; other uuid; result jsonb;
begin
  if has_function_privilege('anon','public.claim_hosted_worker_lane(text,integer)','EXECUTE')
    or has_function_privilege('authenticated','public.hosted_worker_due_lanes()','EXECUTE')
    or has_table_privilege('authenticated','public.hosted_worker_lanes','SELECT') then raise exception 'WORKER_ACL_FAILED'; end if;
  token := public.claim_hosted_worker_lane('catalog',30);
  if token is null then raise exception 'WORKER_TEST_REQUIRES_IDLE_CATALOG_LANE'; end if;
  other := public.claim_hosted_worker_lane('catalog',30);
  if other is not null then raise exception 'WORKER_DOUBLE_CLAIM'; end if;
  if public.finish_hosted_worker_lane('catalog',gen_random_uuid(),'{"completed":1}',null) then raise exception 'WORKER_WRONG_TOKEN'; end if;
  begin
    perform public.finish_hosted_worker_lane('catalog',token,'{"private_text":"not allowed"}',null);
    raise exception 'WORKER_RESULT_LEAK';
  exception when others then if sqlerrm <> 'HOSTED_WORKER_RESULT_INVALID' then raise; end if; end;
  if not public.finish_hosted_worker_lane('catalog',token,'{"completed":1,"failed":0}',null) then raise exception 'WORKER_FINISH_FAILED'; end if;
  if public.finish_hosted_worker_lane('catalog',token,'{"completed":1}',null) then raise exception 'WORKER_REPLAY_FINISH'; end if;
  result := public.hosted_worker_due_lanes();
  if jsonb_typeof(result) <> 'array' or result ? 'catalog' then raise exception 'WORKER_DUE_GATING_FAILED'; end if;
end $$;
rollback;
select true as hosted_worker_acceptance_passed;
