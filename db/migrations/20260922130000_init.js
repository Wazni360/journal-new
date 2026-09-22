export const up = async (knex) => {
  await knex.raw(`
    create table entries (
      id uuid primary key,
      created_at timestamptz not null default now(),
      recorded_at timestamptz not null,
      duration_seconds numeric,
      title text,
      status text not null default 'uploading' check (status in ('uploading', 'uploaded')),
      video_key text not null,
      upload_id text,
      mime_type text not null,
      codec_label text not null,
      width int,
      height int,
      size_bytes bigint,
      audio_key text,
      thumb_key text,
      transcript text,
      transcript_status text not null default 'none',
      deleted_at timestamptz
    );

    create table login_attempts (
      id bigint generated always as identity primary key,
      ip text not null,
      success boolean not null,
      attempted_at timestamptz not null default now()
    );

    create index login_attempts_ip_attempted_at_idx on login_attempts (ip, attempted_at);

    -- RLS with no policies: only the table owner (the server's connection) can read or write.
    alter table entries enable row level security;
    alter table login_attempts enable row level security;
    alter table knex_migrations enable row level security;
    alter table knex_migrations_lock enable row level security;
  `);
};

export const down = async (knex) => {
  await knex.raw(`
    drop table if exists login_attempts;
    drop table if exists entries;
  `);
};
