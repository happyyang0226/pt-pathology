-- pt-pathology : 물리치료사를 위한 병리학 문제풀이 웹앱 (같은 Supabase 프로젝트에 pa_ 접두어로 공존)
-- 학생: 학번+이름+PIN (security definer RPC) / 교수: Supabase Auth + professor_emails

create table if not exists public.pa_students (
  student_no text primary key,
  name       text not null,
  pin_hash   text not null,
  created_at timestamptz not null default now(),
  last_login timestamptz
);
create table if not exists public.pa_sessions (
  token      uuid primary key default gen_random_uuid(),
  student_no text not null references public.pa_students(student_no) on delete cascade,
  created_at timestamptz not null default now()
);
-- 문항 1회 풀이 = 1행 (정답 여부 · 확신도 · 틀린 이유 · 모드 · 소요 시간)
create table if not exists public.pa_attempts (
  id         bigint generated always as identity primary key,
  student_no text not null references public.pa_students(student_no) on delete cascade,
  qid        text not null,
  ch         int  not null,
  concept    text not null,
  chosen     text,
  correct    boolean not null,
  conf       text check (conf in ('sure','unsure','guess','exam')),
  err        text check (err in ('unknown','confused','misread')),
  mode       text check (mode in ('study','exam')),
  ms         int,
  created_at timestamptz not null default now()
);
create index if not exists pa_attempts_stu on public.pa_attempts(student_no, created_at);
create index if not exists pa_attempts_q   on public.pa_attempts(qid);
create index if not exists pa_sessions_stu on public.pa_sessions(student_no);

alter table public.pa_students enable row level security;
alter table public.pa_sessions enable row level security;
alter table public.pa_attempts enable row level security;

create or replace function public.pa_is_prof() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.professor_emails pe
                 where lower(pe.email) = lower(coalesce(auth.jwt()->>'email','')));
$$;

create policy "pa_students: 교수 조회" on public.pa_students for select to authenticated using ((select public.pa_is_prof()));
create policy "pa_students: 교수 삭제" on public.pa_students for delete to authenticated using ((select public.pa_is_prof()));
create policy "pa_attempts: 교수 조회" on public.pa_attempts for select to authenticated using ((select public.pa_is_prof()));
create policy "pa_attempts: 교수 삭제" on public.pa_attempts for delete to authenticated using ((select public.pa_is_prof()));

create or replace function public.pa_login(p_no text, p_name text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare s public.pa_students; t uuid;
begin
  p_no := trim(p_no); p_name := trim(p_name);
  if p_no !~ '^[0-9A-Za-z]{4,15}$' then raise exception '학번 형식을 확인하세요'; end if;
  if length(p_name) < 2 then raise exception '이름을 입력하세요'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN은 숫자 4~8자리입니다'; end if;
  select * into s from public.pa_students where student_no = p_no;
  if not found then
    insert into public.pa_students(student_no, name, pin_hash) values (p_no, p_name, crypt(p_pin, gen_salt('bf')));
  else
    if s.name <> p_name then raise exception '학번과 이름이 일치하지 않습니다'; end if;
    if s.pin_hash <> crypt(p_pin, s.pin_hash) then raise exception 'PIN이 틀렸습니다 (분실 시 교수님께 초기화 요청)'; end if;
  end if;
  update public.pa_students set last_login = now() where student_no = p_no;
  delete from public.pa_sessions where student_no = p_no and created_at < now() - interval '180 days';
  insert into public.pa_sessions(student_no) values (p_no) returning token into t;
  return json_build_object('token', t, 'student_no', p_no, 'name', p_name);
end $$;

create or replace function public.pa_who(p_token uuid) returns text
language sql stable security definer set search_path = public as $$
  select student_no from public.pa_sessions where token = p_token;
$$;

-- 풀이 기록 저장 (여러 행 한 번에, 최대 300행)
create or replace function public.pa_record(p_token uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare sno text; n int;
begin
  sno := public.pa_who(p_token);
  if sno is null then raise exception '로그인이 만료되었습니다. 다시 로그인하세요'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 300 then raise exception '기록 형식 오류'; end if;
  insert into public.pa_attempts(student_no, qid, ch, concept, chosen, correct, conf, err, mode, ms, created_at)
  select sno, left(r->>'qid',20), (r->>'ch')::int, left(r->>'concept',20), left(r->>'chosen',300),
         coalesce((r->>'correct')::boolean,false), r->>'conf', r->>'err', r->>'mode',
         least(greatest(coalesce((r->>'ms')::int,0),0), 3600000),
         least(coalesce((r->>'created_at')::timestamptz, now()), now())
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.pa_my(p_token uuid)
returns setof public.pa_attempts language sql stable security definer set search_path = public as $$
  select * from public.pa_attempts where student_no = public.pa_who(p_token) order by created_at;
$$;

create or replace function public.pa_reset_pin(p_no text, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.pa_is_prof() then raise exception '권한 없음'; end if;
  if p_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN은 숫자 4~8자리입니다'; end if;
  update public.pa_students set pin_hash = crypt(p_pin, gen_salt('bf')) where student_no = p_no;
  delete from public.pa_sessions where student_no = p_no;
end $$;

revoke all on function public.pa_login(text,text,text), public.pa_record(uuid,jsonb), public.pa_my(uuid),
  public.pa_who(uuid), public.pa_reset_pin(text,text), public.pa_is_prof() from public;
grant execute on function public.pa_login(text,text,text), public.pa_record(uuid,jsonb), public.pa_my(uuid) to anon, authenticated;
grant execute on function public.pa_reset_pin(text,text), public.pa_is_prof() to authenticated;
grant execute on function public.pa_is_prof() to anon;
