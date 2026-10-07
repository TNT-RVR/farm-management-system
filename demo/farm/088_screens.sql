-- Screens that were still empty for a farm like this one (all made up):
-- hail inspections, tissue tests, N-rich strips and an N rate trial, a check
-- strip, fertility prescriptions, the pivots' water balance, cattle manifests,
-- fixed costs, fertilizer quotes and bookings, split-N plans, industry news on
-- the meeting page, bale checks, varieties, the home-grown ration and weeds.
-- Runs before 090_finish.sql, which clears the change log the build leaves.

-- ── Hail inspections ───────────────────────────────────────────────────────
-- Two waiting to be looked at (one matched to a field, one only to a section),
-- and one already applied (its hail event is below).
insert into public.hail_inspections (inspection_number, field_id, match_confidence, land_location, crop_label, damage_date, report_date, loss_notice_date,
  adjuster, acres, loss_pct, bands, source, status, applied_at, applied_by, created_at)
values
  ('DEMO-' || to_char(current_date, 'YY') || '-04127', '0de30000-0000-4000-8000-000000000110', 'exact', 'NE-21-40-25-W4', 'Canola', current_date - 41, current_date - 9, current_date - 39,
   'R. Lindqvist (example adjuster)', 158, 12,
   '[{"band": "Under 10%", "acres": 96, "lossPct": 6}, {"band": "10% - 70%", "acres": 62, "lossPct": 21}]',
   'uploaded by hand', 'pending', null, null, now() - interval '9 days'),
  ('DEMO-' || to_char(current_date, 'YY') || '-04131', null, 'section', 'E-14-40-25-W4', 'Wheat', current_date - 41, current_date - 8, current_date - 39,
   'R. Lindqvist (example adjuster)', 312, 4,
   '[{"band": "Under 10%", "acres": 312, "lossPct": 4}]',
   'uploaded by hand', 'pending', null, null, now() - interval '8 days'),
  ('DEMO-' || to_char(current_date, 'YY') || '-03318', '0de30000-0000-4000-8000-000000000115', 'exact', 'NE-27-40-25-W4', 'Canola', current_date - 63, current_date - 30, current_date - 61,
   'M. Okafor (example adjuster)', 127, 8,
   '[{"band": "Under 10%", "acres": 101, "lossPct": 5}, {"band": "10% - 70%", "acres": 26, "lossPct": 19}]',
   'uploaded by hand', 'applied', now() - interval '28 days', '0de30000-0000-4000-8000-0000000000a1', now() - interval '30 days');
-- The section-only one sits on the Miller Half; point it there so it can be checked.
update public.hail_inspections set field_id = '0de30000-0000-4000-8000-000000000111'
 where inspection_number = 'DEMO-' || to_char(current_date, 'YY') || '-04131';

insert into public.field_hail_events (field_id, crop_year, event_date, loss_pct, acres, notes, created_by)
values ('0de30000-0000-4000-8000-000000000115', extract(year from current_date)::int, current_date - 63, 8, 127,
        'Inspection DEMO-' || to_char(current_date, 'YY') || '-03318 — 8% loss on 127 acres, adjuster M. Okafor (example adjuster)',
        '0de30000-0000-4000-8000-0000000000a1');

-- ── Tissue tests ───────────────────────────────────────────────────────────
insert into public.tissue_tests (field_id, crop_year, sampled_on, crop, growth_stage, plant_part, lab, report_ref, sample_code,
  n_pct, p_pct, k_pct, ca_pct, mg_pct, s_pct, b_ppm, cu_ppm, fe_ppm, mn_ppm, zn_ppm, notes, source_file, created_by)
select v.field_id::uuid, extract(year from current_date)::int, make_date(extract(year from current_date)::int, v.m, v.d), v.crop, v.stage, v.part,
       'Prairie Ag Lab (example)', 'PT-' || to_char(current_date, 'YY') || '-' || v.ref, v.code,
       v.n, v.p, v.k, v.ca, v.mg, v.s, v.b, v.cu, v.fe, v.mn, v.zn, v.notes, 'example-tissue-demo.pdf', '0de30000-0000-4000-8000-0000000000a1'
