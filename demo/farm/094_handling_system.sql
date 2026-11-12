-- The corral designer (/handling-system), which was empty in the demo: the
-- kit library, the home yard's pens as they stand, one alternative layout,
-- what is on hand, and the buried power line to keep clear of. All made up.
--
-- The kit library normally arrives with the migration that built the feature;
-- the demo loads the published structure, not the migrations, so the rows are
-- here. Ids: catalog 0c10-, sites 0c20-, versions 0c30-.

-- ── The kit library (Library tab) ─────────────────────────────────────────
-- site_id null means "every yard can use it". `counted` false is the stock and
-- machinery drawn to scale for clearance, which is not kit to buy.
insert into public.handling_catalog
  (id, key, name, category, width_ft, depth_ft, height_ft, color, panel_type, gate_type, animal_type, counted, sort_order, description)
values
  ('0de30000-0000-4000-8000-00000000c101', 'bar-panel-10',       '10 ft bar panel',       'Panel',          10,   5.5, 5.5, '#64748b', 'bars',       null,         null,   true,  10, null),
  ('0de30000-0000-4000-8000-00000000c102', 'bar-panel-12',       '12 ft bar panel',       'Panel',          12,   5.5, 5.5, '#64748b', 'bars',       null,         null,   true,  11, null),
  ('0de30000-0000-4000-8000-00000000c103', 'bar-panel-16',       '16 ft bar panel',       'Panel',          16,   5.5, 5.5, '#64748b', 'bars',       null,         null,   true,  12, null),
  ('0de30000-0000-4000-8000-00000000c104', 'wind-panel-12',      '12 ft wind fence',      'Panel',          12,   5.5, 7.0, '#475569', 'wind-fence', null,         null,   true,  20, 'Solid: draws as a double line marked WF'),
  ('0de30000-0000-4000-8000-00000000c105', 'gate-swing-12',      '12 ft gate',            'Gate',           12,   5.5, 5.5, '#16a34a', null,         'swinging',   null,   true,  30, 'Hinged one end; the arc is its swing'),
  ('0de30000-0000-4000-8000-00000000c106', 'gate-two-panel-24',  '24 ft two-panel gate',  'Gate',           24,   5.5, 5.5, '#15803d', null,         'two-panel',  null,   true,  31, 'Two leaves meeting mid-span'),
  ('0de30000-0000-4000-8000-00000000c107', 'gate-drive-over',    '14 ft drive-over',      'Gate',           14,   4,   1.0, '#4d7c0f', null,         'drive-over', null,   true,  32, 'Drive across it; drawn dashed and marked DO'),
  ('0de30000-0000-4000-8000-00000000c108', 'sort-gate-5way',     '5-way sorting gate',    'Sorting gate',   12,  12,   5.5, '#0891b2', null,         null,         null,   true,  40, 'Five arms at 72 degrees'),
  ('0de30000-0000-4000-8000-00000000c109', 'trough-10',          '10 ft water trough',    'Water',          10,   2,   2.0, '#2563eb', null,         null,         null,   true,  50, null),
  ('0de30000-0000-4000-8000-00000000c110', 'bale-feeder-round',  'Round bale feeder',     'Hay feeder',      6,   6,   4.0, '#ca8a04', null,         null,         null,   true,  60, null),
  ('0de30000-0000-4000-8000-00000000c111', 'feed-bunk-20',       '20 ft feed bunk',       'Feed bunk',      20,   3,   2.5, '#78716c', null,         null,         null,   true,  70, null),
  ('0de30000-0000-4000-8000-00000000c112', 'mineral-tub',        'Mineral tub',           'Salt / mineral',  3,   3,   2.5, '#db2777', null,         null,         null,   true,  80, null),
  ('0de30000-0000-4000-8000-00000000c113', 'animal-cow',         'Cow',                   'Animal',          7,   2.5, 4.6, '#f97316', null,         null,         'cow',  false, 100, 'To scale, for clearance. Not counted as kit'),
  ('0de30000-0000-4000-8000-00000000c114', 'animal-bull',        'Bull',                  'Animal',          7.25, 3,  4.75, '#ea580c', null,        null,         'bull', false, 101, 'To scale, for clearance. Not counted as kit'),
  ('0de30000-0000-4000-8000-00000000c115', 'animal-calf',        'Calf',                  'Animal',          4,    1.8, 3.2, '#fb923c', null,        null,         'calf', false, 102, 'To scale, for clearance. Not counted as kit'),
  ('0de30000-0000-4000-8000-00000000c116', 'tractor-processor',  'Tractor + bale processor', 'Equipment',    29,    9.3, 9.5, '#dc2626', null,        null,         null,   false, 110, 'Tractor and the bale processor behind it, for turning room. Not counted as kit');

