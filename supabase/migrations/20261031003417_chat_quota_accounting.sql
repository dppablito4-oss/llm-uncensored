begin;

alter table forma.profiles add column reasoning_effort text not null default 'low'
 check(reasoning_effort in ('auto','none','minimal','low','medium','high','xhigh','max'));
alter table forma.presets add column reasoning_effort text not null default 'low'
 check(reasoning_effort in ('auto','none','minimal','low','medium','high','xhigh','max'));

-- Preserve the original reservation as an audit trail. NULL means usage is
-- unknown and the reservation still counts; zero means no provider call occurred.
alter table forma.usage_events
 add column quota_tokens integer check(quota_tokens>=0),
 add column usage_reported boolean not null default false,
 add column finalized_at timestamptz;

-- Successful historical responses already contain reported or conservatively
-- estimated usage. Do not release uncertain partial/error reservations.
update forma.usage_events
 set quota_tokens=greatest(0,input_tokens)+greatest(0,output_tokens),finalized_at=created_at
 where status='complete';
update forma.usage_events set quota_tokens=0
 where status='error' and error_code in ('CONTEXT_LIMIT','HISTORY_ERROR','MEMORY_ERROR');

create or replace function forma.begin_generation(p_uid uuid,p_cid uuid,p_request uuid,p_content text,p_model text,p_preset uuid,p_action text,p_target uuid,p_reserve integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare lim forma.user_limits;conv forma.conversations;target forma.messages;total bigint;event_id uuid;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select * into lim from forma.user_limits where user_id=p_uid for update;
 if not found then raise exception 'NO_PROFILE';end if;
 select * into conv from forma.conversations where id=p_cid and user_id=p_uid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from forma.usage_events where user_id=p_uid and request_id=p_request) then raise exception 'DUPLICATE_REQUEST';end if;
 if exists(select 1 from forma.usage_events where conversation_id=p_cid and status='running' and created_at>now()-interval '3 minutes') then raise exception 'GENERATION_RUNNING';end if;
 if (select count(*) from forma.usage_events where user_id=p_uid and created_at>now()-interval '1 minute')>=lim.requests_per_minute then raise exception 'RATE_LIMIT';end if;
 if (select count(*) from forma.usage_events where user_id=p_uid and created_at>=day_start)>=lim.daily_requests then raise exception 'DAILY_LIMIT';end if;
 select coalesce(sum(coalesce(quota_tokens,reserved_tokens)),0) into total from forma.usage_events where user_id=p_uid and created_at>=day_start;
 if p_reserve is null or p_reserve<1 or total+p_reserve>lim.daily_tokens then raise exception 'TOKEN_LIMIT';end if;
 if not exists(select 1 from forma.models where id=p_model and enabled) then raise exception 'MODEL_NOT_ALLOWED';end if;
 if p_preset is not null and not exists(select 1 from forma.presets where id=p_preset and user_id=p_uid) then raise exception 'PRESET_NOT_FOUND';end if;
 if p_action in ('edit','regenerate') then
 select * into target from forma.messages where id=p_target and conversation_id=p_cid and user_id=p_uid and role='user';
 if not found then raise exception 'TARGET_NOT_FOUND';end if;
 delete from forma.messages where conversation_id=p_cid and (seq>target.seq or (p_action='edit' and seq=target.seq));
 elsif p_action<>'send' then raise exception 'INVALID_ACTION';end if;
 if p_action<>'regenerate' then
 if p_content is null or length(p_content) not between 1 and 12000 then raise exception 'INVALID_CONTENT';end if;
 insert into forma.messages(conversation_id,user_id,role,content,model_id) values(p_cid,p_uid,'user',p_content,p_model);
 end if;
 -- Expire stale runs without assuming their provider consumption was zero.
 update forma.usage_events set status='error',error_code='GENERATION_TIMEOUT',finalized_at=now()
 where user_id=p_uid and status='running' and created_at<=now()-interval '3 minutes';
 update forma.conversations set model_id=p_model,preset_id=p_preset,updated_at=now(),title=case when title='Nueva conversación' then left(p_content,80) else title end where id=p_cid;
 insert into forma.usage_events(request_id,user_id,conversation_id,model_id,reserved_tokens) values(p_request,p_uid,p_cid,p_model,p_reserve) returning id into event_id;
 return event_id;
end$$;

