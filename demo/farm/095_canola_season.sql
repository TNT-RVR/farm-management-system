-- The canola screens that were empty in the demo (all made up): the flowering
-- season the satellite run keeps for each canola field, what someone saw when
-- they walked it, the sclerotinia checklist two fields were scored on, the
-- bees that came in for the seed field, and the seed company's harvest report
-- for it. Runs after 070_agronomy.sql and 075_satellite.sql.

-- Two more contacts the season needs.
insert into public.contacts (id, company, contact_name, email, phone, type, notes_md, tags, active, address) values
  ('0de30000-0000-4000-8000-000000000315', 'Clearwater Apiaries', 'Noah Reimer', 'user-5fdb@clearwaterapiaries.example', '403-555-0285', 'other',
   'Brings hives onto the canola in July and takes them off before desiccation. Wants a text the day before any spray.', '{pollinators}', true, 'Prairie Creek, AB'),
  ('0de30000-0000-4000-8000-000000000316', 'Ridgeline Genetics', 'Alex Fenwick', 'user-b094@ridgelinegenetics.example', '403-555-0296', 'buyer',
   'Hybrid canola seed contract on Correction Line. Supplies the leafcutter shelters and the bees in them.', '{seed}', true, null);

-- ── How the app reads a yellow field (Canola → Bloom → Settings) ──────────
insert into public.canola_bloom_settings (id, start_fraction, window_fraction, full_fraction, end_fraction,
  gate_gdd, latest_gdd, typical_start_gdd, haze_blue_max, haze_aot_max, min_valid, blind_days, variety_gate, updated_by)
values (1, 0.10, 0.25, 0.50, 0.10, 450, 1150, 560, 0.08, 0.4, 0.3, 6,
        '{"Ridgeline RL45": 0.08}'::jsonb, '0de30000-0000-4000-8000-0000000000a1');

-- ── This season's flowering, field by field ──────────────────────────────
-- Every canola field this year: flowering started in the first week of July,
-- peaked a week later and was over by the end of the month. `looks` is what
-- the satellite saw, the share of the crop yellow on each pass.
with canola as (
  select p.field_id, f.name, row_number() over (order by f.name)::int as n
    from public.crop_plans p
    join public.crops c on c.id = p.crop_id
    join public.fields f on f.id = p.field_id
   where p.crop_year = extract(year from current_date)::int and c.name = 'Canola'
), season as (
  select field_id, name, n,
         make_date(extract(year from current_date)::int, 5, 10) + n as seeded,
         make_date(extract(year from current_date)::int, 7, 2) + n as started,
         make_date(extract(year from current_date)::int, 7, 11) + n as peak,
         make_date(extract(year from current_date)::int, 7, 25) + n as ended
    from canola
)
insert into public.canola_bloom (field_id, crop_year, status, seeded_on, gdd, last_clear_on, yellow_now, started_on,
  peak_fraction, peak_on, ended_on, notified_start_at, notified_end_at, stage, confidence, baseline, model_score,
  station_id, forecast_start_on, typical_start_gdd, notified, truth_on, truth_source, gdd_at_truth, gdd_at_start,
  first_fungicide_on, looks)
select s.field_id, extract(year from current_date)::int, 'over', s.seeded,
       1180 + s.n * 12, s.ended + 14, 0,
       s.started,
       round((0.52 + s.n * 0.03)::numeric, 2), s.peak, s.ended,
       s.started + 1, s.ended + 2,
       'over', case when s.n % 3 = 0 then 'medium' else 'high' end,
       round((0.04 + s.n * 0.005)::numeric, 3), round((0.83 + s.n * 0.01)::numeric, 2),
       '0de30000-0000-4000-8000-000000000b01', s.started - 4, 560,
       jsonb_build_object('start', (s.started + 1)::text, 'end', (s.ended + 2)::text),
       s.started + 2, 'scouting', 612 + s.n * 9, 578 + s.n * 9,
       case when s.n % 3 = 0 then null else s.started + 6 end,
       (select jsonb_agg(jsonb_build_object('d', (s.started - 12 + g * 5)::text,
                                            's', round(l.share::numeric, 3),
                                            'ok', l.share is not null,
                                            'src', 'sat')
                         order by g)
          from generate_series(0, 9) g
          cross join lateral (
            select case when g = 4 then null
                        else greatest(0, (0.56 + s.n * 0.03) * exp(-power((g - 4.6) / 2.1, 2)) - 0.01)
                   end as share
          ) l)
from season s;

