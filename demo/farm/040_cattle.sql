-- Cattle: two ranches (the home yard and the Willow Ridge summer pasture),
-- pastures with boundaries, water, herd groups, grazing moves, winter feed.
-- Ids: ranches 04NN, pastures 041N, herd groups 042N, feed types 043N.

insert into public.ranches (id, name, sort_order, latitude, longitude, grazing_utilization_rate, grazing_precip_mm,
  premises_id, brand, brand_location, address, owner_name, owner_phone,
  bulls_in_on, bulls_out_on, heifer_bulls_in_on, weaning_date, calf_sale_month, steer_sale_weight_lb, heifer_sale_weight_lb)
values
  ('0de30000-0000-4000-8000-000000000401', 'Home Ranch', 1, 52.4562, -113.5396, 0.75, 450,
   'AB0123456', 'PC lazy bar', 'Left hip', 'Box 41, Prairie Creek, AB', 'Sam Demo', '403-555-0100',
   make_date(extract(year from current_date)::int, 6, 20), make_date(extract(year from current_date)::int, 8, 31),
   make_date(extract(year from current_date)::int, 6, 10), current_date + 21, 11, 600, 560),
  ('0de30000-0000-4000-8000-000000000402', 'Willow Ridge', 2, 52.3850, -113.6650, 0.70, 430,
   'AB0123457', 'PC lazy bar', 'Left hip', 'Range Road 263, Prairie Creek, AB', 'Sam Demo', '403-555-0100',
   make_date(extract(year from current_date)::int, 6, 20), make_date(extract(year from current_date)::int, 8, 31),
   null, current_date + 21, 11, 600, 560);

update public.farm_setup set main_ranch_id = '0de30000-0000-4000-8000-000000000401';

-- Pastures (the map). Willow Ridge paddocks sit around 52.385 N, -113.665 W.
insert into public.pastures (id, name, legal_description, boundary, area_acres, pasture_type, grazing_system, harvest_efficiency, min_rest_days)
select v.id::uuid, v.name, v.legal, st_multi(st_setsrid(v.g, 4326)),
       round((st_area(v.g::geography) / 4046.8564)::numeric, 1), v.ptype, 'rotational', v.eff, v.rest
from (values
  ('0de30000-0000-4000-8000-000000000411', 'North Paddock',  'Willow Ridge · N-8-41-26-W4',  st_makeenvelope(-113.6800, 52.3895, -113.6563, 52.3965, 4326), 'native',   0.45, 45),
  ('0de30000-0000-4000-8000-000000000412', 'Creek Paddock',  'Willow Ridge · NW-5-41-26-W4', st_makeenvelope(-113.6800, 52.3823, -113.6681, 52.3893, 4326), 'tame',     0.55, 30),
  ('0de30000-0000-4000-8000-000000000413', 'South Paddock',  'Willow Ridge · E-5-41-26-W4',  st_makeenvelope(-113.6679, 52.3751, -113.6563, 52.3893, 4326), 'tame',     0.55, 30),
  ('0de30000-0000-4000-8000-000000000414', 'Bush Quarter',   'Willow Ridge · SW-5-41-26-W4', st_makeenvelope(-113.6800, 52.3751, -113.6681, 52.3821, 4326), 'native',   0.40, 45),
  ('0de30000-0000-4000-8000-000000000415', 'Yard Pasture',   'Home Ranch · SW-14-42-25-W4',  st_makeenvelope(-113.5617, 52.4501, -113.5501, 52.4571, 4326), 'tame',     0.55, 28),
  ('0de30000-0000-4000-8000-000000000416', 'East Bush',      'Home Ranch · NW-14-42-25-W4',  st_makeenvelope(-113.5617, 52.4573, -113.5501, 52.4643, 4326), 'native',   0.45, 40),
  ('0de30000-0000-4000-8000-000000000417', 'Hay Flat aftermath', 'Home Ranch · NW-12-42-25-W4', st_makeenvelope(-113.5380, 52.4429, -113.5264, 52.4499, 4326), 'aftermath', 0.60, 21)
) as v(id, name, legal, g, ptype, eff, rest);

update public.pastures set boundary_analysis = st_multi(st_buffer(boundary::geography, -15)::geometry);

