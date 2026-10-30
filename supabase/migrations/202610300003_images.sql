begin;
alter table forma.user_limits add column daily_images integer not null default 20 check(daily_images>0);
create table forma.image_generations (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,
 model_id text not null check(model_id in ('nsfw-gen-illustrious','hassaku-hentai')),
 prompt text not null check(length(prompt) between 1 and 3000),size text not null,
 steps integer not null,cfg_scale numeric not null,seed bigint,
 status text not null default 'running' check(status in ('running','complete','error')),
 object_path text,cost_usd numeric check(cost_usd>=0),error_code text,
 created_at timestamptz not null default now(),unique(user_id,request_id)
);
create index image_generations_user_date on forma.image_generations(user_id,created_at desc);
alter table forma.image_generations enable row level security;
revoke all on forma.image_generations from public,anon,authenticated;
grant select on forma.image_generations to authenticated;
grant all on forma.image_generations to service_role;
create policy image_generations_own on forma.image_generations for select to authenticated using(user_id=(select auth.uid()));

create function forma.begin_image_generation(p_uid uuid,p_request uuid,p_model text,p_prompt text,p_size text,p_steps integer,p_cfg numeric,p_seed bigint)
returns uuid language plpgsql security definer set search_path='' as $$
declare lim forma.user_limits; event_id uuid;
begin
 select * into lim from forma.user_limits where user_id=p_uid for update;
 if not found then raise exception 'NO_PROFILE';end if;
 if exists(select 1 from forma.image_generations where user_id=p_uid and request_id=p_request) then raise exception 'DUPLICATE_REQUEST';end if;
 if exists(select 1 from forma.image_generations where user_id=p_uid and status='running' and created_at>now()-interval '3 minutes') then raise exception 'GENERATION_RUNNING';end if;
 if (select count(*) from forma.image_generations where user_id=p_uid and created_at>now()-interval '1 minute')>=4 then raise exception 'RATE_LIMIT';end if;
 if (select count(*) from forma.image_generations where user_id=p_uid and created_at>=date_trunc('day',now()))>=lim.daily_images then raise exception 'DAILY_LIMIT';end if;
 if p_model is null or p_model not in ('nsfw-gen-illustrious','hassaku-hentai') then raise exception 'MODEL_NOT_ALLOWED';end if;
 if p_prompt is null or length(btrim(p_prompt)) not between 1 and 3000 then raise exception 'INVALID_PROMPT';end if;
 if p_size is null or p_size not in ('1024x1024','1920x1088','1088x1920','768x1024','1024x768','1408x1024','1024x1408','512x512','2048x2048') then raise exception 'INVALID_SIZE';end if;
 if p_steps is null or p_steps not between 1 and 50 or p_cfg is null or p_cfg not between 0 and 20 or p_seed<0 or p_seed>2147483647 then raise exception 'INVALID_PARAMETERS';end if;
 insert into forma.image_generations(request_id,user_id,model_id,prompt,size,steps,cfg_scale,seed)
 values(p_request,p_uid,p_model,p_prompt,p_size,p_steps,p_cfg,p_seed) returning id into event_id;
 return event_id;
end$$;
revoke all on function forma.begin_image_generation(uuid,uuid,text,text,text,integer,numeric,bigint) from public,anon,authenticated;
grant execute on function forma.begin_image_generation(uuid,uuid,text,text,text,integer,numeric,bigint) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('forma-images','forma-images',false,20971520,array['image/png','image/jpeg','image/webp']);
create policy forma_images_read on storage.objects for select to authenticated
using(bucket_id='forma-images' and split_part(name,'/',1)=(select auth.uid())::text);
commit;