-- ── The yards ─────────────────────────────────────────────────────────────
insert into public.handling_sites (id, ranch_id, name, center_lng, center_lat, zoom, notes, sort_order) values
  ('0de30000-0000-4000-8000-00000000c201', '0de30000-0000-4000-8000-000000000401', 'Home corrals', -113.53920, 52.45745, 18.5,
   'The pens behind the feed bin. Everything is panels, so the layout changes between branding and preg checking.', 1),
  ('0de30000-0000-4000-8000-00000000c202', '0de30000-0000-4000-8000-000000000402', 'Willow Ridge pens', -113.66420, 52.38560, 18,
   'Portable panels hauled out for branding, taken home after.', 2);

insert into public.handling_versions (id, site_id, name, is_base, notes, sort_order, updated_by) values
  ('0de30000-0000-4000-8000-00000000c301', '0de30000-0000-4000-8000-00000000c201', 'As it stands', true,
   'What is bolted and wired up now: holding pen, crowding alley to the chute, and the sorting gate on the east side.', 1,
   '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-00000000c302', '0de30000-0000-4000-8000-00000000c201', 'Wider crowding alley', false,
   'What we talked about after branding: pull the alley out two panels so a cow can turn, and move the trough out of the corner.', 2,
   '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-00000000c303', '0de30000-0000-4000-8000-00000000c202', 'Branding set-up', true,
   'Four pens of portable panels and a sorting gate; takes a morning to set up.', 1,
   '0de30000-0000-4000-8000-0000000000a2');

-- ── The pens as they stand ────────────────────────────────────────────────
-- A 72 x 48 ft holding pen of 12 ft panels with a gate on each end, the
-- crowding alley off its north-east corner, and the water and feed inside.
-- One 12 ft panel is 0.0000539 deg of longitude and 0.0000329 deg of latitude
-- at this latitude, which is how the spacing below was worked out.
insert into public.handling_items (version_id, catalog_id, lng, lat, rotation, swing_deg)
select '0de30000-0000-4000-8000-00000000c301', c.id, v.lng, v.lat, v.rot, v.swing
from (values
  -- south fence, west to east
  ('bar-panel-12', -113.539500, 52.457400,  0,  0),
  ('bar-panel-12', -113.539446, 52.457400,  0,  0),
  ('bar-panel-12', -113.539392, 52.457400,  0,  0),
  ('bar-panel-12', -113.539338, 52.457400,  0,  0),
  ('bar-panel-12', -113.539284, 52.457400,  0,  0),
  ('gate-swing-12', -113.539230, 52.457400, 0, 90),
  -- north fence, west to east
  ('bar-panel-12', -113.539500, 52.457532,  0,  0),
  ('bar-panel-12', -113.539446, 52.457532,  0,  0),
  ('wind-panel-12', -113.539392, 52.457532, 0,  0),
  ('wind-panel-12', -113.539338, 52.457532, 0,  0),
  ('bar-panel-12', -113.539284, 52.457532,  0,  0),
  ('gate-two-panel-24', -113.539203, 52.457532, 0, 0),
  -- west fence, south to north
  ('bar-panel-12', -113.539527, 52.457433, 90,  0),
  ('bar-panel-12', -113.539527, 52.457466, 90,  0),
  ('bar-panel-12', -113.539527, 52.457499, 90,  0),
  -- east fence and the way to the chute
  ('bar-panel-12', -113.539203, 52.457433, 90,  0),
  ('bar-panel-12', -113.539203, 52.457466, 90,  0),
  ('sort-gate-5way', -113.539150, 52.457499, 18, 0),
  ('bar-panel-10', -113.539096, 52.457466, 90,  0),
  ('bar-panel-10', -113.539096, 52.457499, 90,  0),
  ('bar-panel-10', -113.539051, 52.457466, 90,  0),
  ('bar-panel-10', -113.539051, 52.457499, 90,  0),
  -- what is inside the pen
  ('trough-10',    -113.539470, 52.457360,  0,  0),
  ('bale-feeder-round', -113.539350, 52.457460, 0, 0),
  ('feed-bunk-20', -113.539420, 52.457560,  0,  0),
  ('mineral-tub',  -113.539260, 52.457360,  0,  0),
  -- to scale, for clearance
  ('animal-cow',   -113.539300, 52.457440, 20,  0),
  ('animal-calf',  -113.539290, 52.457418, 20,  0),
  ('tractor-processor', -113.539600, 52.457560, 95, 0)
) as v(key, lng, lat, rot, swing)
join public.handling_catalog c on c.key = v.key and c.site_id is null;

-- The alternative layout: the same pen with the alley pulled out two panels.
insert into public.handling_items (version_id, catalog_id, lng, lat, rotation, swing_deg)
select '0de30000-0000-4000-8000-00000000c302', i.catalog_id,
       case when i.lng > -113.53915 then i.lng + 0.000090 else i.lng end, i.lat, i.rotation, i.swing_deg
from public.handling_items i
where i.version_id = '0de30000-0000-4000-8000-00000000c301';