-- The grazing calculator's view of the same pastures.
insert into public.grazing_pastures (name, sort_order, km2, non_grazeable_ac, irrigated_ac, grazeable_irrigated_ac, grass_quality, active, ranch_id, pasture_id)
select p.name, row_number() over (partition by r.id order by p.name), round((p.area_acres * 0.00404686)::numeric, 3),
       case p.name when 'Bush Quarter' then 35 when 'North Paddock' then 12 when 'East Bush' then 25 else 4 end,
       0, 0,
       case p.pasture_type when 'tame' then 'Good' when 'aftermath' then 'Excellent' else 'Fair' end,
       true, r.id, p.id
from public.pastures p
join public.ranches r on r.id = case when p.legal_description like 'Willow Ridge%' then '0de30000-0000-4000-8000-000000000402'::uuid else '0de30000-0000-4000-8000-000000000401'::uuid end
where p.id::text like '0de30000-0000-4000-8000-00000000041%';

-- Water.
insert into public.cattle_water (name, kind, drinkable, geom, source, notes, serves, created_by) values
  ('North dugout',        'dugout', true,  st_setsrid(st_makepoint(-113.6690, 52.3935), 4326), 'manual', 'Fenced, solar pump to a trough on the east side.', array['0de30000-0000-4000-8000-000000000411'::uuid], (select id from public.users order by created_at limit 1)),
  ('Prairie Creek crossing', 'other', true, st_setsrid(st_makepoint(-113.6745, 52.3860), 4326), 'manual', 'Gravel crossing on the creek. Good water until freeze-up.', array['0de30000-0000-4000-8000-000000000412'::uuid], (select id from public.users order by created_at limit 1)),
  ('South dugout',        'dugout', true,  st_setsrid(st_makepoint(-113.6610, 52.3790), 4326), 'manual', null, array['0de30000-0000-4000-8000-000000000413'::uuid], (select id from public.users order by created_at limit 1)),
  ('Bush spring',         'spring', true,  st_setsrid(st_makepoint(-113.6750, 52.3780), 4326), 'manual', 'Slows to a trickle by late August.', array['0de30000-0000-4000-8000-000000000414'::uuid], (select id from public.users order by created_at limit 1)),
  ('Yard trough',         'trough', true,  st_setsrid(st_makepoint(-113.5510, 52.4540), 4326), 'manual', 'Heated trough on the yard well. Check the float daily in winter.', array['0de30000-0000-4000-8000-000000000415'::uuid], (select id from public.users order by created_at limit 1)),
  ('East Bush dugout',    'dugout', true,  st_setsrid(st_makepoint(-113.5560, 52.4610), 4326), 'manual', null, array['0de30000-0000-4000-8000-000000000416'::uuid], (select id from public.users order by created_at limit 1)),
  ('Hay Flat slough',     'pond',   false, st_setsrid(st_makepoint(-113.5300, 52.4470), 4326), 'manual', 'Shallow and green by August — not for drinking.', array['0de30000-0000-4000-8000-000000000417'::uuid], (select id from public.users order by created_at limit 1));

-- Herd groups (the herd as counts by class).
insert into public.herd_counts (id, ranch_id, class_name, head_count, notes, sort_order, avg_weight_lb, au_equivalent, graze_start, graze_end, feed_class, bcs, target_bcs, target_gain_lb, ration_note, background_head) values
  ('0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000401', 'Cows', 100, 'Mature cows, calving from mid-March.', 1, 1350, 1.0,
   make_date(extract(year from current_date)::int, 5, 15), make_date(extract(year from current_date)::int, 11, 10), 'cow', 3, 3, null, 'Hay and greenfeed, straw to stretch it in mid-pregnancy.', null),
  ('0de30000-0000-4000-8000-000000000422', '0de30000-0000-4000-8000-000000000401', 'Calves', 97, 'Weaning in about three weeks; heifer calves to keep are tagged yellow.', 2, 540, 0.5,
   make_date(extract(year from current_date)::int, 5, 15), make_date(extract(year from current_date)::int, 11, 10), 'backgrounder', 3, 3, 1.5, null, 22),
  ('0de30000-0000-4000-8000-000000000423', '0de30000-0000-4000-8000-000000000401', 'Bred heifers', 28, 'Bred to the calving-ease bull; due two weeks ahead of the cows.', 3, 1050, 0.85,
   make_date(extract(year from current_date)::int, 5, 15), make_date(extract(year from current_date)::int, 11, 10), 'bred_heifer', 3, 3.5, 1.0, 'Alfalfa hay and a little barley so they keep growing.', null),
  ('0de30000-0000-4000-8000-000000000424', '0de30000-0000-4000-8000-000000000401', 'Bulls', 6, null, 4, 2100, 1.5,
   make_date(extract(year from current_date)::int, 9, 1), make_date(extract(year from current_date)::int, 11, 30), 'bull', 3, 3, null, null, null),
  ('0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000402', 'Cows', 52, 'Older cows; summer on Willow Ridge, home for calving.', 1, 1400, 1.0,
   make_date(extract(year from current_date)::int, 5, 20), make_date(extract(year from current_date)::int, 11, 1), 'cow', 3, 3, null, null, null),
  ('0de30000-0000-4000-8000-000000000426', '0de30000-0000-4000-8000-000000000402', 'Calves', 50, null, 2, 560, 0.5,
   make_date(extract(year from current_date)::int, 5, 20), make_date(extract(year from current_date)::int, 11, 1), 'backgrounder', 3, 3, 1.5, null, 8),
  ('0de30000-0000-4000-8000-000000000427', '0de30000-0000-4000-8000-000000000402', 'Bulls', 2, null, 3, 2150, 1.5,
   make_date(extract(year from current_date)::int, 6, 20), make_date(extract(year from current_date)::int, 11, 1), 'bull', 3, 3, null, null, null);

