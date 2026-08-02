create table if not exists app_documents (
  namespace text not null,
  document_key text not null,
  revision bigint not null default 1,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, document_key)
);

create table if not exists app_blobs (
  storage_key text primary key,
  content_type text not null,
  content_length bigint not null,
  sha256 text not null,
  body bytea,
  object_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_blobs alter column body drop not null;
alter table app_blobs add column if not exists object_key text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_blobs_content_check'
      and conrelid = 'app_blobs'::regclass
  ) then
    alter table app_blobs
      add constraint app_blobs_content_check
      check (body is not null or object_key is not null);
  end if;
end
$$;

create table if not exists audit_events (
  id bigserial primary key,
  request_id text not null,
  actor_id text,
  action text not null,
  resource text not null,
  status_code integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_documents_updated_at_idx on app_documents(updated_at desc);
create index if not exists audit_events_request_id_idx on audit_events(request_id);
create index if not exists audit_events_created_at_idx on audit_events(created_at desc);
