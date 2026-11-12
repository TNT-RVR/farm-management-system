-- Cattle screens that were still empty in the demo (all made up): next
-- season's grazing plan and the gates between the pastures, which brand is
-- whose, dugout water tests, and the pasture-insurance paperwork for the
-- ranch. Runs after 040_cattle.sql and 041_pastures.sql (it reads their
-- ranches, pastures, herd groups and water points).

-- ── Which forage row the estimator reads (Cattle → Grazing → Calculator) ──
-- forage_zone_mm is a classification of where a ranch is, not a measurement,
-- and the migration that added it only filled the farm's own ranches. Null
-- would send the demo back to its measured rainfall; both demo ranches sit in
-- parkland on Black soil, which is the manual's 475 mm row.
update public.ranches set forage_zone_mm = 475
 where id in ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000402');

-- ── The grazing plan (Cattle → Grazing → Planner) ──────────────────────────
-- Two years of it: what was planned for this season, and the plan for next
-- season, which is the one the planner opens from August on. Each stay starts
-- the day the last one ends, the way the planner builds them.
insert into public.grazing_plan (ranch_id, plan_year, herd_count_id, pasture_id, start_date, end_date, head_count, notes, sort_order)
select v.ranch::uuid, extract(year from current_date)::int + y.ahead, v.herd::uuid, v.pasture::uuid,
       make_date(extract(year from current_date)::int + y.ahead, v.from_m, v.from_d),
       make_date(extract(year from current_date)::int + y.ahead, v.to_m, v.to_d),
       v.head, case when y.ahead = 1 then v.note end, v.sort
from (values
  -- Willow Ridge: the summer rotation through the four paddocks.
  ('0de30000-0000-4000-8000-000000000402', '0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000411',  5, 20,  6, 25, 104, 'Turn out when the native grass is at three leaves, not by the calendar.', 1),
  ('0de30000-0000-4000-8000-000000000402', '0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000412',  6, 25,  7, 20, 104, 'Bulls in on the move out of here.', 2),
  ('0de30000-0000-4000-8000-000000000402', '0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000413',  7, 20,  8, 25, 104, null, 3),
  ('0de30000-0000-4000-8000-000000000402', '0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000414',  8, 25, 10,  1, 104, 'Last on the bush quarter: it was grazed hard this year and wants the rest.', 4),
  -- Home Ranch: two passes on the yard pasture, then the hay aftermath.
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000415',  5, 15,  6, 20, 197, null, 1),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000416',  6, 20,  8, 10, 197, 'Water is the dugout here — check the solar pump before they go in.', 2),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000415',  8, 10,  9, 20, 197, 'Second pass once it has come back.', 3),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000417',  9, 20, 11,  5, 225, 'Bred heifers join the pairs on the aftermath.', 4)
) as v(ranch, herd, pasture, from_m, from_d, to_m, to_d, head, note, sort)
cross join (values (0), (1)) as y(ahead);

-- ── Gates between pastures ────────────────────────────────────────────────
-- The planner warns when a move has no gate between the two pastures, so the
-- ones that exist are drawn on the map.
insert into public.pasture_gates (pasture_a, pasture_b, gate_geom, note, source, is_open, width_ft) values
  ('0de30000-0000-4000-8000-000000000411', '0de30000-0000-4000-8000-000000000412', st_setsrid(st_makepoint(-113.6793, 52.3894), 4326), 'Wire gate in the north-west corner.', 'manual', false, 16),
  ('0de30000-0000-4000-8000-000000000412', '0de30000-0000-4000-8000-000000000413', st_setsrid(st_makepoint(-113.6680, 52.3858), 4326), null, 'manual', true, 20),
  ('0de30000-0000-4000-8000-000000000413', '0de30000-0000-4000-8000-000000000414', st_setsrid(st_makepoint(-113.6681, 52.3786), 4326), 'Narrow: let them through a few at a time.', 'manual', false, 10),
  ('0de30000-0000-4000-8000-000000000415', '0de30000-0000-4000-8000-000000000416', st_setsrid(st_makepoint(-113.5559, 52.4572), 4326), 'Panel gate on the yard side of the fence line.', 'manual', true, 14),
  ('0de30000-0000-4000-8000-000000000415', '0de30000-0000-4000-8000-000000000417', st_setsrid(st_makepoint(-113.5440, 52.4487), 4326), 'Across the approach — shut it before haying.', 'manual', false, 20);

-- ── Brands (Cattle → Animals) ─────────────────────────────────────────────
insert into public.cattle_brand_ranch (brand, ranch_id, note, updated_by)
select v.brand, v.ranch::uuid, v.note, (select id from public.users order by created_at limit 1)
from (values
  ('PC lazy bar', '0de30000-0000-4000-8000-000000000401', 'The farm brand, left hip. Everything born here carries it.'),
  ('Y bar',       '0de30000-0000-4000-8000-000000000402', 'Older brand on the cows that came with Willow Ridge; not used on calves any more.')
) as v(brand, ranch, note);