-- Grazing moves this season. The open row (moved_out_on null) is where the herd is now.
insert into public.grazing_events (pasture_id, herd_id, head_count, avg_animal_weight_lb, turned_in_on, moved_out_on, notes) values
  ('0de30000-0000-4000-8000-000000000411', '0de30000-0000-4000-8000-000000000425', 102, 1050, current_date - 140, current_date - 95,  'Turned out pairs.'),
  ('0de30000-0000-4000-8000-000000000412', '0de30000-0000-4000-8000-000000000425', 102, 1080, current_date - 95,  current_date - 58,  'Bulls in with the cows on the way.'),
  ('0de30000-0000-4000-8000-000000000414', '0de30000-0000-4000-8000-000000000425', 104, 1110, current_date - 58,  current_date - 18,  'Grazed hard; rest it next spring.'),
  ('0de30000-0000-4000-8000-000000000413', '0de30000-0000-4000-8000-000000000425', 104, 1130, current_date - 18,  null,               'Plenty of grass left; two to three weeks more.'),
  ('0de30000-0000-4000-8000-000000000415', '0de30000-0000-4000-8000-000000000421', 197, 1020, current_date - 150, current_date - 110, null),
  ('0de30000-0000-4000-8000-000000000416', '0de30000-0000-4000-8000-000000000421', 197, 1060, current_date - 110, current_date - 45,  null),
  ('0de30000-0000-4000-8000-000000000415', '0de30000-0000-4000-8000-000000000421', 197, 1100, current_date - 45,  current_date - 8,   'Second pass on the yard pasture.'),
  ('0de30000-0000-4000-8000-000000000417', '0de30000-0000-4000-8000-000000000421', 225, 1090, current_date - 8,   null,               'Bred heifers in with the pairs on the aftermath.');

-- Winter feed plans (one per ranch; the ranch trigger made the rows).
update public.feed_plans set dmi_pct = 2.4, waste_pct = 12, hay_bale_lb = 1400, start_month = 11, start_day = 15, end_month = 5, end_day = 15,
       calving_month = 3, calving_day = 15, coat = 'winter', sheltered = true, muddy = false, reserve_pct = 15, ration_confirmed = true
 where ranch_id = '0de30000-0000-4000-8000-000000000401';
update public.feed_plans set dmi_pct = 2.5, waste_pct = 12, hay_bale_lb = 1400, start_month = 11, start_day = 1, end_month = 5, end_day = 20,
       calving_month = 3, calving_day = 25, coat = 'winter', sheltered = false, reserve_pct = 15
 where ranch_id = '0de30000-0000-4000-8000-000000000402';