from (values
  ('0de30000-0000-4000-8000-000000000101', 6, 24, 'Wheat',  'before heading', 'whole plant above ground', '1181', 'HQ-1', 3.4, 0.36, 2.6, 0.38, 0.17, 0.26, 6.1, 6.2, 92, 58, 31, null),
  ('0de30000-0000-4000-8000-000000000108', 6, 24, 'Wheat',  'before heading', 'whole plant above ground', '1182', 'HT-1', 1.9, 0.27, 2.2, 0.41, 0.19, 0.19, 5.4, 4.1, 85, 44, 24, 'Sampled on the north knolls. N marginal — top-dressed 25 lb N on the knolls.'),
  ('0de30000-0000-4000-8000-000000000111', 7, 3,  'Wheat',  'boot', 'flag leaf', '1207', 'MH-1', 3.6, 0.33, 2.4, 0.42, 0.21, 0.24, 7.2, 4.4, 104, 61, 27, 'Cu at the low end of the range — worth a soil Cu test before next wheat.'),
  ('0de30000-0000-4000-8000-000000000102', 7, 3,  'Canola', 'early flower', 'youngest mature leaf', '1208', 'EH-1', 4.6, 0.44, 3.1, 1.6, 0.34, 0.52, 34, 5.1, 96, 66, 38, null),
  ('0de30000-0000-4000-8000-000000000105', 7, 3,  'Canola', 'early flower', 'youngest mature leaf', '1209', 'SQ-1', 4.1, 0.39, 2.8, 1.4, 0.31, 0.29, 28, 4.8, 110, 72, 35, 'S below range on the slough side. 15 lb S as AMS next canola year.'),
  ('0de30000-0000-4000-8000-000000000113', 7, 6,  'Canola', 'early flower', 'youngest mature leaf', '1215', 'CW-1', 4.9, 0.48, 3.4, 1.7, 0.36, 0.58, 38, 5.9, 121, 70, 41, null),
  ('0de30000-0000-4000-8000-000000000106', 6, 27, 'Barley', 'before heading', 'whole plant above ground', '1196', 'RQ-1', 3.1, 0.34, 2.9, 0.36, 0.18, 0.23, 5.8, 5.3, 88, 51, 29, null),
  ('0de30000-0000-4000-8000-000000000104', 6, 10, 'Alfalfa', 'bud', 'top 6 inches', '1150', 'HF-1', 3.8, 0.24, 1.9, 1.3, 0.29, 0.22, 31, 7.4, 78, 39, 26, 'P and K both near the bottom — plan 0-20-60 after first cut next year.')
) as v(field_id, m, d, crop, stage, part, ref, code, n, p, k, ca, mg, s, b, cu, fe, mn, zn, notes);

-- ── N-rich strips (satellite N check) ─────────────────────────────────────
-- An 18 m strip with 50 lb extra N across three fields; the satellite compares
-- the field's NDRE with the strip's on the same pass (sufficiency index).
insert into public.n_rich_strips (id, field_id, crop_year, label, geom, extra_lb_n, notes, created_by, created_at)
select v.id::uuid, v.field_id::uuid, extract(year from current_date)::int, 'N-rich strip',
       st_multi(st_collectionextract(st_intersection(b.geom,
         st_makeenvelope(st_xmin(b.geom) + v.fx * (st_xmax(b.geom) - st_xmin(b.geom)), st_ymin(b.geom) - 0.001,
                         st_xmin(b.geom) + v.fx * (st_xmax(b.geom) - st_xmin(b.geom)) + 18.3 / 67800.0, st_ymax(b.geom) + 0.001, 4326)), 3)),
       50, v.notes, '0de30000-0000-4000-8000-0000000000a1', make_date(extract(year from current_date)::int, 5, 20)
from (values
  ('0de30000-0000-4000-8000-000000000c01', '0de30000-0000-4000-8000-000000000101', 0.35, 'Down the middle, avoiding the wet spot.'),
  ('0de30000-0000-4000-8000-000000000c02', '0de30000-0000-4000-8000-000000000111', 0.55, null),
  ('0de30000-0000-4000-8000-000000000c03', '0de30000-0000-4000-8000-000000000102', 0.40, null)
) as v(id, field_id, fx, notes)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null;

-- The strip's NDRE on every usable pass from four weeks after seeding to the
-- start of ripening: the field falls behind the strip on the Miller Half.
insert into public.sat_observations (scene_id, subject_type, subject_id, sensed_on, valid_fraction, quality, harmonized, ndvi_mean, ndre_mean, resolution_m, ndvi_harmonized, harmonization_source)
select o.scene_id, 'n_strip', s.id, o.sensed_on, o.valid_fraction, o.quality, true,
       round(least(0.95, o.ndvi_mean * 1.02), 3),
       round(o.ndre_mean / (1 - x.gap * least(1, greatest(0, (o.sensed_on - (make_date(extract(year from current_date)::int, 5, 15) + 25)) / 35.0))), 3),
       10, round(least(0.95, o.ndvi_mean * 1.02), 3), 'native'
