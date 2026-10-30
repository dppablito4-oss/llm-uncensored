
create table public.models(id text primary key,name text not null,enabled boolean not null default true);
insert into public.models values ('cognitivecomputations/dolphin-mistral-24b-venice-edition','Dolphin · Mistral 24B',true);
create table public.profiles(
 id uuid primary key references auth.users on delete cascade,display_name text check(length(display_name)<=100),avatar_url text,
 default_model text not null default 'cognitivecomputations/dolphin-mistral-24b-venice-edition' references public.models,
 default_preset_id uuid,memory_enabled boolean not null default true,
 temperature numeric not null default .7 check(temperature between 0 and 2),top_p numeric not null default 1 check(top_p between 0 and 1),
 max_tokens integer not null default 2048 check(max_tokens between 64 and 8192),context_tokens integer not null default 12000 check(context_tokens between 2000 and 24000),
 memory_tokens integer not null default 1200 check(memory_tokens between 0 and 4000),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.presets(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,
 name text not null check(length(name) between 1 and 80),description text not null default '' check(length(description)<=400),
 system_prompt text not null check(length(system_prompt)<=8000),temperature numeric not null default .7 check(temperature between 0 and 2),
 top_p numeric not null default 1 check(top_p between 0 and 1),max_tokens integer not null default 2048 check(max_tokens between 64 and 8192),
 model_id text not null references public.models,memory_enabled boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,user_id));
alter table public.profiles add constraint own_default_preset foreign key(default_preset_id,id) references public.presets(id,user_id);
create table public.conversations(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,
 title text not null default 'Nueva conversación' check(length(title) between 1 and 160),model_id text not null references public.models,
 preset_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),archived_at timestamptz,
 unique(id,user_id),foreign key(preset_id,user_id) references public.presets(id,user_id));
create table public.messages(
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null,user_id uuid not null references auth.users on delete cascade,
 role text not null check(role in ('user','assistant')),content text not null check(length(content)<=100000),model_id text references public.models,
 input_tokens integer check(input_tokens>=0),output_tokens integer check(output_tokens>=0),status text not null default 'complete' check(status in ('complete','partial','error')),
 seq bigint generated always as identity,created_at timestamptz not null default now(),
 foreign key(conversation_id,user_id) references public.conversations(id,user_id) on delete cascade);
create table public.memories(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users on delete cascade,content text not null check(length(content) between 1 and 2000),
 category text not null default 'general' check(length(category)<=60),enabled boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.user_limits(
 user_id uuid primary key references auth.users on delete cascade,requests_per_minute integer not null default 8 check(requests_per_minute>0),
 daily_requests integer not null default 80 check(daily_requests>0),daily_tokens integer not null default 250000 check(daily_tokens>0));
create table public.usage_events(
 id uuid primary key default gen_random_uuid(),request_id uuid not null,user_id uuid not null references auth.users on delete cascade,
 conversation_id uuid references public.conversations on delete set null,model_id text not null references public.models,
 input_tokens integer not null default 0,output_tokens integer not null default 0,estimated_cost_usd numeric,
 reserved_tokens integer not null,status text not null default 'running' check(status in ('running','complete','partial','error')),
 error_code text,created_at timestamptz not null default now(),unique(user_id,request_id));
create index on public.conversations(user_id,updated_at desc);
create index on public.messages(conversation_id,seq);
create index on public.presets(user_id);
create index on public.memories(user_id,enabled);
create index on public.usage_events(user_id,created_at);
create function public.touch_updated() returns trigger language plpgsql set search_path='' as $$begin new.updated_at=now();return new;end$$;
create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated();
create trigger touch_presets before update on public.presets for each row execute function public.touch_updated();
create trigger touch_conversations before update on public.conversations for each row execute function public.touch_updated();
create trigger touch_memories before update on public.memories for each row execute function public.touch_updated();
create function public.new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id) values(new.id);insert into public.user_limits(user_id) values(new.id);
 insert into public.presets(user_id,name,description,system_prompt,model_id) values
 (new.id,'General','Conversación para el día a día','Eres un asistente útil, claro y honesto. Responde en el idioma del usuario.','cognitivecomputations/dolphin-mistral-24b-venice-edition'),
 (new.id,'Programador','Del problema al código','Eres especialista en desarrollo de software. Explica decisiones, entrega código verificable y señala supuestos.','cognitivecomputations/dolphin-mistral-24b-venice-edition'),
 (new.id,'Creativo','Ideas que toman forma','Ayuda a escribir y explorar ideas originales. Adapta el tono y ofrece alternativas concretas.','cognitivecomputations/dolphin-mistral-24b-venice-edition');return new;
end$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user();
alter table public.models enable row level security;
alter table public.profiles enable row level security;
alter table public.presets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.usage_events enable row level security;
alter table public.user_limits enable row level security;
create policy models_read on public.models for select to authenticated using(enabled);
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy profile_edit on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy own_presets on public.presets for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy own_conversations on public.conversations for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy own_memories on public.memories for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy messages_read on public.messages for select to authenticated using(user_id=(select auth.uid()));
create policy usage_read on public.usage_events for select to authenticated using(user_id=(select auth.uid()));
create policy limits_read on public.user_limits for select to authenticated using(user_id=(select auth.uid()));
revoke all on all tables in schema public from anon;
revoke all on public.messages,public.usage_events,public.user_limits,public.models from authenticated;
grant select on public.messages,public.usage_events,public.user_limits,public.models to authenticated;
grant select,insert,update,delete on public.conversations,public.presets,public.memories to authenticated;
grant select,update on public.profiles to authenticated;

