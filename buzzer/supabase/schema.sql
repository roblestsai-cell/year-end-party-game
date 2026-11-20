-- 尾牙搶答鈴：Supabase 資料庫結構
-- 用法：在「新的」Supabase 專案的 SQL Editor 貼上整份執行一次即可（可重複執行）。
-- 設計：
--   * 只有一個房間（id = 'main'）。
--   * 主持人 = 任何已登入的 Supabase Auth 使用者。請在 Supabase 關閉「Allow new users to sign up」，
--     並只在後台手動建立主持人帳號。
--   * 玩家不登入，只用姓名加入，取得一組隨機 token（存在玩家手機的瀏覽器）。
--   * 倒數開始、開放時間、誰最快，全部以「資料庫伺服器時間」判定，與玩家手機時間無關。

create extension if not exists pgcrypto;

-- ---------- 資料表 ----------
create table if not exists public.rooms (
  id            text primary key,
  round         integer     not null default 0,
  opens_at      timestamptz,            -- 本輪開放按鈴的時間（按下倒數後 +5 秒）
  winner_player uuid,                   -- 本輪得主
  winner_name   text,
  won_at        timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists public.players (
  id        uuid primary key default gen_random_uuid(),
  room_id   text not null references public.rooms(id) on delete cascade,
  name      text not null check (char_length(name) between 1 and 20),
  token     uuid not null default gen_random_uuid() unique,
  joined_at timestamptz not null default now()
);

insert into public.rooms (id) values ('main') on conflict (id) do nothing;

-- ---------- 權限 ----------
alter table public.rooms   enable row level security;
alter table public.players enable row level security;

revoke all on public.rooms, public.players from anon, authenticated;

-- 房間狀態（輪次、開放時間、得主）大家都能讀，玩家頁靠它同步
grant select on public.rooms to anon, authenticated;
drop policy if exists rooms_read on public.rooms;
create policy rooms_read on public.rooms for select to anon, authenticated using (true);

-- 玩家名單只有主持人能讀（token 欄位不開放）
grant select (id, room_id, name, joined_at) on public.players to authenticated;
drop policy if exists players_host_read on public.players;
create policy players_host_read on public.players for select to authenticated using (true);

-- ---------- 函式 ----------
-- 伺服器現在時間（毫秒），用來校正手機時鐘的倒數顯示
create or replace function public.server_now_ms()
returns bigint language sql stable as $$
  select (extract(epoch from clock_timestamp()) * 1000)::bigint;
$$;

-- 玩家用姓名加入
create or replace function public.join_game(p_name text)
returns table (player_id uuid, token uuid, name text)
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if char_length(v_name) < 1 or char_length(v_name) > 20 then
    raise exception 'name_invalid';
  end if;
  return query
    insert into players (room_id, name) values ('main', v_name)
    returning players.id, players.token, players.name;
end $$;

-- 用 token 找回玩家（重新整理頁面時）
create or replace function public.whoami(p_token uuid)
returns table (player_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select id, players.name from players where token = p_token;
$$;

-- 玩家按鈴。回傳：won / late / too_early / stale / not_open / invalid
create or replace function public.buzz(p_token uuid, p_round integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_player players%rowtype;
  v_room   rooms%rowtype;
  v_now    timestamptz := clock_timestamp();
begin
  select * into v_player from players where token = p_token;
  if not found then return 'invalid'; end if;

  -- 原子搶答：同一列只有第一個成功的 UPDATE 會設到得主
  update rooms
     set winner_player = v_player.id, winner_name = v_player.name,
         won_at = v_now, updated_at = v_now
   where id = 'main' and round = p_round and opens_at is not null
     and opens_at <= v_now and winner_player is null;
  if found then return 'won'; end if;

  select * into v_room from rooms where id = 'main';
  if v_room.round <> p_round then return 'stale'; end if;
  if v_room.opens_at is null then return 'not_open'; end if;
  if v_room.opens_at > v_now then return 'too_early'; end if;
  if v_room.winner_player = v_player.id then return 'won'; end if;
  return 'late';
end $$;

-- 主持人按「開始倒數」：進入下一輪，5 秒後開放
create or replace function public.start_round()
returns rooms
language plpgsql security definer set search_path = public as $$
declare
  v_room rooms%rowtype;
  v_now  timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'host_only'; end if;
  select * into v_room from rooms where id = 'main' for update;
  -- 倒數中重複按不會重開，避免連點
  if v_room.opens_at is not null and v_room.opens_at > v_now then
    return v_room;
  end if;
  update rooms
     set round = round + 1, opens_at = v_now + interval '5 seconds',
         winner_player = null, winner_name = null, won_at = null, updated_at = v_now
   where id = 'main'
  returning * into v_room;
  return v_room;
end $$;

-- 主持人清空名單（新場次用）
create or replace function public.clear_players()
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'host_only'; end if;
  delete from players where room_id = 'main';
  update rooms set round = 0, opens_at = null, winner_player = null,
         winner_name = null, won_at = null, updated_at = clock_timestamp()
   where id = 'main';
end $$;

revoke all on function public.join_game(text), public.whoami(uuid), public.buzz(uuid, integer),
  public.start_round(), public.clear_players() from public;
grant execute on function public.server_now_ms() to anon, authenticated;
grant execute on function public.join_game(text), public.whoami(uuid), public.buzz(uuid, integer)
  to anon, authenticated;
grant execute on function public.start_round(), public.clear_players() to authenticated;

-- ---------- 即時同步 ----------
do $$ begin
  begin alter publication supabase_realtime add table public.rooms;   exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.players; exception when duplicate_object then null; end;
end $$;