from public.n_rich_strips s
join public.sat_observations o on o.subject_type = 'field' and o.subject_id = s.field_id and o.quality <> 'rejected' and o.ndre_mean is not null
cross join lateral (select case s.field_id when '0de30000-0000-4000-8000-000000000111' then 0.09 when '0de30000-0000-4000-8000-000000000102' then 0.04 else 0.02 end as gap) x
where extract(year from o.sensed_on) = extract(year from current_date)
  and o.sensed_on between make_date(extract(year from current_date)::int, 6, 10) and make_date(extract(year from current_date)::int, 7, 31);

-- ── N rate trial (harvested) and a check strip ─────────────────────────────
insert into public.n_trials (field_id, crop_year, crop_id, name, rates, reps, layout, base_rate, strip_width_m, heading_deg, seed, status, results, yield_unit, notes, created_by, created_at, updated_at)
select '0de30000-0000-4000-8000-000000000111', extract(year from current_date)::int, c.id, 'Wheat N rate trial',
       array[60, 90, 120, 150]::numeric[], 3, array[90, 150, 60, 120, 120, 60, 150, 90, 60, 120, 90, 150]::numeric[], 110, 18.3, 0, 7, 'harvested',
       (select jsonb_agg(jsonb_build_object('strip', i, 'yield', round((46 + 0.27 * r - 0.00092 * r * r + ((abs(hashtext('trial' || i)) % 21) - 10) / 5.0)::numeric, 1)) order by i)
          from unnest(array[90, 150, 60, 120, 120, 60, 150, 90, 60, 120, 90, 150]) with ordinality as l(r, i)),
       'bu/ac', 'Strips weighed with the weigh wagon. The field rate was 110 lb N.', '0de30000-0000-4000-8000-0000000000a1',
       make_date(extract(year from current_date)::int, 4, 28), now() - interval '25 days'
from public.crops c where c.name = 'Wheat';

insert into public.fert_check_strips (field_id, crop_year, nutrient, field_rate, strip_rate, strip_acres, field_yield, strip_yield, where_text, yield_unit, note, created_by)
values ('0de30000-0000-4000-8000-000000000108', extract(year from current_date)::int, 'N', 105, 75, 2.4, 59.2, 57.6, 'Two drill widths along the east side, from the approach north', 'bu/ac',
        '30 lb less N cost 1.6 bu — about break-even at this year''s prices.', '0de30000-0000-4000-8000-0000000000a1'),
       ('0de30000-0000-4000-8000-000000000102', extract(year from current_date)::int, 'S', 20, 0, 2.1, 52.5, 47.9, 'One strip on the west side with no AMS', 'bu/ac',
        'No sulphur cost 4.6 bu — keep the S.', '0de30000-0000-4000-8000-0000000000a1');

-- ── Fertility prescriptions ────────────────────────────────────────────────
-- Variable-rate urea and MAP for four fields, zoned on the productivity zones
-- (best ground gets the higher yield goal and the most N).
insert into public.fertility_rx (crop_year, field_id, field_label, legal, crop_type, variety, acres, yield_goal, yield_unit, description, rec_crop_type, rec_yield_goal,
  total_acres, products, source_file, source_page, imported_at)
select extract(year from current_date)::int, f.id, f.name, f.legal_land_description, c.name, p.variety, p.planned_acres, v.goal, 'bu/ac',
       'Variable-rate N and P (example)', c.name, v.goal, p.planned_acres,
       jsonb_build_array(
         jsonb_build_object('label', 'Urea', 'analysis', '46-0-0', 'avgRate', v.urea, 'totalLbs', round(v.urea * p.planned_acres)),
         jsonb_build_object('label', 'MAP', 'analysis', '11-52-0', 'avgRate', v.map, 'totalLbs', round(v.map * p.planned_acres))),
       'example-rx-demo.pdf', v.page, now() - interval '170 days'
