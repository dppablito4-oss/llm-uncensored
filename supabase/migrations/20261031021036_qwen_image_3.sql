begin;
alter table forma.image_generations drop constraint image_generations_model_id_check;
alter table forma.image_generations add constraint image_generations_model_id_check
 check(model_id in ('nsfw-gen-illustrious','hassaku-hentai','qwen-image-3-uncensored'));
alter table forma.image_generations drop constraint image_generations_prompt_check;
alter table forma.image_generations add constraint image_generations_prompt_check
 check(length(prompt) between 1 and case when model_id='qwen-image-3-uncensored' then 10000 else 3000 end);
alter table forma.image_generations add column aspect_ratio text not null default '1:1'
 check(aspect_ratio in ('1:1','3:2','16:9','21:9','9:16','2:3','3:4','4:5'));
alter table forma.image_generations alter column steps drop not null;
alter table forma.image_generations alter column cfg_scale drop not null;

-- Defaults retain compatibility with the previously deployed image handler.
drop function forma.begin_image_generation(uuid,uuid,text,text,text,integer,numeric,bigint);
create function forma.begin_image_generation(p_uid uuid,p_request uuid,p_model text,p_prompt text,p_size text,p_steps integer,p_cfg numeric,p_seed bigint,p_aspect text default '1:1')
returns uuid language plpgsql security definer set search_path='' as $$
declare lim forma.user_limits; event_id uuid;
 day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
 select * into lim from forma.user_limits where user_id=p_uid for update;
 if not found then raise exception 'NO_PROFILE';end if;
 if exists(select 1 from forma.image_generations where user_id=p_uid and request_id=p_request) then raise exception 'DUPLICATE_REQUEST';end if;
 if exists(select 1 from forma.image_generations where user_id=p_uid and status='running' and created_at>now()-interval '3 minutes') then raise exception 'GENERATION_RUNNING';end if;
 if (select count(*) from forma.image_generations where user_id=p_uid and created_at>now()-interval '1 minute')>=4 then raise exception 'RATE_LIMIT';end if;
 if (select count(*) from forma.image_generations where user_id=p_uid and created_at>=day_start)>=lim.daily_images then raise exception 'DAILY_LIMIT';end if;
 if p_model is null or p_model not in ('nsfw-gen-illustrious','hassaku-hentai','qwen-image-3-uncensored') then raise exception 'MODEL_NOT_ALLOWED';end if;
 if p_aspect is null or p_aspect not in ('1:1','3:2','16:9','21:9','9:16','2:3','3:4','4:5') then raise exception 'INVALID_ASPECT';end if;
 if p_model='qwen-image-3-uncensored' then
   if p_prompt is null or length(btrim(p_prompt)) not between 1 and 10000 then raise exception 'INVALID_PROMPT';end if;
   if p_size is null or p_size not in ('1k','2k') then raise exception 'INVALID_SIZE';end if;
   if p_steps is not null or p_cfg is not null or p_seed is not null then raise exception 'INVALID_PARAMETERS';end if;
 else
   if p_prompt is null or length(btrim(p_prompt)) not between 1 and 3000 then raise exception 'INVALID_PROMPT';end if;
   if p_size is null or p_size not in ('1024x1024','1920x1088','1088x1920','768x1024','1024x768','1408x1024','1024x1408','512x512','2048x2048') then raise exception 'INVALID_SIZE';end if;
   if p_aspect<>'1:1' or p_steps is null or p_steps not between 1 and 50 or p_cfg is null or p_cfg not between 0 and 20 or p_seed<0 or p_seed>2147483647 then raise exception 'INVALID_PARAMETERS';end if;
 end if;
 insert into forma.image_generations(request_id,user_id,model_id,prompt,size,steps,cfg_scale,seed,aspect_ratio)
 values(p_request,p_uid,p_model,p_prompt,p_size,p_steps,p_cfg,p_seed,p_aspect) returning id into event_id;
 return event_id;
end$$;
revoke all on function forma.begin_image_generation(uuid,uuid,text,text,text,integer,numeric,bigint,text) from public,anon,authenticated;
grant execute on function forma.begin_image_generation(uuid,uuid,text,text,text,integer,numeric,bigint,text) to service_role;
commit;
