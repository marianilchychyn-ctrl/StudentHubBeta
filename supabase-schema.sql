-- StudentHub: схема бази даних для Supabase (PostgreSQL)
-- Модель: у кожного користувача СВІЙ приватний рядок. Ніхто інший, крім
-- самого власника (auth.uid()), не може ні прочитати, ні змінити ці дані.
-- Виконати один раз у Supabase Dashboard -> SQL Editor -> New query -> Run

create table if not exists public.user_data (
  id uuid primary key default gen_random_uuid(),
  owner uuid unique not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Бачити можна ЛИШЕ свій власний рядок.
create policy "Users can read own data" on public.user_data
  for select using (auth.uid() = owner);

-- Створити можна ЛИШЕ свій власний рядок (не чужий).
create policy "Users can insert own data" on public.user_data
  for insert with check (auth.uid() = owner);

-- Оновлювати можна ЛИШЕ свій власний рядок.
create policy "Users can update own data" on public.user_data
  for update using (auth.uid() = owner);

-- (За бажанням) дати користувачу видалити свої дані.
create policy "Users can delete own data" on public.user_data
  for delete using (auth.uid() = owner);

-- Автоматично оновлює updated_at при кожному записі.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_set_updated_at on public.user_data;
create trigger user_data_set_updated_at
before update on public.user_data
for each row execute function public.set_updated_at();
