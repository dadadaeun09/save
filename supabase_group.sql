-- 그룹 자동 매칭용 테이블/함수. Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 Run 하세요. (여러 번 실행해도 안전)
-- 표는 RLS를 켜고 정책을 만들지 않아 직접 접근이 막혀 있고, 아래 함수(로그인한 사용자만 실행 가능)로만 읽고 씁니다.

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
alter table public.match_queue   enable row level security;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

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
        'shared_goal', m.shared_goal, 'shared_pct', m.shared_pct, 'shared_at', m.shared_at)
        order by m.shared_at nulls last), '[]'::jsonb)
      from group_members m where m.group_id = gid),
    'waiting', false);
end $$;

-- 목표금액이 비슷한(±30%) 대기자를 찾아 그룹 생성. 없으면 대기열에 등록하고 waiting=true
create or replace function public.find_match(p_target numeric, p_goal text, p_pct numeric, p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  my_uid text := split_part(coalesce(auth.jwt() ->> 'email', ''), '@', 1);
  ids uuid[]; gid uuid; avg numeric;
begin
  if me is null then raise exception 'login required'; end if;
  if p_target is null or p_target <= 0 then raise exception 'invalid target'; end if;
  if exists (select 1 from group_members where user_id = me) then return my_group_state(); end if;

  select array_agg(user_id) into ids from (
    select user_id from match_queue
    where user_id <> me
      and abs(target - p_target) <= 0.3 * p_target
      and abs(target - p_target) <= 0.3 * target
    order by abs(target - p_target), created_at
    limit 4 for update skip locked) q;

  if ids is null then
    insert into match_queue (user_id, uid, name, goal, target, pct)
    values (me, my_uid, left(p_name, 30), left(p_goal, 40), p_target, least(greatest(coalesce(p_pct, 0), 0), 100))
    on conflict (user_id) do update
      set uid = excluded.uid, name = excluded.name, goal = excluded.goal,
          target = excluded.target, pct = excluded.pct;
    return my_group_state();
  end if;

  select (sum(target) + p_target) / (count(*) + 1) into avg from match_queue where user_id = any(ids);
  insert into groups (name, avg_target)
  values (round(avg / 10000)::bigint || '만원 목표 저축 모임', avg) returning id into gid;

  insert into group_members (user_id, group_id, uid, name, goal_target, shared_goal, shared_pct, shared_at)
  select q.user_id, gid, q.uid, q.name, q.target, q.goal, q.pct, now()
  from match_queue q where q.user_id = any(ids);
  insert into group_members (user_id, group_id, uid, name, goal_target, shared_goal, shared_pct, shared_at)
  values (me, gid, my_uid, left(p_name, 30), p_target, left(p_goal, 40),
          least(greatest(coalesce(p_pct, 0), 0), 100), now());

  delete from match_queue where user_id = any(ids) or user_id = me;
  return my_group_state();
end $$;

create or replace function public.cancel_match() returns void
language sql security definer set search_path = public as $$
  delete from match_queue where user_id = auth.uid();
$$;

create or replace function public.share_progress(p_goal text, p_pct numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update group_members set shared_goal = left(p_goal, 40),
    shared_pct = least(greatest(coalesce(p_pct, 0), 0), 100), shared_at = now()
  where user_id = auth.uid();
  return my_group_state();
end $$;

create or replace function public.stop_sharing() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update group_members set shared_goal = null, shared_pct = null, shared_at = null where user_id = auth.uid();
  return my_group_state();
end $$;

create or replace function public.leave_group() returns void
language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  delete from group_members where user_id = auth.uid() returning group_id into gid;
  if gid is not null and not exists (select 1 from group_members where group_id = gid) then
    delete from groups where id = gid;
  end if;
  delete from match_queue where user_id = auth.uid();
end $$;

revoke all on function public.my_group_state(), public.find_match(numeric, text, numeric, text),
  public.cancel_match(), public.share_progress(text, numeric), public.stop_sharing(), public.leave_group()
  from public, anon;
grant execute on function public.my_group_state(), public.find_match(numeric, text, numeric, text),
  public.cancel_match(), public.share_progress(text, numeric), public.stop_sharing(), public.leave_group()
  to authenticated;