from (values
  ('0de30000-0000-4000-8000-000000000101', 62, 205, 70, 1),
  ('0de30000-0000-4000-8000-000000000102', 52, 230, 75, 2),
  ('0de30000-0000-4000-8000-000000000108', 56, 195, 85, 3),
  ('0de30000-0000-4000-8000-000000000111', 63, 210, 70, 4)
) as v(field_id, goal, urea, map, page)
join public.fields f on f.id = v.field_id::uuid
join public.crop_plans p on p.field_id = f.id and p.crop_year = extract(year from current_date)::int
join public.crops c on c.id = p.crop_id;

insert into public.fertility_rx_zones (rx_id, zone, fertility_index, acres, yield_goal, n, p2o5, k2o, s, extra, products)
select r.id, z.zone, (array['High', 'Medium-high', 'Medium', 'Low'])[z.zone], z.acres,
       round(r.yield_goal * (array[1.08, 1.0, 0.93, 0.8])[z.zone]),
       round((r.products -> 0 ->> 'avgRate')::numeric * (array[1.12, 1.0, 0.92, 0.7])[z.zone] * 0.46 + 12),
       round((r.products -> 1 ->> 'avgRate')::numeric * (array[1.0, 1.0, 1.1, 1.25])[z.zone] * 0.52),
       0, case when r.crop_type = 'Canola' then 20 else 10 end,
       jsonb_build_object('heading', 0),
       jsonb_build_object('46-0-0', round((r.products -> 0 ->> 'avgRate')::numeric * (array[1.12, 1.0, 0.92, 0.7])[z.zone]),
                          '11-52-0', round((r.products -> 1 ->> 'avgRate')::numeric * (array[1.0, 1.0, 1.1, 1.25])[z.zone]))
from public.fertility_rx r
join public.field_yield_zones z on z.field_id = r.field_id
where r.crop_year = extract(year from current_date)::int and r.source_file = 'example-rx-demo.pdf';

insert into public.fertility_rx_map (field_id, crop_year, product, target_rate, geom, source_file)
select r.field_id, r.crop_year, p.label || ' ' || p.analysis, (z.products ->> p.analysis)::numeric, y.geom, 'example-rx-demo-shapes.zip'
from public.fertility_rx r
join public.fertility_rx_zones z on z.rx_id = r.id
join public.field_yield_zones y on y.field_id = r.field_id and y.zone = z.zone
cross join lateral (select e ->> 'label' as label, e ->> 'analysis' as analysis from jsonb_array_elements(r.products) e) p
where r.source_file = 'example-rx-demo.pdf';

-- ── Pivot water balance (Irrigation) ───────────────────────────────────────
-- A daily root-zone balance for the three pivots from seeding to today, from
-- the demo weather station's ET and rain and the logged irrigations.
do $$
declare
  s record;
  w record;
  dr numeric;
  zr numeric;
  taw numeric;
  raw numeric;
  kc numeric;
  etc numeric;
  rain_eff numeric;
  irr numeric;
  st text;
  dap int;
  season int;
begin
  for s in
    select c.field_id, c.planting_date, c.harvest_date, f.soil_fc, f.soil_wp
    from public.field_crop_seasons c join public.fields f on f.id = c.field_id
    where c.crop_year = extract(year from current_date)::int and c.active
  loop
    dr := 15;
    season := s.harvest_date - s.planting_date;
    for w in
      select d.day::date as day, coalesce(wd.et0_mm, 3.0)::numeric as et0, coalesce(wd.precip_mm, 0)::numeric as precip
      from generate_series(s.planting_date, current_date - 1, interval '1 day') as d(day)
      left join lateral (select x.et0_mm, x.precip_mm from public.weather_daily x where x.date = d.day::date order by x.station_id limit 1) wd on true
    loop
      dap := w.day - s.planting_date;
      zr := least(1.0, 0.3 + 0.7 * dap / 60.0);
      taw := round((1000 * (coalesce(s.soil_fc, 0.3) - coalesce(s.soil_wp, 0.13)))::numeric * zr, 1);
      raw := round(0.55 * taw, 1);
      kc := case when w.day >= s.harvest_date then 0.30
                 when dap < 25 then 0.35
                 when dap < 60 then 0.35 + 0.80 * (dap - 25) / 35.0
                 when dap < season - 25 then 1.15
                 else greatest(0.40, 1.15 - 0.75 * (dap - (season - 25)) / 25.0) end;
      etc := round(kc * w.et0, 2);
      rain_eff := case when w.precip > 2 then round(w.precip * 0.9, 1) else 0 end;
      select coalesce(sum(e.net_mm), 0) into irr from public.irrigation_events e where e.field_id = s.field_id and e.date = w.day;
      dr := least(taw, greatest(0, dr + etc - rain_eff - irr));
      st := case when dr <= 0.6 * raw then 'ok' when dr <= raw then 'soon' when dr <= raw + 0.25 * (taw - raw) then 'now' else 'stress' end;
      if w.day >= s.harvest_date then st := 'ok'; end if;
      insert into public.water_balance_daily (field_id, date, etc_mm, dr_mm, taw_mm, raw_mm, zr_m, kc, status, rec_net_mm, rec_gross_mm, days_to_irrigate,
        is_forecast, avail_100_mm, avail_50_mm, rainfall_mm, effective_irrigation_mm, rain_source, ks)
      values (s.field_id, w.day, etc, round(dr, 1), taw, raw, round(zr, 2), round(kc, 2), st,
        case when st in ('now', 'stress') and w.day < s.harvest_date then round(dr, 1) end,
        case when st in ('now', 'stress') and w.day < s.harvest_date then round(dr / 0.85, 1) end,
        case when w.day >= s.harvest_date then null when dr >= raw then 0 else floor((raw - dr) / greatest(etc, 0.5))::int end,
        false, round(taw - dr, 1), round((taw - dr) * least(1, 0.5 / zr), 1), w.precip, irr, 'station',
        round(case when dr <= raw then 1 else (taw - dr) / greatest(taw - raw, 1) end, 2));
    end loop;
  end loop;
