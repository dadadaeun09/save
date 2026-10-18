-- 그룹 자동 매칭용 테이블/함수. Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- 표는 RLS를 켜 두었고, 쓰기는 아래 함수(로그인한 사용자만 실행 가능)로만 합니다.
-- 읽기 정책은 "내가 속한 그룹"만 볼 수 있게 열어 두었습니다. (실시간 반영에 필요)
-- 그룹 최대 인원: 6명

create table if not exists public.match_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  uid text not null, name text not null, goal text,
  target numeric not null, pct numeric not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null, avg_target numeric not null,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  uid text not null, name text not null, goal_target numeric not null,
  shared_goal text, shared_pct numeric, shared_at timestamptz
);
alter table public.group_members add column if not exists joined_at timestamptz not null default now();
alter table public.match_queue   enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- 내가 속한 그룹 id (정책에서 쓰는 보조 함수)
create or replace function public.my_group_id() returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from group_members where user_id = auth.uid()
$$;
revoke all on function public.my_group_id() from public, anon;
grant execute on function public.my_group_id() to authenticated;

drop policy if exists "read my group members" on public.group_members;
create policy "read my group members" on public.group_members for select to authenticated
  using (user_id = auth.uid() or group_id = public.my_group_id());
drop policy if exists "read my group" on public.groups;
create policy "read my group" on public.groups for select to authenticated
  using (id = public.my_group_id());

-- 실시간(Realtime) 대상 테이블 등록
do $$ begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'group_members') then
    alter publication supabase_realtime add table public.group_members;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'groups') then
    alter publication supabase_realtime add table public.groups;
  end if;
end $$;

-- 그룹 평균 목표금액/이름 갱신, 멤버가 없으면 그룹 삭제 (서버 내부용)
create or replace function public.refresh_group(gid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare a numeric; n int;
begin
  select avg(goal_target), count(*) into a, n from group_members where group_id = gid;
  if n = 0 then
    delete from groups where id = gid;
  else
    update groups set avg_target = a, name = round(a / 10000)::bigint || '만원 목표 저축 모임' where id = gid;
  end if;
end $$;
revoke all on function public.refresh_group(uuid) from public, anon, authenticated;

-- 내 그룹/대기 상태
create or replace function public.my_group_state() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); gid uuid;
begin
  if me is null then raise exception 'login required'; end if;
  select group_id into gid from group_members where user_id = me;
  if gid is null then
    return jsonb_build_object('group', null, 'members', '[]'::jsonb,
      'waiting', exists (select 1 from match_queue where user_id = me));
  end if;
  return jsonb_build_object(
    'group', (select to_jsonb(g) from groups g where g.id = gid),
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id, 'uid', m.uid, 'name', m.name,
        'shared_goal', m.shared_goal, 'shared_pct', m.shared_pct)
        order by m.joined_at, m.user_id), '[]'::jsonb)
      from group_members m where m.group_id = gid),
    'waiting', false);
end $$;

-- 1) 자리가 남은(6명 미만) 기존 그룹 중 평균 목표금액이 ±30% 이내면 그 그룹에 참여
-- 2) 없으면 대기 중인 비슷한 사람(±30%)과 새 그룹 생성 (최대 6명)
-- 3) 그래도 없으면 대기열에 등록하고 waiting=true
create or replace function public.find_match(p_target numeric, p_goal text, p_pct numeric, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_uid text := split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1);
  pc numeric := least(greatest(coalesce(p_pct, 0), 0), 100);
  ids uuid[]; gid uuid;
begin
  if me is null then raise exception 'login required'; end if;
  if p_target is null or p_target <= 0 then raise exception 'invalid target'; end if;
  perform pg_advisory_xact_lock(hashtext('find_match'));  -- 동시에 매칭돼도 인원이 6명을 넘지 않게 한 줄로 처리
  if exists (select 1 from group_members where user_id = me) then return my_group_state(); end if;

  select g.id into gid from groups g
  where abs(g.avg_target - p_target) <= 0.3 * p_target
    and (select count(*) from group_members m where m.group_id = g.id) < 6
  order by abs(g.avg_target - p_target), g.created_at
  limit 1;
  if gid is not null then
    insert into group_members (user_id, group_id, uid, name, goal_target, shared_goal, shared_pct, shared_at)
    values (me, gid, my_uid, left(p_name, 30), p_target, left(p_goal, 40), pc, now());
    delete from match_queue where user_id = me;
    perform refresh_group(gid);
    return my_group_state();
  end if;

  select array_agg(user_id) into ids from (
    select user_id from match_queue
    where user_id <> me
      and abs(target - p_target) <= 0.3 * p_target
      and abs(target - p_target) <= 0.3 * target
    order by abs(target - p_target), created_at
    limit 5) q;

  if ids is null then
    insert into match_queue (user_id, uid, name, goal, target, pct)
    values (me, my_uid, left(p_name, 30), left(p_goal, 40), p_target, pc)
    on conflict (user_id) do update
      set uid = excluded.uid, name = excluded.name, goal = excluded.goal,
          target = excluded.target, pct = excluded.pct;
    return my_group_state();
  end if;

  insert into groups (name, avg_target) values ('', 0) returning id into gid;
  insert into group_members (user_id, group_id, uid, name, goal_target, shared_goal, shared_pct, shared_at)
  select q.user_id, gid, q.uid, q.name, q.target, q.goal, q.pct, now()
  from match_queue q where q.user_id = any(ids);
  insert into group_members (user_id, group_id, uid, name, goal_target, shared_goal, shared_pct, shared_at)
  values (me, gid, my_uid, left(p_name, 30), p_target, left(p_goal, 40), pc, now());
  delete from match_queue where user_id = any(ids) or user_id = me;
  perform refresh_group(gid);
  return my_group_state();
end $$;

create or replace function public.cancel_match() returns void
language sql security definer set search_path = public as $$
  delete from match_queue where user_id = auth.uid();
$$;

-- 내 달성률 갱신 (화면에서 목표가 바뀌면 자동으로 호출)
create or replace function public.share_progress(p_goal text, p_pct numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update group_members set shared_goal = left(p_goal, 40),
    shared_pct = least(greatest(coalesce(p_pct, 0), 0), 100), shared_at = now()
  where user_id = auth.uid();
  return my_group_state();
end $$;

create or replace function public.leave_group() returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  delete from group_members where user_id = auth.uid() returning group_id into gid;
  if gid is not null then perform refresh_group(gid); end if;
  delete from match_queue where user_id = auth.uid();
end $$;

revoke all on function public.my_group_state(), public.find_match(numeric, text, numeric, text),
  public.cancel_match(), public.share_progress(text, numeric), public.leave_group()
  from public, anon;
grant execute on function public.my_group_state(), public.find_match(numeric, text, numeric, text),
  public.cancel_match(), public.share_progress(text, numeric), public.leave_group()
  to authenticated;

-- 이름 변경을 그룹/대기열에도 반영 (마이 페이지에서 이름을 바꾸면 호출)
create or replace function public.set_my_name(p_name text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'login required'; end if;
  update group_members set name = left(p_name, 30) where user_id = auth.uid();
  update match_queue   set name = left(p_name, 30) where user_id = auth.uid();
  return my_group_state();
end $$;
revoke all on function public.set_my_name(text) from public, anon;
grant execute on function public.set_my_name(text) to authenticated;
