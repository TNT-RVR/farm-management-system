-- Harvest, planting and field-work screens that were empty in the demo (all
-- made up): yields marked "not a normal year", hand-recorded field work (with
-- "Field finished" harvest records and the combine settings each one ran),
-- the farm's own work types, the combine's display names, Deere guidance
-- lines and what the combine was last loaded with, planter settings per crop
-- and the seed plates in the shop, seed-crop inspections, the blend
-- calculator's products, and hand-added rows on the Profit/Loss map.
-- Dates follow the neighbouring files: written against today and moved on to
-- the visitor's "today" by demo.shift_dates.

-- ── Yields left out of averages ────────────────────────────────────────────
-- The dry year on the two lightest fields, and the alfalfa's seeding year.
insert into public.abnormal_yield_years (field_id, crop_year, crop_id, reason, marked_by, created_at)
select h.field_id, h.crop_year, h.crop_id, v.reason, '0de30000-0000-4000-8000-0000000000a1', now() - interval '200 days'
  from (values
    ('0de30000-0000-4000-8000-000000000109', -4, 'Drought year: 4.2 in of rain May–August, sandy ground burnt off by mid-July.'),
    ('0de30000-0000-4000-8000-000000000108', -4, 'Drought year: the knolls gave almost nothing.'),
    ('0de30000-0000-4000-8000-000000000104', -3, 'Alfalfa seeding year: one light cut only.')
  ) v(field, back, reason)
  join public.crop_history h on h.field_id = v.field::uuid and h.crop_year = extract(year from current_date)::int + v.back;

-- ── The farm's own work types (Record work list) ───────────────────────────
insert into public.field_work_types (label, counts_as, active, created_by, created_at) values
  ('Vertical tillage', 'tillage', true, '0de30000-0000-4000-8000-0000000000a1', now() - interval '400 days'),
  ('Heavy harrow (straw)', 'tillage', true, '0de30000-0000-4000-8000-0000000000a1', now() - interval '400 days'),
  ('Custom spraying (hired)', 'application', true, '0de30000-0000-4000-8000-0000000000a1', now() - interval '300 days'),
  ('Fence repair', null, true, '0de30000-0000-4000-8000-0000000000a1', now() - interval '250 days'),
  ('Chaff collecting', null, false, '0de30000-0000-4000-8000-0000000000a1', now() - interval '700 days');

-- ── Hand-recorded field work this season ───────────────────────────────────
-- Times are the farm's local time. a1 Alex, a2 Jordan, a3 Casey.
insert into public.field_work_records (field_id, crop_year, crop_id, work_type, work_type_other, counts_as, started_at, finished_at, hours, acres,
  machine_ids, machines_at_once, operator_ids, other_people, amount, amount_unit, notes, bale_type, hay_cut, entered_at, created_by, created_at)
