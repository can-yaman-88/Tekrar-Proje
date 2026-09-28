-- Demo data for manual end-to-end testing.
-- Run AFTER signing up in the app; attaches data to the most recently created user.
-- Safe to re-run: removes that user's previous demo courses first.
do $$
declare
  v_user uuid;
  v_today date := current_date;
  c_statics uuid; c_thermo uuid; c_phys uuid; c_chem uuid;
  t_truss uuid; t_frames uuid; t_carnot uuid; t_first_law uuid; t_gauss uuid; t_equil uuid;
  e_statics uuid; e_thermo uuid;
begin
  select id into v_user from auth.users order by created_at desc limit 1;
  if v_user is null then
    raise exception 'No users yet — sign up in the app first.';
  end if;

  delete from public.courses where user_id = v_user and code in ('ME 201', 'ME 204', 'PHYS 102', 'CHEM 101');

  insert into public.courses (user_id, code, name, color_hex) values
    (v_user, 'ME 201', 'Statics', '#3451D1') returning id into c_statics;
  insert into public.courses (user_id, code, name, color_hex) values
    (v_user, 'ME 204', 'Thermodynamics', '#C0582F') returning id into c_thermo;
  insert into public.courses (user_id, code, name, color_hex) values
    (v_user, 'PHYS 102', 'Physics 2', '#7B4FD6') returning id into c_phys;
  insert into public.courses (user_id, code, name, color_hex) values
    (v_user, 'CHEM 101', 'Chemistry', '#0F8B8D') returning id into c_chem;

  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_statics, 'Trusses (method of joints & sections)', 5) returning id into t_truss;
  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_statics, 'Frames and machines', 6) returning id into t_frames;
  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_thermo, 'Carnot cycle', 7) returning id into t_carnot;
  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_thermo, 'First law for closed systems', 4) returning id into t_first_law;
  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_phys, 'Gauss''s law', 3) returning id into t_gauss;
  insert into public.topics (user_id, course_id, title, week_number) values
    (v_user, c_chem, 'Chemical equilibrium', 6) returning id into t_equil;

  insert into public.exams (user_id, course_id, kind, title, exam_date) values
    (v_user, c_statics, 'midterm', 'Midterm 1', v_today + 3) returning id into e_statics;
  insert into public.exams (user_id, course_id, kind, title, exam_date) values
    (v_user, c_thermo, 'midterm', 'Midterm 1', v_today + 9) returning id into e_thermo;
  insert into public.exams (user_id, course_id, kind, title, exam_date) values
    (v_user, c_phys, 'quiz', 'Quiz 2', v_today + 16),
    (v_user, c_chem, 'final', 'Final', v_today + 40);

  insert into public.exam_topics (exam_id, topic_id, user_id) values
    (e_statics, t_truss, v_user), (e_statics, t_frames, v_user),
    (e_thermo, t_carnot, v_user), (e_thermo, t_first_law, v_user);

  insert into public.tasks (user_id, topic_id, type, title, target_count, estimated_minutes, due_date, source) values
    (v_user, t_truss,     'problem_set',    'Solve 30 truss problems',                    30, 120, v_today,     'ai_weekly_plan'),
    (v_user, t_carnot,    'problem_set',    'Carnot cycle efficiency set',                10,  60, v_today,     'ai_weekly_plan'),
    (v_user, t_gauss,     'derivation',     'Derive E-field of a charged sphere',       null,  30, v_today,     'ai_weekly_plan'),
    (v_user, t_first_law, 'concept_review', 'Re-read first-law sign conventions',       null,  25, v_today - 2, 'ai_weekly_plan'),
    (v_user, t_frames,    'problem_set',    'Frames: 12 multi-body problems',             12,  90, v_today + 1, 'ai_weekly_plan'),
    (v_user, t_equil,     'problem_set',    'ICE-table equilibrium problems',             15,  60, v_today + 2, 'ai_weekly_plan');

  raise notice 'Demo data created for user %', v_user;
end $$;