-- Locks quota row before reservations: parallel requests cannot race daily/minute limits.
create function public.begin_generation(p_uid uuid,p_cid uuid,p_request uuid,p_content text,p_model text,p_preset uuid,p_action text,p_target uuid,p_reserve integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare lim public.user_limits;conv public.conversations;target public.messages;total bigint;event_id uuid;
begin
 select * into lim from public.user_limits where user_id=p_uid for update;
 if not found then raise exception 'NO_PROFILE';end if;
 select * into conv from public.conversations where id=p_cid and user_id=p_uid for update;
 if not found then raise exception 'NOT_FOUND';end if;
 if exists(select 1 from public.usage_events where user_id=p_uid and request_id=p_request) then raise exception 'DUPLICATE_REQUEST';end if;
 if exists(select 1 from public.usage_events where conversation_id=p_cid and status='running' and created_at>now()-interval '3 minutes') then raise exception 'GENERATION_RUNNING';end if;
 if (select count(*) from public.usage_events where user_id=p_uid and created_at>now()-interval '1 minute')>=lim.requests_per_minute then raise exception 'RATE_LIMIT';end if;
 if (select count(*) from public.usage_events where user_id=p_uid and created_at>=date_trunc('day',now()))>=lim.daily_requests then raise exception 'DAILY_LIMIT';end if;
 select coalesce(sum(greatest(reserved_tokens,input_tokens+output_tokens)),0) into total from public.usage_events where user_id=p_uid and created_at>=date_trunc('day',now());
 if p_reserve<1 or total+p_reserve>lim.daily_tokens then raise exception 'TOKEN_LIMIT';end if;
 if not exists(select 1 from public.models where id=p_model and enabled) then raise exception 'MODEL_NOT_ALLOWED';end if;
 if p_preset is not null and not exists(select 1 from public.presets where id=p_preset and user_id=p_uid) then raise exception 'PRESET_NOT_FOUND';end if;
 if p_action in ('edit','regenerate') then
 select * into target from public.messages where id=p_target and conversation_id=p_cid and user_id=p_uid and role='user';
 if not found then raise exception 'TARGET_NOT_FOUND';end if;
 -- Editing explicitly discards subsequent turns; regeneration preserves the selected user turn.
 delete from public.messages where conversation_id=p_cid and (seq>target.seq or (p_action='edit' and seq=target.seq));
 elsif p_action<>'send' then raise exception 'INVALID_ACTION';end if;
 if p_action<>'regenerate' then
 if length(p_content) not between 1 and 12000 then raise exception 'INVALID_CONTENT';end if;
 insert into public.messages(conversation_id,user_id,role,content,model_id) values(p_cid,p_uid,'user',p_content,p_model);
 end if;
 update public.conversations set model_id=p_model,preset_id=p_preset,updated_at=now(),title=case when title='Nueva conversación' then left(p_content,80) else title end where id=p_cid;
 insert into public.usage_events(request_id,user_id,conversation_id,model_id,reserved_tokens) values(p_request,p_uid,p_cid,p_model,p_reserve) returning id into event_id;
 return event_id;
end$$;
create function public.finish_generation(p_event uuid,p_content text,p_status text,p_input integer,p_output integer,p_cost numeric,p_error text)
returns void language plpgsql security definer set search_path='' as $$
declare ev public.usage_events;
begin
 select * into ev from public.usage_events where id=p_event and status='running' for update;
 if not found then return;end if;
 if p_status not in ('complete','partial','error') then raise exception 'INVALID_STATUS';end if;
 -- Conversation can have been removed while streaming; its usage still remains.
 if ev.conversation_id is not null and length(p_content)>0 then
 insert into public.messages(conversation_id,user_id,role,content,model_id,status,input_tokens,output_tokens)
 values(ev.conversation_id,ev.user_id,'assistant',left(p_content,100000),ev.model_id,p_status,p_input,p_output);
 update public.conversations set updated_at=now() where id=ev.conversation_id;
 end if;
 update public.usage_events set status=p_status,input_tokens=greatest(0,p_input),output_tokens=greatest(0,p_output),estimated_cost_usd=p_cost,error_code=p_error where id=p_event;
 -- Keep reservation for unknown/partial provider usage: fail closed on consumption.
end$$;
revoke all on function public.begin_generation(uuid,uuid,uuid,text,text,uuid,text,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_generation(uuid,text,text,integer,integer,numeric,text) from public,anon,authenticated;
revoke all on function public.new_user() from public,anon,authenticated;
grant execute on function public.begin_generation(uuid,uuid,uuid,text,text,uuid,text,uuid,integer) to service_role;
grant execute on function public.finish_generation(uuid,text,text,integer,integer,numeric,text) to service_role;