-- What someone saw when they walked it, which is what the model is judged on.
insert into public.canola_bloom_scouting (field_id, crop_year, seen_on, bloom_pct, note, created_by)
select b.field_id, b.crop_year, b.started_on + v.days, v.pct, v.note, '0de30000-0000-4000-8000-0000000000a2'
from public.canola_bloom b
join (values
  (0,  12, 'First flowers on the main stem this morning — call it 10 %.'),
  (5,  35, null),
  (12, 55, 'Full bloom, petals dropping on the tramlines.'),
  (22,  8, 'Nearly done; pods filling on the bottom third.')
) as v(days, pct, note) on true
where b.crop_year = extract(year from current_date)::int;

-- ── The sclerotinia checklist (Canola → Sclerotinia) ─────────────────────
-- Alberta's fifteen-question sheet, filled in a few days after first flower.
-- The two irrigated fields scored high enough to spray; the dry one did not.
insert into public.sclerotinia_checklists (field_id, crop_year, answers, notes, filled_on)
select v.field::uuid, extract(year from current_date)::int, v.answers::jsonb, v.notes,
       make_date(extract(year from current_date)::int, 7, 6)
from (values
  ('0de30000-0000-4000-8000-000000000113',
   '{"1":20,"2":20,"3":10,"4":20,"5":20,"6":10,"7":20,"8":20,"9":20,"10":20,"11":20,"12":20,"13":20,"14":20,"15":20}',
   'Under the pivot, thick stand, canola here three years ago and stem rot that year. Sprayed at 25 % bloom.'),
  ('0de30000-0000-4000-8000-000000000105',
   '{"1":20,"2":20,"3":10,"4":20,"5":10,"6":10,"7":20,"8":20,"9":10,"10":20,"11":20,"12":20,"13":20,"14":10,"15":20}',
   'Dryland, but the slough keeps the middle of this field humid and it has had stem rot before. Sprayed the same day while the sprayer was out.'),
  ('0de30000-0000-4000-8000-000000000110',
   '{"1":0,"2":10,"3":5,"4":10,"5":0,"6":0,"7":0,"8":10,"9":10,"10":10,"11":0,"12":10,"13":10,"14":0,"15":0}',
   'Dryland, thin stand after a dry June, no rain in the forecast at flowering. Section two did not clear: left it.')
) as v(field, answers, notes);

-- ── Bees (Canola → Pollinators) ──────────────────────────────────────────
insert into public.bee_placements (field_id, crop_year, kind, placed_on, removed_on, units, contact_id, note, created_by)
select v.field::uuid, extract(year from current_date)::int, v.kind,
       make_date(extract(year from current_date)::int, 7, v.in_day),
       case when v.out_day is null then null else make_date(extract(year from current_date)::int, 7, v.out_day) end,
       v.units, v.contact::uuid, v.note, '0de30000-0000-4000-8000-0000000000a1'
from (values
  ('0de30000-0000-4000-8000-000000000110', 'leafcutter', 2, 28, 16, '0de30000-0000-4000-8000-000000000316',
   'Seed contract: four shelters on the north side, four on the east. Nothing with a bee warning while they are in.'),
  ('0de30000-0000-4000-8000-000000000113', 'honey', 4, 27, 24, '0de30000-0000-4000-8000-000000000315',
   'Hives on the pivot road allowance. Texted before the fungicide went on.'),
  ('0de30000-0000-4000-8000-000000000102', 'honey', 4, 27, 16, '0de30000-0000-4000-8000-000000000315', null)
) as v(field, kind, in_day, out_day, units, contact, note);

-- ── The seed company's harvest report (Canola → Seed forms) ──────────────
-- Hybrid seed canola is grown on contract and the company wants a report of
-- what came off and which bins it went into.
insert into public.seed_reports (id, company, crop_year, field_id, grower_name, field_number, spin_code, legal_land,
  gps_acres, total_kg, weight_method, scale_certified, storage, harvest_completed_on, weather, acknowledged, created_by)
values
  ('0de30000-0000-4000-8000-00000000d101', 'Ridgeline Genetics', extract(year from current_date)::int,
   '0de30000-0000-4000-8000-000000000110', 'Prairie Creek Farm Ltd.', 'CL-1', 'RG-00412', 'NE-15-42-25-W4',
   148.60, 62400.0, 'platform', true, 'home', current_date - 29,
   'Straight-cut dry, 8.4 % moisture off the field. Two days lost to rain mid-week.', true,
   '0de30000-0000-4000-8000-0000000000a1');

insert into public.seed_report_bins (report_id, bin_id, company_bin_id, quantity_kg, moisture_pct, seed_temp_c,
  temp_cables, moisture_cables, aeration, bottom, shipped_on, sort)
values
  ('0de30000-0000-4000-8000-00000000d101', '0de30000-0000-4000-8000-000000000501', 'RG-B1', 33800.0, 8.4, 11.5, true, false, true, 'coned', null, 1),
  ('0de30000-0000-4000-8000-00000000d101', '0de30000-0000-4000-8000-000000000502', 'RG-B2', 28600.0, 8.6, 12.0, true, false, true, 'coned', null, 2);
