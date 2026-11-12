-- Yard, fleet and spray screens that were empty in the demo (all made up):
-- the unloading yards the distance router measures to, the bulk fuel tanks,
-- the yearly semi inspections, the other crops each field could grow next
-- year, and the resistance group behind each product so the spray check can
-- count them. Runs after 060_operations.sql and 070_agronomy.sql.

-- ── Unloading yards (Travel & trucking → Yards) ──────────────────────────
-- Besides the main yard's bins: the two the feed and the straw go to.
insert into public.farm_yards (name, lat, lng, active, sort, note) values
  ('North Yard',         52.50790, -113.50310, true, 1, 'The four bins on the north half section. Malt barley stays here.'),
  ('Hay yard',           52.44680, -113.53400, true, 2, 'Below the hill on Hay Flat. Bales stack here off the baler and the feed truck loads from it all winter.'),
  ('Willow Ridge yard',  52.38560, -113.66420, true, 3, 'Panels, mineral and the winter bale stack for the Willow Ridge cows.'),
  ('Old home place',     52.46310, -113.57200, false, 4, 'Not used since the quonset came down. Kept for the distances.');

-- ── Bulk fuel (Utilities → Fuel) ─────────────────────────────────────────
insert into public.fuel_tanks (name, location, product, capacity_l, level_l, level_on, level_at, level_source, notes, lat, lng) values
  ('Diesel #1 (main)', 'Main Yard, east of the shop', 'farm_diesel', 22700, 14300, current_date - 2, now() - interval '2 days', 'Dipped', 'Marked diesel. Gravity feed with a filter and a meter.', 52.45660, -113.54180),
  ('Diesel #2',        'Main Yard, by the bins',     'farm_diesel', 11400,  3100, current_date - 2, now() - interval '2 days', 'Dipped', 'Kept for the trucks at harvest; let it run down over winter.', 52.45640, -113.54090),
  ('Clear diesel',     'Main Yard, by the shop door', 'clear_diesel', 2300,  1650, current_date - 9, now() - interval '9 days', 'Dipped', 'Road diesel for the semis. Taxed fuel: keep the receipts separate.', 52.45655, -113.54210),
  ('Gas',              'Main Yard, by the shop door', 'farm_gasoline', 2300,   820, current_date - 9, now() - interval '9 days', 'Dipped', 'Pickups, the quad and the pressure washer.', 52.45650, -113.54225),
  ('North Yard diesel', 'North Yard',                'farm_diesel',  4500,  2600, current_date - 16, now() - interval '16 days', 'Dipped', 'Fills the truck and the auger tractor at the north bins.', 52.50780, -113.50360);

-- ── The yearly semi inspection (Checklists → Trucks) ─────────────────────
-- One signed off in the spring and one started this week and not finished, so
-- the screen shows both states. Answers are 'ok', 'fix' or 'na' per item; the
-- notes are per section.
with items(key) as (
  select unnest(array[
    'radiator','fan','belts','fluids','air_filter','battery','steering','hoses','shocks','front_suspension',
    'compressor','front_chambers','front_slack','front_air_lines','ground_leaks','headlights','front_hazards',
    'front_signals','front_clearance','windshield','front_plate','steer_tire','steer_rim','steer_bearing_oil',
    'decal','mirrors','driver_door','side_windows','fuel_cap','handrail','steps','fuel_tank','fuel_lines','exhaust',
    'compartments','drive1_tire','drive1_rim','drive2_tire','drive2_rim','fifth_wheel_plate','fifth_wheel_jaws',
    'kingpin','hitches','chains','drive_shaft','drive_suspension','drive_axle','side_signals','side_brake_lights',
    'backing_lights','drive_chambers','drive_slack','drive_air_lines','mud_flap','body','trailer_decal',
    'trailer_body','trailer_frame','landing_gear','trailer_air_lines','trailer_clearance','load_security',
    'trailer1_tire','trailer1_rim','trailer2_tire','trailer2_rim','sliding_tandem','trailer_chambers',
    'trailer_slack','trailer_suspension','trailer_axle','rear_signals','rear_hazards','rear_brake_lights',
    'rear_clearance','rear_plate','doors_gates','rear_windows','rear_mud_flaps','rear_exhaust','passenger_side',
    'seat_mirrors','seat_belt','pedals','steering_play','gauges','fuel_level','cab_windows','wipers','defroster',
    'horn','engine_smooth','engine_noise','clutch_noise','radio','throttle','air_buildup','service_brake_drive',
    'extinguisher','warning_device','first_aid','documents','ppe','tools','spares','ab_chocked','ab_valves_set',
    'ab_disconnect','ab_trailer_pop','ab_low_warn_on','ab_service_line','ab_park_pushed','ab_park_pop',
    'ab_reconnect','ab_buildup','ab_low_warn_off','ab_cutout','ab_cutin','ab_hold','ab_loss','ab_release',
    'ab_unchock','ab_foot_valve','ab_hand_valve'])
)
insert into public.truck_inspections (equipment_id, answers, notes, started_by, started_at, updated_at)
select '0de30000-0000-4000-8000-000000000806'::uuid,
       (select jsonb_object_agg(key, case when key in ('chains', 'hitches', 'radio') then 'na'
                                          when key in ('mud_flap', 'trailer_clearance') then 'fix'
                                          else 'ok' end)
          from items),
       '{"driver_side": "Left mud flap bracket cracked — welded it the same afternoon.", "trailer": "Two clearance lights out on the trailer; bulbs on order."}'::jsonb,
       '0de30000-0000-4000-8000-0000000000a2'::uuid, now() - interval '214 days', now() - interval '214 days'