select v.field::uuid, extract(year from current_date)::int, p.crop_id, v.wt, null, v.counts_as,
       ((current_date - v.ago) + v.t0::time) at time zone 'America/Edmonton',
       ((current_date - v.ago + v.days) + v.t1::time) at time zone 'America/Edmonton',
       v.hours, round(b.acres * v.share, 1), v.machines::uuid[], null, v.ops::uuid[], v.others, v.amount, v.unit, v.notes, v.bale, v.cut,
       ((current_date - v.ago + v.days) + v.t1::time) at time zone 'America/Edmonton' + interval '40 minutes',
       v.ops[1]::uuid, now() - make_interval(days => v.ago)
  from (values
    ('0de30000-0000-4000-8000-000000000101', 'rolling', 'tillage', 168, 0, '07:30', '15:00', 7.5, 1.0, array['0de30000-0000-4000-8000-000000000802'], array['0de30000-0000-4000-8000-0000000000a3'], null, null::numeric, null, 'Rolled the peas at the 3-node stage. Rocks pushed down.', null, null::smallint),
    ('0de30000-0000-4000-8000-000000000110', 'rolling', 'tillage', 166, 0, '08:00', '16:30', 8.0, 1.0, array['0de30000-0000-4000-8000-000000000802'], array['0de30000-0000-4000-8000-0000000000a3'], null, null, null, null, null, null),
    ('0de30000-0000-4000-8000-000000000103', 'rock_picking', null, 175, 1, '13:00', '18:00', 9.0, 0.4, array['0de30000-0000-4000-8000-000000000814'], array['0de30000-0000-4000-8000-0000000000a2','0de30000-0000-4000-8000-0000000000a3'], '2 summer students (example)', null, null, 'West side along the power line. Two loads on the pile.', null, null),
    ('0de30000-0000-4000-8000-000000000108', 'rock_picking', null, 172, 0, '09:00', '17:00', 7.0, 0.3, array['0de30000-0000-4000-8000-000000000814'], array['0de30000-0000-4000-8000-0000000000a3'], null, null, null, 'North knolls only.', null, null),
    ('0de30000-0000-4000-8000-000000000104', 'baling', 'harvest', 128, 1, '11:00', '20:30', 14.5, 1.0, array['0de30000-0000-4000-8000-000000000802'], array['0de30000-0000-4000-8000-0000000000a2'], null, 312, 'bales', 'First cut. Good colour, no rain on it.', 'round', 1),
    ('0de30000-0000-4000-8000-000000000104', 'baling', 'harvest', 74, 1, '12:00', '19:00', 10.0, 1.0, array['0de30000-0000-4000-8000-000000000802'], array['0de30000-0000-4000-8000-0000000000a2'], null, 188, 'bales', 'Second cut, lighter.', 'round', 2),
    ('0de30000-0000-4000-8000-000000000104', 'bale_hauling', null, 70, 2, '08:00', '17:00', 22.0, 1.0, array['0de30000-0000-4000-8000-000000000802','0de30000-0000-4000-8000-000000000814'], array['0de30000-0000-4000-8000-0000000000a3'], null, 500, 'bales', 'Both cuts stacked at the home yard, north row.', null, null),
    ('0de30000-0000-4000-8000-000000000112', 'irrigation_work', null, 150, 0, '10:00', '14:00', 4.0, null, array['0de30000-0000-4000-8000-000000000814'], array['0de30000-0000-4000-8000-0000000000a1'], null, null, null, 'Replaced two sprinkler drops on tower 5; checked the end gun.', null, null),
    ('0de30000-0000-4000-8000-000000000107', 'Heavy harrow (straw)', 'tillage', 40, 1, '09:00', '18:00', 14.0, 1.0, array['0de30000-0000-4000-8000-000000000801'], array['0de30000-0000-4000-8000-0000000000a2'], null, null, null, 'Spread the canola chaff rows before it got wet.', null, null),
    ('0de30000-0000-4000-8000-000000000106', 'Vertical tillage', 'tillage', 30, 0, '10:00', '19:00', 9.0, 1.0, array['0de30000-0000-4000-8000-000000000801'], array['0de30000-0000-4000-8000-0000000000a2'], null, 2, 'in deep', 'One pass to size the stubble ahead of wheat.', null, null),
    ('0de30000-0000-4000-8000-000000000111', 'Custom spraying (hired)', 'application', 33, 0, '14:00', '17:30', 3.5, 1.0, array[]::text[], array[]::text[], 'Example Ag Aviation (example)', null, null, 'Pre-harvest glyphosate by plane: too wet to get the sprayer in.', null, null)
  ) v(field, wt, counts_as, ago, days, t0, t1, hours, share, machines, ops, others, amount, unit, notes, bale, cut)
  join public.crop_plans p on p.field_id = v.field::uuid and p.crop_year = extract(year from current_date)::int
  join public.field_boundaries b on b.field_id = v.field::uuid and b.valid_to is null;

-- Swathing: the canola fields grown for swathing, a week or so before the
-- combine got to them (the dry-down card reads the day).
insert into public.field_work_records (field_id, crop_year, crop_id, work_type, started_at, finished_at, hours, acres, machine_ids, operator_ids, notes, entered_at, created_by)
select p.field_id, p.crop_year, p.crop_id, 'swathing',
       ((l.first_load - 10) + time '09:30') at time zone 'America/Edmonton',
       ((l.first_load - 9) + time '20:00') at time zone 'America/Edmonton',
       round(b.acres / 16, 1), b.acres,
       array['0de30000-0000-4000-8000-000000000805']::uuid[], array['0de30000-0000-4000-8000-0000000000a3']::uuid[],
       'Swathed at 60% seed colour change.',
       ((l.first_load - 9) + time '20:30') at time zone 'America/Edmonton', '0de30000-0000-4000-8000-0000000000a3'
  from public.crop_plans p
  join public.crops c on c.id = p.crop_id and c.name = 'Canola'
  join public.field_boundaries b on b.field_id = p.field_id and b.valid_to is null
  join (select field_id, min(loaded_on) as first_load from public.bin_loads
         where crop_year = extract(year from current_date)::int group by field_id) l on l.field_id = p.field_id
 where p.crop_year = extract(year from current_date)::int and p.harvest_method = 'swathed';

