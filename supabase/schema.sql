-- Catálogo Lupo B2B — schema Supabase
-- Ejecutá esto en: Supabase → SQL Editor → New query → Run

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  token text primary key,
  filename text not null,
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.app_state enable row level security;
alter table public.orders enable row level security;

-- Sin policies para anon/authenticated: solo la service role (backend) lee/escribe.

insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do update set public = excluded.public;

-- Bucket público: las fotos se sirven por URL directa.
-- Sin policy SELECT: nadie puede listar todos los archivos del bucket.
-- Escritura/borrado solo con service role (bypassa RLS).
drop policy if exists "Public read uploads" on storage.objects;