insert into public.feed_types (id, name, default_unit, default_lb_per_bale, is_bedding, sort_order, category, legume, dm_pct, tdn_pct, cp_pct, storage_loss_pct, price_per_tonne, book_note) values
  ('0de30000-0000-4000-8000-000000000431', 'Alfalfa-brome hay', 'round', 1400, false, 1, 'hay', true, 87, 58, 14.5, 5, 150, null),
  ('0de30000-0000-4000-8000-000000000432', 'Grass hay', 'round', 1300, false, 2, 'hay', false, 88, 54, 9.5, 5, 125, null),
  ('0de30000-0000-4000-8000-000000000433', 'Oat-pea greenfeed', 'round', 1500, false, 3, 'greenfeed', false, 85, 60, 11, 6, 120, 'Test for nitrates before feeding.'),
  ('0de30000-0000-4000-8000-000000000434', 'Barley straw', 'round', 1100, false, 4, 'straw', false, 90, 42, 4.5, 3, 55, null),
  ('0de30000-0000-4000-8000-000000000435', 'Barley grain', 'lb', null, false, 5, 'grain', false, 88, 82, 11.5, 1, 245, null),
  ('0de30000-0000-4000-8000-000000000436', 'Wheat straw (bedding)', 'round', 1000, true, 6, 'straw', false, 90, 40, 3.5, 3, 45, null),
  ('0de30000-0000-4000-8000-000000000437', 'Range pellets 32%', 'lb', null, false, 7, 'supplement', false, 90, 75, 32, 0, 640, 'Bagged; for the bred heifers in deep cold.');

insert into public.feed_group_ration (herd_count_id, feed_type_id, dm_share_pct, waste_pct, sort_order) values
  ('0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000432', 45, 12, 1),
  ('0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000433', 35, 12, 2),
  ('0de30000-0000-4000-8000-000000000421', '0de30000-0000-4000-8000-000000000434', 20, 15, 3),
  ('0de30000-0000-4000-8000-000000000422', '0de30000-0000-4000-8000-000000000433', 50, 10, 1),
  ('0de30000-0000-4000-8000-000000000422', '0de30000-0000-4000-8000-000000000431', 30, 10, 2),
  ('0de30000-0000-4000-8000-000000000422', '0de30000-0000-4000-8000-000000000435', 20, 2, 3),
  ('0de30000-0000-4000-8000-000000000423', '0de30000-0000-4000-8000-000000000431', 60, 10, 1),
  ('0de30000-0000-4000-8000-000000000423', '0de30000-0000-4000-8000-000000000433', 30, 12, 2),
  ('0de30000-0000-4000-8000-000000000423', '0de30000-0000-4000-8000-000000000435', 10, 2, 3),
  ('0de30000-0000-4000-8000-000000000424', '0de30000-0000-4000-8000-000000000432', 70, 12, 1),
  ('0de30000-0000-4000-8000-000000000424', '0de30000-0000-4000-8000-000000000435', 30, 2, 2),
  ('0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000432', 55, 12, 1),
  ('0de30000-0000-4000-8000-000000000425', '0de30000-0000-4000-8000-000000000434', 45, 15, 2),
  ('0de30000-0000-4000-8000-000000000426', '0de30000-0000-4000-8000-000000000433', 70, 10, 1),
  ('0de30000-0000-4000-8000-000000000426', '0de30000-0000-4000-8000-000000000435', 30, 2, 2),
  ('0de30000-0000-4000-8000-000000000427', '0de30000-0000-4000-8000-000000000432', 100, 12, 1);

insert into public.feed_tests (feed_type_id, sampled_on, lab, dm_pct, cp_pct, tdn_pct, adf_pct, ndf_pct, nitrate_pct, ca_pct, p_pct, notes) values
  ('0de30000-0000-4000-8000-000000000431', current_date - 34, 'Central Feed Testing Lab', 86.8, 15.2, 59.1, 33.5, 44.0, 0.02, 1.25, 0.24, 'First cut, Hay Flat. Good bred-heifer hay.'),
  ('0de30000-0000-4000-8000-000000000432', current_date - 34, 'Central Feed Testing Lab', 88.5, 8.9, 53.2, 38.4, 60.5, 0.01, 0.42, 0.18, 'Bought-in grass hay. Low protein: needs the greenfeed with it.'),
  ('0de30000-0000-4000-8000-000000000433', current_date - 26, 'Central Feed Testing Lab', 84.1, 11.6, 60.4, 34.9, 52.2, 0.31, 0.55, 0.26, 'Nitrate a little high; keep it under half the ration for pregnant cows.'),
  ('0de30000-0000-4000-8000-000000000434', current_date - 26, 'Central Feed Testing Lab', 90.2, 4.3, 43.0, 49.8, 74.1, 0.00, 0.30, 0.07, null);