end $$;

-- ── Cattle manifests ───────────────────────────────────────────────────────
insert into public.cattle_manifests (id, crop_year, manifest_no, moved_on, ranch_id, owner_name, owner_phone, origin_address, origin_premises_id, brand, brand_location,
  destination_name, destination_address, destination_phone, destination_premises_id, purpose, transporter_name, transporter_phone, licence_plate, driver_name, signed_by, signed_on, notes, created_by, created_at)
values
  ('0de30000-0000-4000-8000-000000000d01', extract(year from current_date)::int, 'PC-' || extract(year from current_date)::int || '-01', make_date(extract(year from current_date)::int, 5, 20),
   '0de30000-0000-4000-8000-000000000401', 'Sam Demo', '403-555-0100', 'Box 41, Prairie Creek, AB', 'AB0123456', 'PC lazy bar', 'Left hip',
   'Willow Ridge pasture', 'Range Road 263, Prairie Creek, AB', '403-555-0100', 'AB0123457', 'pasture',
   'Creekbend Cattle Hauling (example)', '403-555-0177', 'AB 4KX 219', 'Dale Norquist', 'Sam Demo', make_date(extract(year from current_date)::int, 5, 20),
   'Pairs to summer pasture, two loads.', '0de30000-0000-4000-8000-0000000000a1', make_date(extract(year from current_date)::int, 5, 19)),
  ('0de30000-0000-4000-8000-000000000d02', extract(year from current_date)::int, 'PC-' || extract(year from current_date)::int || '-02', current_date - 6,
   '0de30000-0000-4000-8000-000000000401', 'Sam Demo', '403-555-0100', 'Box 41, Prairie Creek, AB', 'AB0123456', 'PC lazy bar', 'Left hip',
   'County Line Auction Mart', 'Hwy 12 east, Prairie Creek, AB', '403-555-0190', 'AB0999001', 'sale',
   'Creekbend Cattle Hauling (example)', '403-555-0177', 'AB 4KX 219', 'Dale Norquist', 'Sam Demo', current_date - 6,
   'Open and late cows after preg checking.', '0de30000-0000-4000-8000-0000000000a1', current_date - 7),
  ('0de30000-0000-4000-8000-000000000d03', extract(year from current_date)::int, null, current_date + 33,
   '0de30000-0000-4000-8000-000000000401', 'Sam Demo', '403-555-0100', 'Box 41, Prairie Creek, AB', 'AB0123456', 'PC lazy bar', 'Left hip',
   'County Line Auction Mart', 'Hwy 12 east, Prairie Creek, AB', '403-555-0190', null, 'sale',
   null, null, null, null, null, null,
   'Calf sale — fill in the trucker and plate on the day.', '0de30000-0000-4000-8000-0000000000a1', now() - interval '2 days');

