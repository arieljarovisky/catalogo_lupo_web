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

-- Lectura pública de imágenes del catálogo
drop policy if exists "Public read uploads" on storage.objects;
create policy "Public read uploads"
  on storage.objects for select
  using (bucket_id = 'uploads');

-- Escritura/borrado solo con service role (bypassa RLS). No hace falta policy de insert.