-- Feed on hand at the home yard: last fall's opening count, what went into the
-- stack this summer, and last winter's feeding (below) taken off.
insert into public.feed_inventory (ranch_id, feed_type_id, moved_on, kind, quantity, unit, lb_per_bale, note, updated_by) values
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000431', current_date - 330, 'opening',   520, 'round', 1400, 'Fall count after second cut.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000432', current_date - 330, 'opening',   700, 'round', 1300, null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000433', current_date - 330, 'opening',   480, 'round', 1500, null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000434', current_date - 330, 'opening',   600, 'round', 1100, null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000435', current_date - 330, 'opening', 90000, 'lb', null, 'Hopper bin #9.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000436', current_date - 330, 'opening',   300, 'round', 1000, null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000431', current_date - 110, 'harvested', 380, 'round', 1400, 'First cut, Hay Flat.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000431', current_date - 50,  'harvested', 240, 'round', 1400, 'Second cut, Hay Flat.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000432', current_date - 40,  'purchased', 400, 'round', 1300, 'From a neighbour, $125/t delivered.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000433', current_date - 20,  'purchased', 320, 'round', 1500, 'Oat-pea greenfeed from a neighbour, tested before buying.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000434', current_date - 30,  'harvested', 450, 'round', 1100, 'Baled behind the combine on the barley.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000435', current_date - 32,  'harvested', 120000, 'lb', null, 'Feed barley kept back from Railway Quarter.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000401', '0de30000-0000-4000-8000-000000000433', current_date - 300, 'shrink',    -25, 'round', 1500, 'Bottom bales spoiled in the wet corner.', '0de30000-0000-4000-8000-0000000000a1');

-- Last winter's feeding records, month by month, for the home cows.
with months as (
  select gs as m, (date_trunc('month', current_date) - make_interval(months => gs))::date as start
  from generate_series(6, 11) gs
), rec as (
  insert into public.feed_records (ranch_id, herd_group, herd_count_id, period_start, period_end, head_count, notes, updated_by)
  select '0de30000-0000-4000-8000-000000000401', 'Cows', '0de30000-0000-4000-8000-000000000421', start, (start + interval '1 month - 1 day')::date,
         180, case when m = 7 then 'Calving month: extra straw for bedding.' end, '0de30000-0000-4000-8000-0000000000a2'
  from months
  returning id, period_start
)
insert into public.feed_record_lines (record_id, feed_type_id, feed_type_name, quantity, unit, lb_per_bale, purpose, sort_order)
select rec.id, l.ft::uuid, l.name, l.q, 'round', l.lbb, l.purpose, l.so
from rec
cross join (values
  ('0de30000-0000-4000-8000-000000000432', 'Grass hay', 95, 1300, 'feed', 1),
  ('0de30000-0000-4000-8000-000000000433', 'Oat-pea greenfeed', 70, 1500, 'feed', 2),
  ('0de30000-0000-4000-8000-000000000434', 'Barley straw', 60, 1100, 'feed', 3),
  ('0de30000-0000-4000-8000-000000000436', 'Wheat straw (bedding)', 40, 1000, 'bedding', 4)
) as l(ft, name, q, lbb, purpose, so);

-- Calf sales, the last three falls.
insert into public.cattle_sales (ranch, crop_year, animal_class, head, sale_date, delivery_date, avg_weight_lb, total_lb, price_per_lb, total_price, buyer, notes)
select s.ranch, extract(year from current_date)::int - s.ago, s.cls, s.head,
       make_date(extract(year from current_date)::int - s.ago, 11, 14), make_date(extract(year from current_date)::int - s.ago, 11, 14),
       s.wt, s.head * s.wt, s.price, round(s.head * s.wt * s.price, 2), 'County Line Auction Mart', s.note
