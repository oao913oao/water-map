-- =====================================================================
-- 合格用水場所地圖：Supabase 資料庫結構
-- 在 Supabase → SQL Editor 整段貼上執行一次即可（可重複執行）。
-- =====================================================================

-- ---------- 1. 使用者角色 ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role         text not null default 'store' check (role in ('store','reviewer','admin')),
  created_at   timestamptz not null default now()
);

-- 新註冊帳號自動建立 profile（預設角色＝店家）
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 是否為查核員（security definer，避免 RLS 遞迴）
create or replace function public.is_reviewer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('reviewer','admin')
  );
$$;

-- ---------- 2. 店家 ----------
create table if not exists public.stores (
  id                  bigint generated always as identity primary key,
  name                text not null,
  address             text not null,
  area                text,                       -- 觀光區，例如「淡水老街」
  category            text,                       -- 飲料店、餐廳、冰店…
  lat                 double precision not null,
  lng                 double precision not null,
  phone               text,
  status              text not null default 'pending'
                      check (status in ('pending','submitted','pass','fail')),
  equipment           text,                       -- 淨水設備品牌型號（審核通過時記錄）
  fail_reason         text,
  valid_until         date,                       -- 合格有效期限
  last_reviewed_at    timestamptz,
  last_submission_at  timestamptz,
  owner_id            uuid references auth.users(id) on delete set null,
  is_published        boolean not null default true,
  is_demo             boolean not null default false,  -- 範例資料，正式上線前刪除
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists stores_status_idx on public.stores(status);
create index if not exists stores_owner_idx  on public.stores(owner_id);

-- 狀態變更歷史（不覆蓋舊紀錄）
create table if not exists public.store_status_history (
  id          bigint generated always as identity primary key,
  store_id    bigint not null references public.stores(id) on delete cascade,
  old_status  text,
  new_status  text not null,
  reason      text,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);

create or replace function public.log_store_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.store_status_history (store_id, old_status, new_status, reason, changed_by)
    values (new.id, old.status, new.status,
            coalesce(current_setting('app.status_reason', true), ''), auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists stores_status_log on public.stores;
create trigger stores_status_log
  before update on public.stores
  for each row execute function public.log_store_status();

-- 公開給地圖用的檢視表（不含 owner_id 等內部欄位）
create or replace view public.map_stores as
select id, name, address, area, category, lat, lng, phone, status,
       equipment, fail_reason, valid_until, last_reviewed_at, last_submission_at,
       (owner_id is not null) as claimed, is_demo, updated_at
from public.stores
where is_published;

-- ---------- 3. 認領申請（含新增店家申請） ----------
create table if not exists public.store_claims (
  id                bigint generated always as identity primary key,
  store_id          bigint references public.stores(id) on delete cascade,  -- null＝申請新增店家
  user_id           uuid not null references auth.users(id) on delete cascade default auth.uid(),
  proposed_name     text,
  proposed_address  text,
  proposed_area     text,
  proposed_category text,
  tax_id            text,          -- 統一編號（供查核比對）
  contact_name      text not null,
  contact_phone     text not null,
  note              text,
  status            text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_comment    text,
  reviewed_by       uuid,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  check (store_id is not null or (proposed_name is not null and proposed_address is not null))
);

-- ---------- 4. 店家上傳（濾水器照片與濾芯紀錄） ----------
create table if not exists public.submissions (
  id                 bigint generated always as identity primary key,
  store_id           bigint not null references public.stores(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade default auth.uid(),
  purifier_model     text not null,   -- 淨水器品牌型號
  cartridge_model    text,            -- 濾芯型號
  replaced_on        date not null,   -- 最近一次更換濾芯日期
  verification_code  text not null,   -- 照片中手寫的當日驗證碼
  photo_paths        text[] not null default '{}',
  note               text,
  status             text not null default 'pending' check (status in ('pending','pass','fail','returned')),
  review_comment     text,
  reviewed_by        uuid,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists submissions_status_idx on public.submissions(status);

-- 送件時：店家狀態若為未查核 → 改為「已申報待審」
create or replace function public.on_submission_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.status_reason', '店家送件', true);
  update public.stores
     set last_submission_at = now(),
         status = case when status = 'pending' then 'submitted' else status end
   where id = new.store_id;
  return new;
end $$;

drop trigger if exists submissions_after_insert on public.submissions;
create trigger submissions_after_insert
  after insert on public.submissions
  for each row execute function public.on_submission_insert();

-- ---------- 5. Row Level Security ----------
alter table public.profiles              enable row level security;
alter table public.stores                enable row level security;
alter table public.store_status_history  enable row level security;
alter table public.store_claims          enable row level security;
alter table public.submissions           enable row level security;

-- profiles：自己看自己、查核員看全部；不開放自行修改 role
drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_reviewer());

-- stores：一般人透過 map_stores 檢視表讀取；原始表僅店主與查核員可讀
drop policy if exists "stores owner or reviewer read" on public.stores;
create policy "stores owner or reviewer read" on public.stores
  for select using (owner_id = auth.uid() or public.is_reviewer());
drop policy if exists "stores reviewer write" on public.stores;
create policy "stores reviewer write" on public.stores
  for all using (public.is_reviewer()) with check (public.is_reviewer());

drop policy if exists "history reviewer read" on public.store_status_history;
create policy "history reviewer read" on public.store_status_history
  for select using (public.is_reviewer());

-- claims：本人可新增、查看自己的；查核員可看全部（審核走 RPC）
drop policy if exists "claims insert own" on public.store_claims;
create policy "claims insert own" on public.store_claims
  for insert with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
drop policy if exists "claims read own or reviewer" on public.store_claims;
create policy "claims read own or reviewer" on public.store_claims
  for select using (user_id = auth.uid() or public.is_reviewer());

-- submissions：只有店主能替自己的店送件
drop policy if exists "submissions insert by owner" on public.submissions;
create policy "submissions insert by owner" on public.submissions
  for insert with check (
    user_id = auth.uid()
    and status = 'pending' and reviewed_by is null
    and exists (select 1 from public.stores s where s.id = store_id and s.owner_id = auth.uid())
  );
drop policy if exists "submissions read own or reviewer" on public.submissions;
create policy "submissions read own or reviewer" on public.submissions
  for select using (user_id = auth.uid() or public.is_reviewer());

-- 權限：匿名只能讀檢視表
grant select on public.map_stores to anon, authenticated;
revoke all on public.stores from anon;
grant select, insert, update, delete on public.stores to authenticated;

-- ---------- 6. 審核 RPC（僅查核員可執行） ----------
create or replace function public.review_submission(
  p_id bigint, p_decision text, p_comment text default null, p_valid_months int default 6
) returns void language plpgsql security definer set search_path = public as $$
declare v_sub public.submissions;
begin
  if not public.is_reviewer() then raise exception '僅查核員可審核'; end if;
  if p_decision not in ('pass','fail','returned') then raise exception '無效的審核結果'; end if;

  update public.submissions
     set status = p_decision, review_comment = p_comment,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id and status = 'pending'
  returning * into v_sub;
  if v_sub.id is null then raise exception '找不到待審件'; end if;

  perform set_config('app.status_reason', coalesce(p_comment, '審核'), true);
  if p_decision = 'pass' then
    update public.stores
       set status = 'pass', fail_reason = null,
           equipment = trim(v_sub.purifier_model || coalesce(' ／濾芯 ' || v_sub.cartridge_model, '')),
           valid_until = (current_date + make_interval(months => p_valid_months))::date,
           last_reviewed_at = now()
     where id = v_sub.store_id;
  elsif p_decision = 'fail' then
    update public.stores
       set status = 'fail', fail_reason = p_comment, valid_until = null,
           last_reviewed_at = now()
     where id = v_sub.store_id;
  else  -- 退件補件：回到送件前的狀態
    update public.stores
       set status = case when status = 'submitted' then 'pending' else status end
     where id = v_sub.store_id;
  end if;
end $$;

create or replace function public.review_claim(
  p_id bigint, p_decision text, p_comment text default null,
  p_lat double precision default null, p_lng double precision default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_claim public.store_claims; v_store_id bigint;
begin
  if not public.is_reviewer() then raise exception '僅查核員可審核'; end if;
  if p_decision not in ('approved','rejected') then raise exception '無效的審核結果'; end if;

  select * into v_claim from public.store_claims where id = p_id and status = 'pending' for update;
  if v_claim.id is null then raise exception '找不到待審認領'; end if;

  v_store_id := v_claim.store_id;
  if p_decision = 'approved' then
    if v_store_id is null then
      if p_lat is null or p_lng is null then raise exception '新增店家需提供座標'; end if;
      insert into public.stores (name, address, area, category, lat, lng, phone, owner_id)
      values (v_claim.proposed_name, v_claim.proposed_address, v_claim.proposed_area,
              v_claim.proposed_category, p_lat, p_lng, v_claim.contact_phone, v_claim.user_id)
      returning id into v_store_id;
    else
      update public.stores set owner_id = v_claim.user_id where id = v_store_id;
    end if;
  end if;

  update public.store_claims
     set status = p_decision, review_comment = p_comment, store_id = v_store_id,
         reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  return v_store_id;
end $$;

-- ---------- 7. 逾期自動降回「未查核」（每日排程呼叫，同時防止專案閒置暫停） ----------
create or replace function public.expire_stale()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform set_config('app.status_reason', '合格逾期，自動降回未查核', true);
  update public.stores set status = 'pending'
   where status = 'pass' and valid_until is not null and valid_until < current_date;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.review_submission(bigint,text,text,int) from public, anon;
revoke execute on function public.review_claim(bigint,text,text,double precision,double precision) from public, anon;
grant  execute on function public.review_submission(bigint,text,text,int) to authenticated;
grant  execute on function public.review_claim(bigint,text,text,double precision,double precision) to authenticated;
grant  execute on function public.expire_stale() to anon, authenticated;

-- ---------- 8. 照片儲存桶（私有，1 張上限 2 MB） ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('submissions', 'submissions', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 路徑格式：{store_id}/{user_id}/{檔名}
drop policy if exists "submission photos upload by owner" on storage.objects;
create policy "submission photos upload by owner" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'submissions'
    and (storage.foldername(objects.name))[2] = auth.uid()::text
    and exists (
      select 1 from public.stores s
      where s.id::text = (storage.foldername(objects.name))[1] and s.owner_id = auth.uid()
    )
  );
drop policy if exists "submission photos read by owner or reviewer" on storage.objects;
create policy "submission photos read by owner or reviewer" on storage.objects
  for select to authenticated using (
    bucket_id = 'submissions'
    and ((storage.foldername(objects.name))[2] = auth.uid()::text or public.is_reviewer())
  );
