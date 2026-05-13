-- ============================================================
-- MEMORI — Schema inicial
-- ============================================================

-- Extensiones
create extension if not exists "uuid-ossp";

-- ============================================================
-- FUNERAL HOMES
-- ============================================================
create table public.funeral_homes (
  id                    uuid primary key default uuid_generate_v4(),
  name                  text not null,
  email                 text not null unique,
  phone                 text,
  address               text,
  stripe_customer_id    text,
  stripe_subscription_id text,
  plan_active           boolean not null default false,
  plan_started_at       timestamptz,
  created_at            timestamptz not null default now()
);

-- ============================================================
-- PROFILES (extiende auth.users)
-- ============================================================
create table public.profiles (
  id                    uuid primary key references auth.users(id) on delete cascade,
  name                  text,
  email                 text,
  plan                  text not null default 'basico'
                          check (plan in ('basico','premium_anticipado','premium_postumo')),
  plan_paid_at          timestamptz,
  stripe_customer_id    text,
  funeral_home_id       uuid references public.funeral_homes(id),
  status                text not null default 'active'
                          check (status in ('active','deceased')),
  created_at            timestamptz not null default now()
);

-- Crear perfil automáticamente al registrar usuario
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- FUNERAL HOME USERS (staff del panel funeraria)
-- ============================================================
create table public.funeral_home_users (
  id              uuid primary key references auth.users(id) on delete cascade,
  funeral_home_id uuid not null references public.funeral_homes(id) on delete cascade,
  role            text not null default 'staff' check (role in ('admin','staff')),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- MESSAGES
-- ============================================================
create table public.messages (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  title               text not null,
  recipient_name      text not null,
  recipient_email     text not null,
  delivery_type       text not null check (delivery_type in ('evento','fecha','despedida')),
  event_description   text,
  delivery_date       date,
  format              text not null check (format in ('video','audio','texto')),
  storage_path        text,
  content             text,
  guardian_note       text,
  status              text not null default 'pending'
                        check (status in ('pending','delivered','cancelled')),
  delivered_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- ============================================================
-- DEATH NOTIFICATIONS
-- ============================================================
create table public.death_notifications (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null references public.profiles(id),
  funeral_home_id   uuid references public.funeral_homes(id),
  death_date        date not null,
  guardian_name     text,
  guardian_contact  text,
  plan_type         text,
  payment_status    text not null default 'pending'
                      check (payment_status in ('pending','paid','not_required')),
  messages_released boolean not null default false,
  notified_at       timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

-- ============================================================
-- CONTACT REQUESTS (formulario landing)
-- ============================================================
create table public.contact_requests (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  email       text not null,
  type        text not null check (type in ('particular','funeraria')),
  message     text,
  replied     boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'messages',
  'messages',
  false,
  524288000,
  array['video/mp4','video/quicktime','video/webm','audio/mpeg','audio/mp4','audio/webm','audio/ogg','text/plain','image/jpeg','image/png','application/pdf']
) on conflict (id) do nothing;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles            enable row level security;
alter table public.messages            enable row level security;
alter table public.funeral_homes       enable row level security;
alter table public.funeral_home_users  enable row level security;
alter table public.death_notifications enable row level security;
alter table public.contact_requests    enable row level security;

-- Helper: is current user a funeral home staff member?
create or replace function public.is_funeral_staff()
returns boolean language sql security definer as $$
  select exists (
    select 1 from public.funeral_home_users
    where id = auth.uid()
  );
$$;

-- Helper: get funeral_home_id for current user
create or replace function public.my_funeral_home_id()
returns uuid language sql security definer as $$
  select funeral_home_id from public.funeral_home_users
  where id = auth.uid()
  limit 1;
$$;

-- Profiles
create policy "Users read own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update using (auth.uid() = id);

create policy "Funeral staff read client profiles"
  on public.profiles for select using (
    public.is_funeral_staff() and funeral_home_id = public.my_funeral_home_id()
  );

-- Messages
create policy "Users manage own messages"
  on public.messages for all using (auth.uid() = user_id);

create policy "Funeral staff read client messages"
  on public.messages for select using (
    public.is_funeral_staff() and
    exists (
      select 1 from public.profiles p
      where p.id = messages.user_id
        and p.funeral_home_id = public.my_funeral_home_id()
    )
  );

-- Funeral homes
create policy "Funeral staff read own home"
  on public.funeral_homes for select using (
    id = public.my_funeral_home_id()
  );

-- Funeral home users
create policy "Users read own funeral_home_user row"
  on public.funeral_home_users for select using (auth.uid() = id);

-- Death notifications
create policy "Funeral staff manage death notifications"
  on public.death_notifications for all using (
    funeral_home_id = public.my_funeral_home_id()
  );

create policy "Users read own death notification"
  on public.death_notifications for select using (auth.uid() = user_id);

-- Contact requests (insert public, read only service role)
create policy "Anyone can insert contact request"
  on public.contact_requests for insert with check (true);

-- Storage: messages bucket
create policy "Users upload to own folder"
  on storage.objects for insert with check (
    bucket_id = 'messages' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users read own files"
  on storage.objects for select using (
    bucket_id = 'messages' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete own files"
  on storage.objects for delete using (
    bucket_id = 'messages' and
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- CRON: configurar en cron-job.org apuntando a /functions/v1/deliver-messages