insert into public.cattle_manifest_lines (manifest_id, sort_order, animal_class, head, sex, colour, avg_weight_lb, brand, tag_range, notes) values
  ('0de30000-0000-4000-8000-000000000d01', 1, 'Cows with calves', 58, 'F', 'Black, a few black baldy', 1350, 'PC lazy bar', 'Yellow 101–158', null),
  ('0de30000-0000-4000-8000-000000000d01', 2, 'Calves at side', 58, 'mixed', 'Black', 210, null, null, 'Branded and vaccinated 10 May.'),
  ('0de30000-0000-4000-8000-000000000d01', 3, 'Bulls', 3, 'M', 'Black', 2050, 'PC lazy bar', 'Blue 7, 9, 12', null),
  ('0de30000-0000-4000-8000-000000000d02', 1, 'Cull cows', 9, 'F', 'Black', 1420, 'PC lazy bar', null, '7 open, 2 late.'),
  ('0de30000-0000-4000-8000-000000000d02', 2, 'Bull', 1, 'M', 'Black', 2200, 'PC lazy bar', 'Blue 4', 'Broken sheath.'),
  ('0de30000-0000-4000-8000-000000000d03', 1, 'Steer calves', 46, 'M', 'Black', 600, 'PC lazy bar', null, null),
  ('0de30000-0000-4000-8000-000000000d03', 2, 'Heifer calves', 24, 'F', 'Black', 560, 'PC lazy bar', null, 'Keeping 20 replacements back.');

-- ── Fixed costs (Plan → Farm costs) ────────────────────────────────────────
insert into public.farm_fixed_costs (crop_year, mode, lump_per_acre, spread_acres, per_acre, note, updated_by)
values (extract(year from current_date)::int, 'breakdown', null, null, 118.40,
        'Made-up costs for the demo farm. Land is the owned land''s taxes and finance share; rent is in the leases.', (select id from public.users order by created_at limit 1));
insert into public.farm_fixed_cost_lines (crop_year, category, basis, amount, note, updated_by)
select extract(year from current_date)::int, v.cat, v.basis, v.amount, v.note, (select id from public.users order by created_at limit 1)
from (values
  ('land', 'per_acre', 38.00, 'Taxes and the land loan''s interest, over owned acres'),
  ('labour', 'farm_total', 96000.00, 'Two full-time, one seasonal'),
  ('machinery', 'per_acre', 22.50, 'Insurance, licences, shop'),
  ('depreciation', 'farm_total', 61000.00, 'Line and combine, straight-line'),
  ('overhead', 'per_acre', 9.80, 'Accounting, phones, utilities, office')
) as v(cat, basis, amount, note);

-- ── Fertilizer buying: quotes, bookings, split-N plans ─────────────────────
insert into public.fert_quotes (crop_year, product, supplier, price_per_tonne, quoted_on, valid_until, includes_delivery, note, created_by) values
  (extract(year from current_date)::int, '46-0-0', 'Prairie Ag Supply', 865, make_date(extract(year from current_date)::int, 2, 12), make_date(extract(year from current_date)::int, 3, 15), true, null, '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int, '46-0-0', 'Valley Fertilizer Co. (example)', 842, make_date(extract(year from current_date)::int, 2, 14), make_date(extract(year from current_date)::int, 3, 1), false, 'Pick-up only, 40 km away.', '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int, '11-52-0', 'Prairie Ag Supply', 1120, make_date(extract(year from current_date)::int, 2, 12), make_date(extract(year from current_date)::int, 3, 15), true, null, '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int + 1, '46-0-0', 'Prairie Ag Supply', 815, current_date - 9, current_date + 21, true, 'Fall booking price; 10% down.', '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int + 1, '46-0-0', 'Valley Fertilizer Co. (example)', 798, current_date - 6, current_date + 9, false, 'Pick-up only.', '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int + 1, '11-52-0', 'Prairie Ag Supply', 1065, current_date - 9, current_date + 21, true, null, '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int + 1, '21-0-0-24', 'Prairie Ag Supply', 495, current_date - 9, current_date + 21, true, null, '0de30000-0000-4000-8000-0000000000a1');