from (values
  ('Home Ranch',   1, 'steers',  48, 598, 4.38, 'Strong sale; buyers short of calves.'),
  ('Home Ranch',   1, 'heifers', 26, 562, 4.05, null),
  ('Willow Ridge', 1, 'steers',  24, 612, 4.31, null),
  ('Willow Ridge', 1, 'heifers', 18, 571, 3.98, null),
  ('Home Ranch',   2, 'steers',  50, 585, 3.62, null),
  ('Home Ranch',   2, 'heifers', 28, 548, 3.31, null),
  ('Willow Ridge', 2, 'steers',  25, 601, 3.55, null),
  ('Willow Ridge', 2, 'heifers', 17, 560, 3.24, null),
  ('Home Ranch',   3, 'steers',  47, 590, 3.05, 'Dry year: calves came off grass light.'),
  ('Home Ranch',   3, 'heifers', 30, 541, 2.84, null),
  ('Home Ranch',   3, 'runts',    4, 410, 2.60, null)
) as s(ranch, ago, cls, head, wt, price, note);

insert into public.cattle_cost_assumptions (ranch, crop_year, cow_cost_per_head, feed_cost_per_head, pasture_cost_per_head, vet_cost_per_head, other_cost_per_head, death_loss_pct, weaning_rate_pct, cost_of_gain_per_lb, cull_cow_price_cwt, notes)
values
  ('Home Ranch',   extract(year from current_date)::int, 140, 560, 120, 48, 95, 2.0, 91, 0.95, 185, 'Feed at this year''s hay prices; pasture is our own land at rental value.'),
  ('Willow Ridge', extract(year from current_date)::int, 140, 590, 165, 48, 105, 2.5, 89, 0.95, 185, 'Hauling to and from Willow Ridge is in "other".');

insert into public.mineral_programs (ranch_id, product, quantity, unit, per, when_fed, supplier_contact_id, price_each, notes) values
  ('0de30000-0000-4000-8000-000000000401', '2:1 breeder mineral', 12, 'bag', 'month', 'Year round', '0de30000-0000-4000-8000-000000000307', 38.50, 'Loose mineral in covered feeders.'),
  ('0de30000-0000-4000-8000-000000000401', 'Cobalt-iodized salt', 6, 'block', 'month', 'Year round', '0de30000-0000-4000-8000-000000000307', 14.25, null),
  ('0de30000-0000-4000-8000-000000000402', 'Mineral tubs', 24, 'tub', 'season', 'May to October', '0de30000-0000-4000-8000-000000000307', 95.00, 'Placed away from water to spread grazing.');

-- Individual animals: the bulls and a few cows with a story, plus groups.
insert into public.cattle_groups (id, name, notes_md, active, ranch_id, avg_weight_lb) values
  ('0de30000-0000-4000-8000-000000000441', 'Home cows', 'Main cow herd at the home yard.', true, '0de30000-0000-4000-8000-000000000401', 1350),
  ('0de30000-0000-4000-8000-000000000442', 'Willow Ridge cows', 'Older cows that summer on Willow Ridge.', true, '0de30000-0000-4000-8000-000000000402', 1400),
  ('0de30000-0000-4000-8000-000000000443', 'Bred heifers', null, true, '0de30000-0000-4000-8000-000000000401', 1050),
  ('0de30000-0000-4000-8000-000000000444', 'Bulls', null, true, '0de30000-0000-4000-8000-000000000401', 2100);