-- "Field finished": one per field the combine is done with (a last load is in),
-- each with the settings the combine ran, as the finish form saves them.
with done as (
  select l.field_id, min(l.loaded_on) as first_load, max(l.loaded_on) as last_load, round(sum(l.bushels)) as bu
    from public.bin_loads l
   where l.crop_year = extract(year from current_date)::int and l.field_id is not null
   group by l.field_id
  having bool_or(l.last_from_field)
), fin as (
  insert into public.field_work_records (field_id, crop_year, crop_id, work_type, counts_as, field_finished, started_at, finished_at, hours, acres,
    machine_ids, operator_ids, amount, amount_unit, notes, entered_at, created_by)
  select d.field_id, p.crop_year, p.crop_id, 'field_finished', 'harvest', true,
         (d.first_load + time '11:00') at time zone 'America/Edmonton',
         (d.last_load + time '21:30') at time zone 'America/Edmonton',
         round(b.acres / 11, 1), b.acres,
         array['0de30000-0000-4000-8000-000000000803']::uuid[], array['0de30000-0000-4000-8000-0000000000a2']::uuid[],
         d.bu, 'bu', null,
         (d.last_load + time '22:00') at time zone 'America/Edmonton', '0de30000-0000-4000-8000-0000000000a2'
    from done d
    join public.crop_plans p on p.field_id = d.field_id and p.crop_year = extract(year from current_date)::int
    join public.field_boundaries b on b.field_id = d.field_id and b.valid_to is null
  returning id, field_id, crop_year, crop_id, finished_at
)
insert into public.combine_settings_used (used_on, crop_key, crop_year, field_id, equipment_id, rotor_rpm, concave_mm, vane_angle, fan_rpm,
  presieve_mm, chaffer_mm, sieve_mm, ground_speed_mph, header_type, operator, variety, notes, work_record_id, created_by)
select (f.finished_at at time zone 'America/Edmonton')::date, k.crop_key, f.crop_year, f.field_id, '0de30000-0000-4000-8000-000000000803',
       k.rotor + (abs(hashtext(f.field_id::text)) % 5 - 2) * 20, k.concave, k.vane, k.fan + (abs(hashtext(f.field_id::text || 'f')) % 5 - 2) * 20,
       k.pre, k.chaff, k.sieve, k.mph, 'D45 draper header', 'Jordan Pike', p.variety, k.notes, f.id, '0de30000-0000-4000-8000-0000000000a2'
  from fin f
  join public.crops c on c.id = f.crop_id
  join public.crop_plans p on p.field_id = f.field_id and p.crop_year = f.crop_year
  join (values
    ('Canola', 'canola', 640, 22, 2, 480, 7, 9, 4, 3.8, 'Fan down 40 after the first round: seed on the ground behind the shoe.'),
    ('Wheat', 'wheat', 1100, 12, 2, 880, 10, 11, 5, 3.6, null),
    ('Barley', 'barley', 1050, 14, 2, 820, 12, 12, 6, 3.8, 'Some awns left on; ran the concave in one.'),
    ('Peas', 'beans', 420, 30, 1, 1050, 14, 16, 10, 4.2, 'Slow rotor, few splits.'),
    ('Oats', 'oats', 950, 15, 2, 760, 12, 12, 6, 3.8, null)
  ) k(crop, crop_key, rotor, concave, vane, fan, pre, chaff, sieve, mph, notes) on k.crop = c.name;

-- Last year's settings, typed in at the end of each crop.
insert into public.combine_settings_used (used_on, crop_key, crop_year, field_id, equipment_id, rotor_rpm, concave_mm, vane_angle, fan_rpm,
  presieve_mm, chaffer_mm, sieve_mm, ground_speed_mph, header_type, operator, variety, notes, created_by)