union all
select '0de30000-0000-4000-8000-000000000807'::uuid,
       (select jsonb_object_agg(key, 'ok') from items where key in (
          'radiator','fan','belts','fluids','air_filter','battery','steering','hoses','shocks','front_suspension',
          'compressor','front_chambers','front_slack','front_air_lines','ground_leaks','headlights','front_hazards',
          'front_signals','front_clearance','windshield','front_plate')),
       '{}'::jsonb,
       '0de30000-0000-4000-8000-0000000000a2'::uuid, now() - interval '3 days', now() - interval '3 days';

-- ── The other crops a field could grow (Rotation → Plan) ─────────────────
-- Next year's plan has one crop per field; these are the alternatives that
-- were kept on the list beside it.
insert into public.crop_plan_options (field_id, crop_year, crop_id, sort, note)
select v.field::uuid, extract(year from current_date)::int + 1, c.id, v.sort, v.note
from (values
  ('0de30000-0000-4000-8000-000000000101', 'Barley', 1, 'Second choice if the pea seed gets expensive.'),
  ('0de30000-0000-4000-8000-000000000101', 'Oats',   2, null),
  ('0de30000-0000-4000-8000-000000000105', 'Barley', 1, null),
  ('0de30000-0000-4000-8000-000000000107', 'Wheat',  1, 'Canola twice in four years here already — wheat is the safe one.'),
  ('0de30000-0000-4000-8000-000000000108', 'Peas',   1, 'Would help the nitrogen on the knolls.'),
  ('0de30000-0000-4000-8000-000000000110', 'Barley', 1, null),
  ('0de30000-0000-4000-8000-000000000112', 'Canola', 1, 'Only if the seed contract comes back.'),
  ('0de30000-0000-4000-8000-000000000115', 'Green Feed', 1, 'The cows would take all of it.')
) as v(field, crop_name, sort, note)
join public.crops c on c.name = v.crop_name;

-- ── The resistance group behind each product (Spray check) ───────────────
-- Keyed on the active, not the product: a tank mix of three names can be one
-- group. The groups are the numbers a label prints — herbicides on the
-- Canadian HRAC/WSSA numbering, fungicides on FRAC. Like the kit library in
-- 094, these rows arrive with a migration in the farm's own database, and the
-- demo loads the published structure rather than the migrations.
insert into public.chemical_moa (active, scheme, group_code, group_name, ph_sensitive, time_of_day, note) values
  ('GLYPHOSATE',           'herbicide', '9',  'EPSPS inhibitor', false, null, null),
  ('GLUFOSINATE-AMMONIUM', 'herbicide', '10', 'Glutamine synthetase inhibitor', false,
   'Spray it in the middle of the day: glutamine synthetase is scarcer in the dark, and what survives the night rebuilds the enzyme.', null),
  ('CLETHODIM',            'herbicide', '1',  'ACCase inhibitor', false, null, null),
  ('PINOXADEN',            'herbicide', '1',  'ACCase inhibitor', false, null, null),
  ('FLORASULAM',           'herbicide', '2',  'ALS inhibitor (triazolopyrimidine)', true, null, null),
  ('IMAZAMOX',             'herbicide', '2',  'ALS inhibitor (imidazolinone)', true, null, null),
  ('MCPA',                 'herbicide', '4',  'Synthetic auxin', false, null, null),
  ('BENTAZON',             'herbicide', '6',  'Photosystem II inhibitor', false, null, null),
  ('DIQUAT',               'herbicide', '22', 'Photosystem I electron diverter', false, null, null),
  ('PROTHIOCONAZOLE',      'fungicide', '3',  'DMI (sterol biosynthesis inhibitor)', false, null, null),
  ('TEBUCONAZOLE',         'fungicide', '3',  'DMI (sterol biosynthesis inhibitor)', false, null, null),
  ('FLUOPYRAM',            'fungicide', '7',  'SDHI (succinate dehydrogenase inhibitor)', false, null, null);

-- The products' own actives, spelled the way the group table keys on them.
-- Without these the spray check knows the product and not the group.
update public.jd_products p set actives_manual = v.actives
from (values
  ('0de30000-0000-4000-8000-000000000901', 'GLYPHOSATE'),
  ('0de30000-0000-4000-8000-000000000902', 'GLUFOSINATE-AMMONIUM'),
  ('0de30000-0000-4000-8000-000000000903', 'CLETHODIM'),
  ('0de30000-0000-4000-8000-000000000904', 'FLORASULAM; MCPA'),
  ('0de30000-0000-4000-8000-000000000905', 'PINOXADEN'),
  ('0de30000-0000-4000-8000-000000000906', 'IMAZAMOX; BENTAZON'),
  ('0de30000-0000-4000-8000-000000000907', 'MCPA'),
  ('0de30000-0000-4000-8000-000000000908', 'PROTHIOCONAZOLE; FLUOPYRAM'),
  ('0de30000-0000-4000-8000-000000000909', 'PROTHIOCONAZOLE; TEBUCONAZOLE'),
  ('0de30000-0000-4000-8000-000000000910', 'DIQUAT')
) as v(id, actives)
where p.id = v.id::uuid;