insert into public.cattle (tag, name, sex, breed, birth_date, dam_tag, sire_tag, status, group_id, location, acquired_date, notes_md, ranch_id) values
  ('B101', 'Duke',    'bull', 'Black Angus',      current_date - 2600, null, null, 'active', '0de30000-0000-4000-8000-000000000444', 'Bull pen', current_date - 2200, 'Calving-ease bull; used on the heifers.', '0de30000-0000-4000-8000-000000000401'),
  ('B102', 'Ranger',  'bull', 'Black Angus',      current_date - 1900, null, null, 'active', '0de30000-0000-4000-8000-000000000444', 'Bull pen', current_date - 1500, null, '0de30000-0000-4000-8000-000000000401'),
  ('B103', 'Moose',   'bull', 'Red Angus',        current_date - 1500, null, null, 'active', '0de30000-0000-4000-8000-000000000444', 'Bull pen', current_date - 1150, null, '0de30000-0000-4000-8000-000000000401'),
  ('B104', 'Tank',    'bull', 'Simmental',        current_date - 1200, null, null, 'active', '0de30000-0000-4000-8000-000000000444', 'Bull pen', current_date - 800,  'Semen tested sound this spring.', '0de30000-0000-4000-8000-000000000401'),
  ('B105', 'Boone',   'bull', 'Black Angus',      current_date - 800,  null, null, 'active', '0de30000-0000-4000-8000-000000000444', 'Bull pen', current_date - 420,  'Yearling bull, first season.', '0de30000-0000-4000-8000-000000000401'),
  ('B106', 'Chief',   'bull', 'Black Angus',      current_date - 3300, null, null, 'culled', null, null, current_date - 3000, 'Sore feet; sold as a cull last fall.', '0de30000-0000-4000-8000-000000000401'),
  ('B201', 'Hank',    'bull', 'Black Angus',      current_date - 1700, null, null, 'active', null, 'Willow Ridge', current_date - 1300, null, '0de30000-0000-4000-8000-000000000402'),
  ('B202', 'Rocky',   'bull', 'Red Angus',        current_date - 1400, null, null, 'active', null, 'Willow Ridge', current_date - 1000, null, '0de30000-0000-4000-8000-000000000402'),
  ('1452', null,      'cow',  'Black Angus cross', current_date - 3650, '0918', 'B106', 'active', '0de30000-0000-4000-8000-000000000441', 'Hay Flat', null, 'Best cow in the herd: ten calves, never assisted.', '0de30000-0000-4000-8000-000000000401'),
  ('1618', null,      'cow',  'Black Angus cross', current_date - 2900, '1102', 'B106', 'active', '0de30000-0000-4000-8000-000000000441', 'Hay Flat', null, 'Bad bag — check at calving.', '0de30000-0000-4000-8000-000000000401'),
  ('1733', null,      'cow',  'Simmental cross',   current_date - 2500, '1210', 'B104', 'active', '0de30000-0000-4000-8000-000000000441', 'Hay Flat', null, null, '0de30000-0000-4000-8000-000000000401'),
  ('2104', null,      'heifer','Black Angus cross', current_date - 560, '1452', 'B101', 'active', '0de30000-0000-4000-8000-000000000443', 'Hay Flat', null, 'Kept from 1452.', '0de30000-0000-4000-8000-000000000401'),
  ('0977', null,      'cow',  'Black Angus cross', current_date - 4400, null, null, 'culled', '0de30000-0000-4000-8000-000000000442', null, null, 'Open at preg check; sold.', '0de30000-0000-4000-8000-000000000402'),
  ('1288', null,      'cow',  'Red Angus cross',   current_date - 3300, null, null, 'active', '0de30000-0000-4000-8000-000000000442', 'South Paddock', null, null, '0de30000-0000-4000-8000-000000000402');

insert into public.cattle_events (cattle_id, group_id, event_type, event_date, weight_lb, product, dose, location, notes, created_by)
select c.id, c.group_id, e.et::public.cattle_event_type, current_date - e.ago, e.wt, e.product, e.dose, e.loc, e.notes, '0de30000-0000-4000-8000-0000000000a1'
from public.cattle c
join (values
  ('B104', 'other',     150, null::numeric, null, null, 'Bull pen', 'Breeding soundness exam: passed.'),
  ('B105', 'weight',    150, 1480, null, null, 'Bull pen', null),
  ('1618', 'treatment',  60, null, 'Oxytetracycline', '45 mL', 'Hay Flat', 'Foot rot, left hind.'),
  ('1452', 'calving',   205, null, null, null, 'Calving barn', 'Bull calf, unassisted, 88 lb.'),
  ('0977', 'preg_check',340, null, null, null, 'Willow Ridge', 'Open.'),
  ('0977', 'sale',      330, 1420, null, null, 'County Line Auction Mart', 'Sold as a cull.')
) as e(tag, et, ago, wt, product, dose, loc, notes) on e.tag = c.tag;

insert into public.cattle_events (group_id, event_type, event_date, product, dose, location, notes, created_by) values
  ('0de30000-0000-4000-8000-000000000441', 'branding',    current_date - 125, 'Calves: 7-way clostridial + IBR/BVD intranasal', '2 mL', 'Home corrals', 'Branded and vaccinated 97 calves. Neighbours helped.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000442', 'branding',    current_date - 128, 'Calves: 7-way clostridial', '5 mL', 'Willow Ridge pens', '50 calves.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000441', 'vaccination', current_date - 210, 'Cows: scour vaccine', '2 mL', 'Home corrals', 'Pre-calving shots.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000442', 'movement',    current_date - 140, null, null, 'Willow Ridge', 'Hauled 52 pairs to Willow Ridge (4 loads).', '0de30000-0000-4000-8000-0000000000a2');
