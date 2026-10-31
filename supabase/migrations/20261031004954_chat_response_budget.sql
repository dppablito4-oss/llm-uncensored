begin;
-- Reasoning models share their output allowance with internal reasoning.
-- 2048 caused confirmed OUTPUT_LIMIT failures before visible text appeared.
alter table forma.profiles alter column max_tokens set default 4096;
alter table forma.presets alter column max_tokens set default 4096;
update forma.profiles set max_tokens=4096 where max_tokens=2048;
-- Upgrade only shipped presets whose prompt and budget are still unchanged.
update forma.presets set max_tokens=4096 where max_tokens=2048 and (
 (name='General' and system_prompt='Eres un asistente útil, claro y honesto. Responde en el idioma del usuario.') or
 (name='Programador' and system_prompt='Eres especialista en desarrollo de software. Explica decisiones, entrega código verificable y señala supuestos.') or
 (name='Creativo' and system_prompt='Ayuda a escribir y explorar ideas originales. Adapta el tono y ofrece alternativas concretas.')
);
commit;