-- Willow Ridge: four portable pens, panels only.
insert into public.handling_items (version_id, catalog_id, lng, lat, rotation, swing_deg)
select '0de30000-0000-4000-8000-00000000c303', c.id,
       -113.664400 + (g % 6) * 0.000539, 52.385500 + (g / 6) * 0.000329, case when g % 6 = 5 then 90 else 0 end, 0
from generate_series(0, 17) g
join public.handling_catalog c on c.key = 'bar-panel-16' and c.site_id is null;

-- ── Pens drawn on the plan (what each one is for) ─────────────────────────
insert into public.handling_paths (version_id, points, is_closed, label, color, stroke_width, usage_type, assigned_classes) values
  ('0de30000-0000-4000-8000-00000000c301',
   '[[-113.539527, 52.457400], [-113.539203, 52.457400], [-113.539203, 52.457532], [-113.539527, 52.457532]]'::jsonb,
   true, 'Holding pen', '#facc15', 2, 'holding', '{Cows,Calves}'),
  ('0de30000-0000-4000-8000-00000000c301',
   '[[-113.539203, 52.457466], [-113.539051, 52.457466], [-113.539051, 52.457499], [-113.539203, 52.457499]]'::jsonb,
   true, 'Crowding alley to the chute', '#fb7185', 2, 'crowding', '{Cows}'),
  ('0de30000-0000-4000-8000-00000000c301',
   '[[-113.539051, 52.457499], [-113.538960, 52.457520]]'::jsonb,
   false, 'Out to the chute and the scale', '#38bdf8', 2, 'working', '{}'),
  ('0de30000-0000-4000-8000-00000000c302',
   '[[-113.539203, 52.457466], [-113.538961, 52.457466], [-113.538961, 52.457499], [-113.539203, 52.457499]]'::jsonb,
   true, 'Crowding alley, two panels wider', '#fb7185', 2, 'crowding', '{Cows,Bred heifers}'),
  ('0de30000-0000-4000-8000-00000000c303',
   '[[-113.664400, 52.385500], [-113.661700, 52.385500], [-113.661700, 52.386487], [-113.664400, 52.386487]]'::jsonb,
   true, 'Branding pen', '#facc15', 2, 'holding', '{Cows,Calves}');

-- ── What is on hand (Inventory tab) ──────────────────────────────────────
insert into public.handling_inventory (site_id, catalog_id, quantity)
select v.site::uuid, c.id, v.qty
from (values
  ('0de30000-0000-4000-8000-00000000c201', 'bar-panel-12',      28),
  ('0de30000-0000-4000-8000-00000000c201', 'bar-panel-10',      12),
  ('0de30000-0000-4000-8000-00000000c201', 'bar-panel-16',       6),
  ('0de30000-0000-4000-8000-00000000c201', 'wind-panel-12',      8),
  ('0de30000-0000-4000-8000-00000000c201', 'gate-swing-12',      4),
  ('0de30000-0000-4000-8000-00000000c201', 'gate-two-panel-24',  1),
  ('0de30000-0000-4000-8000-00000000c201', 'sort-gate-5way',     1),
  ('0de30000-0000-4000-8000-00000000c201', 'trough-10',          3),
  ('0de30000-0000-4000-8000-00000000c201', 'bale-feeder-round',  6),
  ('0de30000-0000-4000-8000-00000000c201', 'feed-bunk-20',       4),
  ('0de30000-0000-4000-8000-00000000c201', 'mineral-tub',        5),
  ('0de30000-0000-4000-8000-00000000c202', 'bar-panel-16',      24),
  ('0de30000-0000-4000-8000-00000000c202', 'gate-swing-12',      2),
  ('0de30000-0000-4000-8000-00000000c202', 'trough-10',          1)
) as v(site, key, qty)
join public.handling_catalog c on c.key = v.key and c.site_id is null;

-- ── What is buried in the yard ───────────────────────────────────────────
insert into public.handling_layers (site_id, name, type, kml_content, color, visible) values
  ('0de30000-0000-4000-8000-00000000c201', 'Buried power to the feed bin', 'electrical',
   '<?xml version="1.0" encoding="UTF-8"?>' || chr(10) ||
   '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Buried power</name>' || chr(10) ||
   '<Placemark><name>Yard to feed bin</name><LineString><coordinates>' || chr(10) ||
   '-113.540550,52.456900,0 -113.539800,52.457200,0 -113.538700,52.457000,0' || chr(10) ||
   '</coordinates></LineString></Placemark></Document></kml>', '#f59e0b', true),
  ('0de30000-0000-4000-8000-00000000c201', 'Water line from the well', 'water',
   '<?xml version="1.0" encoding="UTF-8"?>' || chr(10) ||
   '<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Water line</name>' || chr(10) ||
   '<Placemark><name>Well to the trough</name><LineString><coordinates>' || chr(10) ||
   '-113.541200,52.456400,0 -113.540100,52.457100,0 -113.539470,52.457360,0' || chr(10) ||
   '</coordinates></LineString></Placemark></Document></kml>', '#0ea5e9', true);