insert into public.fert_bookings (crop_year, product, supplier, tonnes, price_per_tonne, booked_on, delivered, note, created_by) values
  (extract(year from current_date)::int, '46-0-0', 'Prairie Ag Supply', 210, 868, make_date(extract(year from current_date)::int - 1, 11, 18), true, 'Fall booking, delivered April.', '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int, '11-52-0', 'Prairie Ag Supply', 72, 1135, make_date(extract(year from current_date)::int - 1, 11, 18), true, null, '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int, '21-0-0-24', 'Prairie Ag Supply', 38, 505, make_date(extract(year from current_date)::int, 1, 22), true, null, '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int + 1, '46-0-0', 'Prairie Ag Supply', 120, 815, current_date - 4, false, 'Half the urea now; price the rest in January.', '0de30000-0000-4000-8000-0000000000a1');

insert into public.fert_split_plans (field_id, crop_year, upfront_pct, status, decided_on, note, created_by)
select v.field_id::uuid, extract(year from current_date)::int, v.pct, v.status, make_date(extract(year from current_date)::int, v.m, v.d), v.note, '0de30000-0000-4000-8000-0000000000a1'
from (values
  ('0de30000-0000-4000-8000-000000000101', 70, 'applied', 6, 26, 'Top-dressed 40 lb N with UAN after the tissue test.'),
  ('0de30000-0000-4000-8000-000000000108', 65, 'applied', 6, 27, 'Knolls only.'),
  ('0de30000-0000-4000-8000-000000000111', 75, 'skipped', 6, 30, 'Dry June — the second pass wasn''t worth it.'),
  ('0de30000-0000-4000-8000-000000000112', 60, 'applied', 7, 2, 'Through the pivot, 30 lb N in two shots.')
) as v(field_id, pct, status, m, d, note);

-- ── This week in the industry (meeting page) ───────────────────────────────
insert into public.ag_news (source, title, url, summary, published_at, categories, score, matched, fetched_at) values
  ('Example Farm News (demo)', 'Example: fall fertilizer prices ease ahead of booking season',
   'https://example.com/demo-news/fall-fertilizer-prices', 'A made-up story for the demo: urea and MAP prices slipped through September as fall booking programs opened. In your own copy this list fills from real farm news feeds.',
   now() - interval '2 days', array['fertilizer', 'markets'], 9, array['urea', 'fertilizer'], now() - interval '2 days'),
  ('Example Farm News (demo)', 'Example: calf prices hold firm into the fall run',
   'https://example.com/demo-news/calf-prices-fall-run', 'A made-up story for the demo: auction marts report steady to stronger prices on 500–700 lb calves as the fall run builds.',
   now() - interval '4 days', array['cattle', 'markets'], 8, array['calves', 'auction'], now() - interval '4 days'),
  ('Example Farm News (demo)', 'Example: clubroot survey finds new fields in central Alberta',
   'https://example.com/demo-news/clubroot-survey', 'A made-up story for the demo: the yearly survey found clubroot in more fields this year; growers are urged to clean equipment between fields.',
   now() - interval '6 days', array['agronomy', 'canola'], 7, array['canola', 'clubroot'], now() - interval '6 days'),
  ('Example Farm News (demo)', 'Example: grain handling capacity tight as harvest wraps up',
   'https://example.com/demo-news/grain-handling', 'A made-up story for the demo: elevators report long lines and slow car spots as harvest finishes across the Prairies.',
   now() - interval '9 days', array['grain', 'logistics'], 6, array['harvest', 'elevator'], now() - interval '9 days');

-- ── Bale checks (monthly temperature and moisture, for the insurer) ───────
insert into public.bale_checks (id, checked_on, checked_by, ranch_id, location, air_temp_c, notes, created_at, updated_at)
select ('0de30000-0000-4000-8000-0000000e00' || lpad(m::text, 2, '0'))::uuid, current_date - 5 - (m - 1) * 30,
       '0de30000-0000-4000-8000-0000000000a3', '0de30000-0000-4000-8000-000000000401', 'Home yard bale yard',
       (array[9, 14, 21, 24])[m],
       case m when 3 then 'Greenfeed stack warm on the south end — rechecked three days later at 38.' end,
       now() - make_interval(days => 5 + (m - 1) * 30), now() - make_interval(days => 5 + (m - 1) * 30)
from generate_series(1, 4) m;

insert into public.bale_check_readings (check_id, feed_type_id, feed_name, bale_form, stack, bale_label, temp_c, moisture_pct, probe_depth_in, notes, sort_order)
select c.id, v.feed::uuid, v.name, 'round', v.stack, v.label,
       round((v.t + (abs(hashtext(c.id::text || v.label)) % 5) - 2 - (extract(day from now() - c.created_at) / 30.0) * v.cool)::numeric, 1),
       round((v.mo + ((abs(hashtext(c.id::text || v.label || 'm')) % 7) - 3) / 2.0)::numeric, 1), 18, null, v.ord
from public.bale_checks c
cross join (values
  ('0de30000-0000-4000-8000-000000000431', 'Alfalfa-brome hay', 'Stack 1', 'North end', 24.0, 14.0, -2.0, 1),
  ('0de30000-0000-4000-8000-000000000431', 'Alfalfa-brome hay', 'Stack 1', 'South end', 26.0, 15.5, -2.5, 2),
  ('0de30000-0000-4000-8000-000000000433', 'Oat-pea greenfeed', 'Stack 3', 'North end', 30.0, 17.0, -1.0, 3),
  ('0de30000-0000-4000-8000-000000000433', 'Oat-pea greenfeed', 'Stack 3', 'South end', 34.0, 19.0, -1.5, 4)
) as v(feed, name, stack, label, t, mo, cool, ord)
where c.location = 'Home yard bale yard';

-- ── Varieties, the home-grown ration, weed patches ─────────────────────────
insert into public.crop_varieties (crop_id, name, active, company)
select c.id, v.name, true, v.company
from (values
  ('Canola', 'InVigor L345PC', 'BASF'), ('Canola', 'InVigor L340PC', 'BASF'), ('Canola', 'InVigor L233P', 'BASF'),
  ('Canola', 'Pioneer 45M35', 'Corteva'), ('Canola', 'DKTF 98 SC', 'Bayer'),
  ('Wheat', 'AAC Brandon', 'SeCan'), ('Wheat', 'AAC Viewfield', 'FP Genetics'), ('Wheat', 'CDC Go', 'SeCan'),
  ('Barley', 'AAC Synergy', 'Syngenta'), ('Barley', 'CDC Austenson', 'SeCan'),
  ('Peas', 'CDC Inca', 'SeCan'), ('Peas', 'CDC Amarillo', 'SeCan'),
  ('Oats', 'CS Camden', 'Canterra')
) as v(crop, name, company)
join public.crops c on c.name = v.crop
on conflict do nothing;

insert into public.feed_ration (ranch_id, crop_id, dm_share_pct, sort_order)
select '0de30000-0000-4000-8000-000000000401', c.id, v.pct, v.ord
from (values ('Alfalfa', 50, 1), ('Green Feed', 30, 2), ('Barley', 10, 3)) as v(crop, pct, ord)
join public.crops c on c.name = v.crop;

insert into public.weed_patches (weed, geojson, acres, field_id, severity, notes, observed_on, treated_on, created_by, treatment, chemical)
select v.weed, st_asgeojson(g.geom)::jsonb, round((st_area(g.geom::geography) / 4046.8564)::numeric, 2), v.field_id::uuid, v.sev, v.notes,
       current_date - v.ago, case when v.treated then current_date - v.ago + 9 end, '0de30000-0000-4000-8000-0000000000a2',
       case when v.treated then 'sprayed' end, case when v.treated then v.chem end
from (values
  ('Canada thistle', '0de30000-0000-4000-8000-000000000101', 0.80, 0.55, 70, 45, 'moderate', 'Patch spreading from the fence line. Spot-sprayed after harvest.', 120, true, 'Clopyralid'),
  ('Wild oats', '0de30000-0000-4000-8000-000000000108', 0.30, 0.70, 120, 70, 'heavy', 'Worst on the knolls; thin crop let them through.', 100, false, null),
  ('Kochia', '0de30000-0000-4000-8000-000000000109', 0.10, 0.40, 60, 40, 'moderate', 'Suspect glyphosate-resistant — send seed for testing.', 75, false, null),
  ('Cleavers', '0de30000-0000-4000-8000-000000000102', 0.62, 0.25, 50, 35, 'light', null, 95, true, 'Florasulam')
) as v(weed, field_id, fx, fy, w_m, h_m, sev, notes, ago, treated, chem)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null
cross join lateral (
  select st_intersection(b.geom, st_setsrid(st_translate(st_scale(st_buffer(st_makepoint(0, 0), 1, 'quad_segs=5'), v.w_m / 2 / 67800.0, v.h_m / 2 / 111132.0),
           st_xmin(b.geom) + v.fx * (st_xmax(b.geom) - st_xmin(b.geom)), st_ymin(b.geom) + v.fy * (st_ymax(b.geom) - st_ymin(b.geom))), 4326)) as geom
) g;
