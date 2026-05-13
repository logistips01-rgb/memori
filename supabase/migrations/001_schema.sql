-- Memori · Migración inicial
-- Ejecutar en: Supabase Dashboard → SQL Editor

-- ─── EXTENSIONES ─────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── PROFILES ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id         uuid references auth.users on delete cascade primary key,
  email      text unique not null,
  nombre     text,
  avatar_url text,
  plan       text not null default 'basico' check (plan in ('basico', 'premium')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nombre, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── MENSAJES ────────────────────────────────────────────────────────────────
create table if not exists public.mensajes (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid references auth.users on delete cascade not null,
  titulo              text not null,
  destinatario        text not null,
  email_destinatario  text,
  tipo_entrega        text not null check (tipo_entrega in ('evento', 'fecha', 'despedida')),
  evento              text,
  fecha_entrega       date,
  formato             text not null check (formato in ('video', 'audio', 'texto')),
  storage_path        text,
  storage_url         text,
  contenido_texto     text,
  nota_guardian       text,
  estado              text not null default 'pendiente'
                      check (estado in ('pendiente', 'enviado', 'archivado')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists mensajes_user_id_idx on public.mensajes (user_id);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.mensajes  enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

create policy "mensajes_select_own" on public.mensajes
  for select using (auth.uid() = user_id);

create policy "mensajes_insert_own" on public.mensajes
  for insert with check (auth.uid() = user_id);

create policy "mensajes_update_own" on public.mensajes
  for update using (auth.uid() = user_id);

create policy "mensajes_delete_own" on public.mensajes
  for delete using (auth.uid() = user_id);

-- ─── STORAGE BUCKET ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
  values ('mensajes-archivos', 'mensajes-archivos', false)
  on conflict (id) do nothing;

create policy "storage_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'mensajes-archivos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "storage_select_own" on storage.objects
  for select using (
    bucket_id = 'mensajes-archivos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "storage_delete_own" on storage.objects
  for delete using (
    bucket_id = 'mensajes-archivos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