select current_date - 365 - v.ago, v.ck, extract(year from current_date)::int - 1, v.field::uuid, '0de30000-0000-4000-8000-000000000803',
       v.rotor, v.concave, v.vane, v.fan, v.pre, v.chaff, v.sieve, v.mph, 'D45 draper header', 'Jordan Pike', v.variety, v.notes,
       '0de30000-0000-4000-8000-0000000000a2'
  from (values
    ('0de30000-0000-4000-8000-000000000101', 'canola', 52, 620, 23, 2, 500, 7, 9, 4, 3.5, 'Northfield NF340', 'Straight cut. Clean sample.'),
    ('0de30000-0000-4000-8000-000000000102', 'barley', 46, 1080, 14, 2, 840, 12, 12, 6, 3.6, 'Northfield B305', null),
    ('0de30000-0000-4000-8000-000000000106', 'beans', 60, 400, 30, 1, 1050, 14, 16, 10, 4.0, 'Northfield P410', 'Tough in the mornings; started at 11.'),
    ('0de30000-0000-4000-8000-000000000113', 'wheat', 38, 1150, 12, 2, 860, 10, 10, 4, 3.5, 'Northfield W701', 'Pivot wheat, heavy straw: steeper vanes.')
  ) v(field, ck, ago, rotor, concave, vane, fan, pre, chaff, sieve, mph, variety, notes);

-- ── Combine display: names, guidance lines, what it was loaded with ────────
-- A manager's Farm / Field on the display for three fields.
insert into public.combine_monitor_names (field_id, farm, field, updated_by, updated_at) values
  ('0de30000-0000-4000-8000-000000000111', 'Miller', 'Miller E Half', '0de30000-0000-4000-8000-0000000000a1', now() - interval '70 days'),
  ('0de30000-0000-4000-8000-000000000115', null, 'Creek Flat NE6', '0de30000-0000-4000-8000-0000000000a1', now() - interval '70 days'),
  ('0de30000-0000-4000-8000-000000000110', null, 'Corr Line', '0de30000-0000-4000-8000-0000000000a1', now() - interval '65 days');

-- Deere guidance lines: straight north–south A-B lines just inside the west
-- edge, and circles on the pivots. "Combine" in the name puts them on the stick.
insert into public.jd_guidance_lines (field_id, jd_line_id, name, line_type, jd_type, archived, heading_deg, geometry, data_hash, jd_modified_at, fetched_at)
select v.field::uuid, v.jd, v.name, v.lt, v.jdt, v.archived,
       case when v.lt = 'circle' then null else v.heading end,
       case when v.lt = 'circle'
            then st_asgeojson(st_exteriorring(st_buffer(st_centroid(b.geom)::geography, 360)::geometry), 6)::jsonb
            else st_asgeojson(st_makeline(st_makepoint(st_xmin(b.geom) + v.inset, st_ymin(b.geom) + 0.0004),
                                          st_makepoint(st_xmin(b.geom) + v.inset, st_ymax(b.geom) - 0.0004)), 6)::jsonb end,
       md5(v.jd || v.name), now() - make_interval(days => v.ago), now() - interval '1 day'
  from (values
    ('0de30000-0000-4000-8000-000000000101', 'demo-gl-01', 'Combine N-S', 'ab', 'AB', false, 0.0, 0.0006, 400),
    ('0de30000-0000-4000-8000-000000000101', 'demo-gl-02', 'Seeding 60ft', 'ab', 'AB', false, 0.0, 0.0004, 700),
    ('0de30000-0000-4000-8000-000000000102', 'demo-gl-03', 'Combine N-S', 'ab', 'AB', false, 0.0, 0.0006, 400),
    ('0de30000-0000-4000-8000-000000000106', 'demo-gl-04', 'Combine', 'ab', 'AB', false, 0.0, 0.0006, 380),
    ('0de30000-0000-4000-8000-000000000107', 'demo-gl-05', 'Combine 45ft', 'ab', 'AB', false, 0.0, 0.0006, 380),
    ('0de30000-0000-4000-8000-000000000107', 'demo-gl-06', 'Old seeding line', 'ab', 'AB', true, 0.0, 0.0003, 1500),
    ('0de30000-0000-4000-8000-000000000111', 'demo-gl-07', 'Combine', 'ab', 'AB', false, 0.0, 0.0006, 390),
    ('0de30000-0000-4000-8000-000000000112', 'demo-gl-08', 'Combine circle', 'circle', 'Circle', false, null, 0, 600),
    ('0de30000-0000-4000-8000-000000000113', 'demo-gl-09', 'Combine circle', 'circle', 'Circle', false, null, 0, 600),
    ('0de30000-0000-4000-8000-000000000114', 'demo-gl-10', 'Combine circle', 'circle', 'Circle', false, null, 0, 300),
    ('0de30000-0000-4000-8000-000000000114', 'demo-gl-11', 'Sprayer circle', 'circle', 'Circle', false, null, 0, 300)
  ) v(field, jd, name, lt, jdt, archived, heading, inset, ago)
  join public.field_boundaries b on b.field_id = v.field::uuid and b.valid_to is null;