-- ── Dugout and trough water tests (Cattle → Papers → Water) ───────────────
insert into public.cattle_water_tests (water_id, sampled_on, lab, tds_mg_l, so4_mg_l, no3n_mg_l, na_mg_l, k_mg_l, cl_mg_l,
  alkalinity_mg_l, hardness_mg_l, ph, ec_us_cm, fe_mg_l, cu_mg_l, mo_mg_l, se_mg_l, mn_mg_l, f_mg_l,
  total_n_ug_l, total_p_ug_l, microcystin_ug_l, bloom_seen, notes, created_by)
select w.id, v.sampled, 'Central Feed Testing Lab', v.tds, v.so4, v.no3n, v.na, v.k, v.cl,
       v.alk, v.hard, v.ph, v.ec, v.fe, v.cu, v.mo, v.se, v.mn, v.f,
       v.tn, v.tp, v.mc, v.bloom, v.notes, (select id from public.users order by created_at limit 1)
from (values
  ('North dugout',     current_date - 150, 1480, 620, 1.2, 190, 14, 65, 310, 540, 8.1, 2280, 0.18, 0.004, 0.021, 0.002, 0.09, 0.3,  980, 120, null::numeric, false, 'Sulphate is high but under the 1,000 mg/L the cows have been drinking for years. Worth a second test in a dry August, when it concentrates.'),
  ('South dugout',     current_date - 150,  910, 280, 0.8, 110,  9, 38, 240, 360, 7.9, 1420, 0.11, 0.003, 0.009, 0.001, 0.05, 0.2,  640,  85, null,           false, 'Good water. Fenced, gravity line to the trough.'),
  ('Hay Flat slough',  current_date - 42,  2240, 980, 2.4, 350, 22, 120, 410, 720, 8.6, 3310, 0.26, 0.006, 0.048, 0.004, 0.22, 0.5, 2600, 410, 4.8,           true,  'Green and thick along the north shore when it was sampled. Over the 1.5 ug/L guideline for microcystin: this one is fenced out and the cows water at the trough.'),
  ('Yard trough',      current_date - 300,  640, 120, 0.4,  60,  6, 22, 210, 300, 7.6,  980, 0.05, 0.002, 0.004, 0.001, 0.02, 0.1,  220,  30, null,           false, 'Off the yard well. Tested when the new pressure system went in.')
) as v(water, sampled, tds, so4, no3n, na, k, cl, alk, hard, ph, ec, fe, cu, mo, se, mn, f, tn, tp, mc, bloom, notes)
join public.cattle_water w on w.name = v.water;

-- ── Pasture insurance (Cattle → Papers → Insurance) ───────────────────────
-- The yearly moisture-deficiency election for the ranch, and the pasture
-- quarters it covers. The identification number and the weather stations are
-- made up, as is the farm.
insert into public.afsc_mdi_year (crop_year, ranch_id, identification_number, business_name, business_address, gst_bn,
  contact_person, contact_phone, contact_email, home_part, home_section, home_township, home_range, home_meridian,
  station_1, station_2, station_3, coverage_option, price_per_lb, insure_native, insure_improved, insure_bush, insure_community, notes)
values
  (extract(year from current_date)::int + 1, '0de30000-0000-4000-8000-000000000401', '00-123456', 'Prairie Creek Farm Ltd.',
   'Box 41, Prairie Creek, AB  T0A 1A0', '00-123456 RT0001', 'Sam Demo', '403-555-0100', 'user-2a97@prairiecreek.example',
   'SE', '14', '42', '25', 'W4', 'Prairie Creek East (example)', 'Willow Ridge (example)', 'Correction Line (example)',
   'B', 0.095, true, true, false, false,
   'Example election for the demo farm. Option B on both native and improved grass; the deadline for a change is the end of February.');

insert into public.afsc_mdi_land (ranch_id, pasture_id, part, section, township, range, meridian, acres, pasture_type, tenure, title_name, sort)
select case when p.legal_description like 'Willow Ridge%' then '0de30000-0000-4000-8000-000000000402'::uuid
            else '0de30000-0000-4000-8000-000000000401'::uuid end,
       p.id,
       split_part(split_part(p.legal_description, ' · ', 2), '-', 1),
       split_part(split_part(p.legal_description, ' · ', 2), '-', 2),
       split_part(split_part(p.legal_description, ' · ', 2), '-', 3),
       split_part(split_part(p.legal_description, ' · ', 2), '-', 4),
       'W4',
       p.area_acres,
       p.pasture_type,
       case when p.name = 'North Paddock' then 'cash' else 'owned' end,
       case when p.name = 'North Paddock' then 'Grazing lease GRL 990123' else 'Prairie Creek Farm Ltd.' end,
       row_number() over (order by p.legal_description)
from public.pastures p
where p.id::text like '0de30000-0000-4000-8000-00000000041%' and p.pasture_type in ('native', 'tame');