-- After loading the transactional history, reserve only the context actually
-- sent plus maximum output. A provider call is forbidden until this succeeds.
create function forma.prepare_generation(p_event uuid,p_input integer,p_max_output integer)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;lim forma.user_limits;ev forma.usage_events;total bigint;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select user_id into uid from forma.usage_events where id=p_event;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into lim from forma.user_limits where user_id=uid for update;
 select * into ev from forma.usage_events where id=p_event and status='running' for update;
 if not found then raise exception 'NOT_RUNNING';end if;
 if p_input is null or p_max_output is null or p_input<0 or p_max_output<1 or p_input>24000 or p_max_output>8192 then raise exception 'INVALID_RESERVATION';end if;
 select coalesce(sum(coalesce(quota_tokens,reserved_tokens)),0) into total from forma.usage_events
 where user_id=uid and created_at>=day_start and id<>p_event;
 if total+p_input+p_max_output>lim.daily_tokens then raise exception 'TOKEN_LIMIT';end if;
 update forma.usage_events set reserved_tokens=p_input+p_max_output where id=p_event;
end$$;
revoke all on function forma.prepare_generation(uuid,integer,integer) from public,anon,authenticated;
grant execute on function forma.prepare_generation(uuid,integer,integer) to service_role;

-- Defaults keep old service callers conservative during rolling deployments.
drop function forma.finish_generation(uuid,text,text,integer,integer,numeric,text);
create function forma.finish_generation(p_event uuid,p_content text,p_status text,p_input integer,p_output integer,p_cost numeric,p_error text,p_usage_reported boolean default false,p_provider_started boolean default true)
returns void language plpgsql security definer set search_path='' as $$
declare ev forma.usage_events;uid uuid;
begin
 select user_id into uid from forma.usage_events where id=p_event;
 if not found then return;end if;
 -- All quota mutations lock the same row first, including finalization.
 perform 1 from forma.user_limits where user_id=uid for update;
 select * into ev from forma.usage_events where id=p_event and status='running' for update;
 if not found then return;end if;
 if p_status is null or p_status not in ('complete','partial','error') then raise exception 'INVALID_STATUS';end if;
 if ev.conversation_id is not null and length(p_content)>0 then
 insert into forma.messages(conversation_id,user_id,role,content,model_id,status,input_tokens,output_tokens)
 values(ev.conversation_id,ev.user_id,'assistant',left(p_content,100000),ev.model_id,p_status,greatest(0,p_input),greatest(0,p_output));
 update forma.conversations set updated_at=now() where id=ev.conversation_id;
 end if;
 update forma.usage_events set status=p_status,input_tokens=greatest(0,p_input),output_tokens=greatest(0,p_output),estimated_cost_usd=p_cost,error_code=p_error,
 usage_reported=coalesce(p_usage_reported,false),finalized_at=now(),
 quota_tokens=case when p_provider_started=false then 0
 when p_usage_reported=true then greatest(0,p_input)+greatest(0,p_output)
 else null end where id=p_event;
end$$;
revoke all on function forma.finish_generation(uuid,text,text,integer,integer,numeric,text,boolean,boolean) from public,anon,authenticated;
grant execute on function forma.finish_generation(uuid,text,text,integer,integer,numeric,text,boolean,boolean) to service_role;

-- Aggregate on the server instead of downloading an account's entire usage log.
-- Invoker privileges and explicit ownership both enforce user isolation.
create function forma.usage_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 with bounds as (
 select date_trunc('day',now() at time zone 'UTC') at time zone 'UTC' as day_start
 ), mine as (
 select * from forma.usage_events where user_id=(select auth.uid())
 )
 select jsonb_build_object(
 'requests_total',(select count(*) from mine),
 'tokens_total',(select coalesce(sum(input_tokens::bigint+output_tokens),0) from mine),
 'cost_total',(select coalesce(sum(estimated_cost_usd),0) from mine),
 'requests_today',(select count(*) from mine,bounds where created_at>=day_start),
 'tokens_today',(select coalesce(sum(coalesce(quota_tokens,reserved_tokens)),0) from mine,bounds where created_at>=day_start),
 'reserved_today',(select coalesce(sum(reserved_tokens),0) from mine,bounds where created_at>=day_start and quota_tokens is null),
 'daily_requests',lim.daily_requests,'daily_tokens',lim.daily_tokens,
 'resets_at',(select day_start+interval '24 hours' from bounds)
 ) from forma.user_limits lim where lim.user_id=(select auth.uid())
$$;
revoke all on function forma.usage_summary() from public,anon;
grant execute on function forma.usage_summary() to authenticated;

commit;
