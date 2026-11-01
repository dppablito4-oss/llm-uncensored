begin;

-- NULL means unlimited. PostgreSQL comparisons against NULL do not trigger
-- the existing daily-limit guards in begin_generation/prepare_generation.
-- Keep rate limiting, ownership checks, reservations and usage accounting.
alter table forma.user_limits
 alter column daily_requests drop not null,
 alter column daily_requests drop default,
 alter column daily_tokens drop not null,
 alter column daily_tokens drop default;

-- Apply to existing accounts; new accounts inherit the NULL defaults.
update forma.user_limits set daily_requests = null, daily_tokens = null;

commit;