-- What the C780 was loaded with: once before harvest, and again a month in
-- (two fields' names changed since, so the Combines page has changes to show).
insert into public.combine_monitor_loads (equipment_id, loaded_at, loaded_by, fields, loaded_count, note, created_at)
select '0de30000-0000-4000-8000-000000000803', ts, '0de30000-0000-4000-8000-0000000000a1', s.fields, s.n, v.note, ts
  from (values (64, 'Before harvest: every field, boundaries and combine lines.'), (30, null)) v(ago, note)
  cross join lateral (select ((current_date - v.ago) + time '07:15') at time zone 'America/Edmonton' as ts) t
  cross join lateral (
    select jsonb_agg(jsonb_build_object(
             'field_id', f.id, 'app_name', f.name,
             'monitor_name', left(coalesce(case when v.ago = 30 then n.field end, f.name), 18),
             'monitor_farm', coalesce(case when v.ago = 30 then n.farm end, 'Prairie Creek'),
             'grower', 'Prairie Creek Farm',
             'file_name', coalesce(case when v.ago = 30 then n.field end, f.name),
             'boundary_id', b.id, 'valid_from', b.valid_from, 'acres', b.acres,
             'lines', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'hash', g.data_hash, 'name', g.name))
                                  from public.jd_guidance_lines g where g.field_id = f.id and not g.archived and g.name ilike '%combine%'), '[]'::jsonb),
             'status', 'on') order by f.name) as fields,
           count(*)::int as n
      from public.fields f
      join public.field_boundaries b on b.field_id = f.id and b.valid_to is null
      left join public.combine_monitor_names n on n.field_id = f.id and n.field_id <> '0de30000-0000-4000-8000-000000000110'
     where f.active and f.id <> '0de30000-0000-4000-8000-000000000104'
  ) s;

-- ── Planter settings per crop, and the plates in the shop ──────────────────
-- The air drill for the cereals, canola and peas (10 in rows); the plates are
-- for the borrowed 12-row vacuum planter used on the canola singulation strip.
insert into public.crop_planter_profiles (crop_id, depth_setting, depth_in_min, depth_in_max, singulator, seed_spacing_in, seeds_per_acre_min, seeds_per_acre_max,
  planting_speed_mph, plate_holes, disc_number, row_spacing_in, passes, seeds_per_m2, notes, updated_by, updated_at)
select c.id, v.depth_setting, v.dmin, v.dmax, v.singulator, v.spacing, v.smin, v.smax, v.mph, v.holes, v.disc, v.rows, 1, v.m2, v.notes,
       '0de30000-0000-4000-8000-0000000000a1', now() - interval '180 days'
  from (values
    ('Canola', 'Packer setting 2', 0.5, 1.0, 'Small-seed singulator, notch 1', 7.5::numeric, 400000, 450000, 5.0, 72, 'Canola disc 72', 10, 104, 'Drill on 10 in; the planter strip is 30 in at 7.5 in spacing.'),
    ('Wheat', 'Packer setting 4', 1.0, 1.5, null, null, 1100000, 1300000, 5.5, null, null, 10, 297, 'Into moisture, not deeper than 2 in.'),
    ('Barley', 'Packer setting 4', 1.0, 1.75, null, null, 1000000, 1200000, 5.5, null, null, 10, 272, null),
    ('Peas', 'Packer setting 6', 1.5, 2.5, null, null, 330000, 380000, 5.0, null, null, 10, 88, 'Inoculant in tank 4. Seed into moisture even if it means 3 in.'),
    ('Oats', 'Packer setting 4', 1.0, 1.5, null, null, 1000000, 1200000, 5.5, null, null, 10, 272, null)
  ) v(crop, depth_setting, dmin, dmax, singulator, spacing, smin, smax, mph, holes, disc, rows, m2, notes)
  join public.crops c on c.name = v.crop;

insert into public.planter_plates (name, holes, notes, active, created_at) values
  ('Canola disc 72', 72, 'Small-seed vacuum disc. Clean the holes with the brush every fill.', true, now() - interval '500 days'),
  ('Canola disc 60', 60, 'For the bigger hybrid seed lots.', true, now() - interval '500 days'),
  ('Soybean / pea disc 40', 40, 'Tried on peas once; too many doubles.', true, now() - interval '500 days'),
  ('Corn disc 27', 27, 'Silage corn trial, two years ago.', false, now() - interval '700 days');

