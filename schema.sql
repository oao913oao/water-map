-- 合格用水場所地圖：Supabase 資料庫結構
-- 用法：Supabase 後台 → SQL Editor → 貼上全部內容 → Run

create extension if not exists pgcrypto;

-- 公開顯示在地圖上的店家（只有管理員能新增或修改）
create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  area text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  status text not null default 'unchecked'
    check (status in ('unchecked', 'passed', 'failed')),
  equipment text,
  cartridge_replaced_on date,
  checked_on date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 店家自行送出的資料（待審核，不公開）
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  store_name text not null check (char_length(store_name) <= 80),
  area text check (char_length(area) <= 40),
  address text check (char_length(address) <= 160),
  lat double precision,
  lng double precision,
  equipment text check (char_length(equipment) <= 120),
  cartridge_replaced_on date,
  photo_paths text[] not null default '{}' check (cardinality(photo_paths) <= 4),
  contact text check (char_length(contact) <= 120),
  review_status text not null default 'pending'
    check (review_status in ('pending', 'approved', 'rejected')),
  store_id uuid references public.stores(id),
  created_at timestamptz not null default now()
);

alter table public.stores enable row level security;
alter table public.submissions enable row level security;

-- 任何人都可以讀取店家清單
drop policy if exists "public read stores" on public.stores;
create policy "public read stores" on public.stores
  for select using (true);

-- 任何人都可以送出登錄資料，但只能是「待審核」狀態；不能讀取別人送出的資料
drop policy if exists "anyone can submit" on public.submissions;
create policy "anyone can submit" on public.submissions
  for insert to anon, authenticated
  with check (review_status = 'pending' and store_id is null);

-- 照片儲存空間（私有，5 MB 上限，只收 JPG/PNG/WebP）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submission-photos', 'submission-photos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "anyone can upload submission photos" on storage.objects;
create policy "anyone can upload submission photos" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'submission-photos');

-- 自動更新 updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists stores_touch on public.stores;
create trigger stores_touch before update on public.stores
  for each row execute function public.touch_updated_at();
