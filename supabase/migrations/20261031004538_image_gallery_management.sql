-- Keep the quota/billing event after deleting the private file and prompt.
alter table forma.image_generations add column deleted_at timestamptz;
