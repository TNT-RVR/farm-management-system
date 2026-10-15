-- What's new (the weekly summary of changes to the app, for the Monday
-- meeting): one example week, so the page is not empty. In a real copy the AI
-- writes each week from the app's own commits; here the AI is off, so this
-- week is made up and says so. The commit ids are placeholders, shown as
-- plain text (no repository address is recorded, so nothing links out).
-- Runs before 090_finish.sql, which clears the change log the build leaves.

insert into public.app_change_weeks (week_start, week_end, items, commits, status, model, written_at)
values (
  (date_trunc('week', current_date) - interval '7 days')::date,
  (date_trunc('week', current_date) - interval '1 day')::date,
  '[
    {"area": "Example", "title": "This week is an example",
     "detail": "Example — written for this made-up farm. In your own copy, the AI writes this list every Monday from the changes made to your app that week.",
     "link": null, "commits": []},
    {"area": "Fields", "title": "Click any field row to open, edit or delete it",
     "detail": "Field, contact and task lists open a record when you click a row, with edit and delete in the same place.",
     "link": "/fields", "commits": ["0de3a11", "0de3a12"]},
    {"area": "Harvest", "title": "Bin cable readings can be corrected",
     "detail": "A mistyped temperature or moisture reading can now be fixed instead of deleted and entered again.",
     "link": "/harvest", "commits": ["0de3a13"]},
    {"area": "Irrigation", "title": "Pump and pivot photos as thumbnails",
     "detail": "Nameplate photos show as small pictures on each pump; tap one to step through them, rename or remove.",
     "link": "/irrigation", "commits": ["0de3a14"]},
    {"area": "Reports", "title": "Every report backed up to Google Drive",
     "detail": "Once Google Drive is connected in Farm setup, each report is kept there as a CSV and a PDF, updated every few hours.",
     "link": "/reports", "commits": ["0de3a15", "0de3a16"]}
  ]'::jsonb,
  '[
    {"sha": "0de3a11", "date": "", "subject": "Fields, contacts and tasks: click a row for its detail, with edit, add and delete"},
    {"sha": "0de3a12", "date": "", "subject": "One shared record editor for click-a-row, add, edit and delete"},
    {"sha": "0de3a13", "date": "", "subject": "Bin cable readings can be corrected"},
    {"sha": "0de3a14", "date": "", "subject": "Pump and pivot photos show as thumbnails, with a viewer"},
    {"sha": "0de3a15", "date": "", "subject": "Every report backed up to Google Drive as a CSV and a PDF"},
    {"sha": "0de3a16", "date": "", "subject": "Drive backup status on the Farm setup card"}
  ]'::jsonb,
  'done', 'example (AI is off in the demo)', now() - interval '2 days'
)
on conflict (week_start) do nothing;