-- ── Seed-crop inspections (Rotation planner dots, Season wrap-up) ──────────
insert into public.field_inspections (field_id, crop_year, crop_id, status, rating, notes, inspected_on, created_by, created_at)
select v.field::uuid, extract(year from current_date)::int + v.back, coalesce(p.crop_id, h.crop_id), v.status, v.rating, v.notes,
       case when v.ago is null then null else current_date - v.ago end, '0de30000-0000-4000-8000-0000000000a1', now() - make_interval(days => coalesce(v.ago, 10))
  from (values
    ('0de30000-0000-4000-8000-000000000113', 0, 'passed', 'Certified', 'Seed wheat under the pivot. Two wild oats per acre walked; rogued before the inspector came.', 82),
    ('0de30000-0000-4000-8000-000000000114', 0, 'passed', 'Certified', null, 80),
    ('0de30000-0000-4000-8000-000000000112', 0, 'failed', '% volunteers too high', 'Volunteer canola in the barley. Sold as commercial grain instead.', 85),
    ('0de30000-0000-4000-8000-000000000106', 0, 'pending', null, 'Canola seed contract: inspector booked, not out yet.', null),
    ('0de30000-0000-4000-8000-000000000113', -1, 'passed', 'Certified', null, 450)
  ) v(field, back, status, rating, notes, ago)
  left join public.crop_plans p on p.field_id = v.field::uuid and p.crop_year = extract(year from current_date)::int + v.back
  left join public.crop_history h on h.field_id = v.field::uuid and h.crop_year = extract(year from current_date)::int + v.back;

-- ── Blend calculator products ──────────────────────────────────────────────
-- Fractions, not percents (0.46 = 46% N). The first three match the saved blends.
insert into public.fert_blend_products (name, n, p, k, s, zn, price_per_tonne, price_note, density_lb_ft3, active, sort_order) values
  ('46-0-0 Urea', 0.46, 0, 0, 0, 0, 820, 'Fall booking price, Prairie Ag Supply (example)', 48, true, 1),
  ('11-52-0 MAP', 0.11, 0.52, 0, 0, 0, 1080, 'Fall booking price, Prairie Ag Supply (example)', 59, true, 2),
  ('21-0-0-24 AMS', 0.21, 0, 0, 0.24, 0, 620, 'Fall booking price, Prairie Ag Supply (example)', 60, true, 3),
  ('0-0-60 Potash', 0, 0, 0.60, 0, 0, 640, 'Fall booking price, Prairie Ag Supply (example)', 62, true, 4),
  ('Polymer-coated urea 44-0-0', 0.44, 0, 0, 0, 0, 930, 'Quote, Sept', 45, true, 5),
  ('12-40-0-10S-1Zn', 0.12, 0.40, 0, 0.10, 0.01, 1160, 'Quote, Sept', 61, true, 6),
  ('16-20-0-13', 0.16, 0.20, 0, 0.13, 0, 790, 'Last spring', 63, false, 7);

-- ── Profit/Loss map: rows typed in by hand ─────────────────────────────────
-- On the three fields with a yield map. Land rent only on the rented ground.
insert into public.pl_field_lines (field_id, crop_year, side, line_key, label, unit, price_per_unit, amount, is_manual, removed, updated_by, updated_at)
select v.field::uuid, extract(year from current_date)::int, v.side, 'manual-' || md5(v.field || v.label), v.label, v.unit, v.price,
       case when v.unit = 'ac' then round(b.acres, 1) else v.amount end, true, false, '0de30000-0000-4000-8000-0000000000a1', now() - interval '12 days'
  from (values
    ('0de30000-0000-4000-8000-000000000101', 'input', 'Labour', 'ac', 22.00, null::numeric),
    ('0de30000-0000-4000-8000-000000000101', 'input', 'Trucking to the elevator', 'bu', 0.18, 7400),
    ('0de30000-0000-4000-8000-000000000102', 'input', 'Labour', 'ac', 22.00, null),
    ('0de30000-0000-4000-8000-000000000102', 'output', 'Straw sale (example neighbour)', 'bale', 35.00, 240),
    ('0de30000-0000-4000-8000-000000000113', 'input', 'Irrigation power', 'ac', 41.50, null),
    ('0de30000-0000-4000-8000-000000000113', 'input', 'Seed cleaning and certification', 'ac', 9.00, null)
  ) v(field, side, label, unit, price, amount)
  join public.field_boundaries b on b.field_id = v.field::uuid and b.valid_to is null;
