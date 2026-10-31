begin;

alter table forma.profiles add column auto_summary boolean not null default true;

create table forma.conversation_summaries (
 conversation_id uuid primary key,
 user_id uuid not null,
 content text not null check(octet_length(content) between 1 and 6000),
 through_seq bigint not null check(through_seq>0),
 source_count integer not null check(source_count>0),
 updated_at timestamptz not null default now(),
 foreign key(conversation_id,user_id) references forma.conversations(id,user_id) on delete cascade
);
create index on forma.conversation_summaries(user_id);
alter table forma.conversation_summaries enable row level security;
revoke all on forma.conversation_summaries from public,anon,authenticated;
grant select on forma.conversation_summaries to authenticated;
grant all on forma.conversation_summaries to service_role;
create policy own_summary on forma.conversation_summaries for select to authenticated
 using ((select auth.uid())=user_id);

-- Edits/regeneration delete source messages in begin_generation's transaction.
-- Invalidate only summaries that actually depended on those messages.
create function forma.invalidate_conversation_summary() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 delete from forma.conversation_summaries
 where conversation_id=old.conversation_id and through_seq>=old.seq;
 return old;
end$$;
revoke all on function forma.invalidate_conversation_summary() from public,anon,authenticated;
create trigger invalidate_summary after delete on forma.messages
 for each row execute function forma.invalidate_conversation_summary();

create function forma.save_conversation_summary(p_event uuid,p_previous_seq bigint,p_through_seq bigint,p_content text,p_source_count integer)
returns void language plpgsql security definer set search_path='' as $$
declare ev forma.usage_events;uid uuid;cursor_seq bigint;actual_count bigint;
begin
 select user_id into uid from forma.usage_events where id=p_event;
 if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from forma.user_limits where user_id=uid for update;
 select * into ev from forma.usage_events where id=p_event and status='running'
  and created_at>now()-interval '3 minutes';
 if not found or ev.conversation_id is null then raise exception 'NOT_RUNNING';end if;
 -- Match begin_generation lock order, and serialize against conversation deletion.
 perform 1 from forma.conversations where id=ev.conversation_id for update;
 if not found then raise exception 'NOT_FOUND';end if;
 perform 1 from forma.usage_events where id=p_event and status='running' for update;
 if not found then raise exception 'NOT_RUNNING';end if;
 select through_seq into cursor_seq from forma.conversation_summaries where conversation_id=ev.conversation_id;
 if coalesce(cursor_seq,0)<>p_previous_seq then raise exception 'SUMMARY_CHANGED';end if;
 if p_through_seq is null or p_through_seq<=p_previous_seq or
  not exists(select 1 from forma.messages where conversation_id=ev.conversation_id and seq=p_through_seq and status='complete') or
  p_through_seq>=(select max(seq) from forma.messages where conversation_id=ev.conversation_id) then
  raise exception 'INVALID_SUMMARY_CURSOR';
 end if;
 select count(*) into actual_count from forma.messages where conversation_id=ev.conversation_id and status='complete' and seq<=p_through_seq;
 if p_source_count is null or p_source_count<>actual_count then raise exception 'INVALID_SUMMARY_COUNT';end if;
 insert into forma.conversation_summaries(conversation_id,user_id,content,through_seq,source_count)
 values(ev.conversation_id,uid,p_content,p_through_seq,p_source_count)
 on conflict(conversation_id) do update set content=excluded.content,through_seq=excluded.through_seq,
 source_count=excluded.source_count,updated_at=now();
end$$;
revoke all on function forma.save_conversation_summary(uuid,bigint,bigint,text,integer) from public,anon,authenticated;
grant execute on function forma.save_conversation_summary(uuid,bigint,bigint,text,integer) to service_role;

-- One user turn can include one compaction call plus the answer. Reserve both
-- before sending source text, and keep spent/uncertain compaction usage reserved
-- while preparing the answer. The default preserves existing service callers.
drop function forma.prepare_generation(uuid,integer,integer);
create function forma.prepare_generation(p_event uuid,p_input integer,p_max_output integer,p_spent integer default 0)
returns void language plpgsql security definer set search_path='' as $$
declare uid uuid;lim forma.user_limits;ev forma.usage_events;total bigint;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select user_id into uid from forma.usage_events where id=p_event;
 if not found then raise exception 'NOT_FOUND';end if;
 select * into lim from forma.user_limits where user_id=uid for update;
 select * into ev from forma.usage_events where id=p_event and status='running' for update;
 if not found then raise exception 'NOT_RUNNING';end if;
 if p_input is null or p_max_output is null or p_spent is null or p_input<0 or p_max_output<1 or p_input>24000 or p_max_output>8192 or p_spent<0 or p_spent>50000 then raise exception 'INVALID_RESERVATION';end if;
 select coalesce(sum(coalesce(quota_tokens,reserved_tokens)),0) into total from forma.usage_events
 where user_id=uid and created_at>=day_start and id<>p_event;
 if total+p_input+p_max_output+p_spent>lim.daily_tokens then raise exception 'TOKEN_LIMIT';end if;
 update forma.usage_events set reserved_tokens=p_input+p_max_output+p_spent where id=p_event;
end$$;
revoke all on function forma.prepare_generation(uuid,integer,integer,integer) from public,anon,authenticated;
grant execute on function forma.prepare_generation(uuid,integer,integer,integer) to service_role;

commit;
