-- Fields and their boundaries. Quarter sections are 0.5 mile squares
-- (0.011861 deg of longitude x 0.007236 deg of latitude at 52.45 N);
-- grid cell (c, r) has its south-west corner at
--   lng = -113.55 + c * 0.011861, lat = 52.45 + r * 0.007236.
-- Field ids: 0de30000-0000-4000-8000-0000000001NN.

insert into public.fields (id, farm_id, name, legal_land_description, active, soil_texture, soil_fc, soil_wp, soil_source, notes_md, created_at)
select v.id::uuid, (select id from public.farms limit 1), v.name, v.legal, true, v.tex,
       case v.tex when 'loam' then 0.29 when 'clay loam' then 0.34 when 'sandy loam' then 0.21 when 'silt loam' then 0.32 end,
       case v.tex when 'loam' then 0.13 when 'clay loam' then 0.20 when 'sandy loam' then 0.09 when 'silt loam' then 0.14 end,
       'manual', v.notes, now() - interval '3 years'
from (values
  ('0de30000-0000-4000-8000-000000000101', 'Home Quarter',     'SE-14-42-25-W4', 'loam',       'Yard site in the NE corner. Low spot by the south approach holds water in a wet spring — seed it last.'),
  ('0de30000-0000-4000-8000-000000000102', 'East Home',        'SW-13-42-25-W4', 'clay loam',  'Heavy ground. Best wheat yields on the farm; slow to dry out.'),
  ('0de30000-0000-4000-8000-000000000103', 'Schoolhouse',      'NE-11-42-25-W4', 'loam',       'Old schoolhouse site (2 ac) fenced out in the NW corner. Power line along the west side.'),
  ('0de30000-0000-4000-8000-000000000104', 'Hay Flat',         'NW-12-42-25-W4', 'clay loam',  'Alfalfa-grass stand seeded three years ago. Cows graze the aftermath in October.'),
  ('0de30000-0000-4000-8000-000000000105', 'Slough Quarter',   'SE-13-42-25-W4', 'loam',       'Permanent slough in the middle (about 11 ac, not farmed). Keep the sprayer 30 m back from the water.'),
  ('0de30000-0000-4000-8000-000000000106', 'Railway Quarter',  'NE-12-42-25-W4', 'loam',       'Rail line cuts the NW corner. Gate on the east road only.'),
  ('0de30000-0000-4000-8000-000000000107', 'West Half',        'S-17-42-25-W4',  'loam',       'Half section, farmed as one field. Rock pile along the middle fence line.'),
  ('0de30000-0000-4000-8000-000000000108', 'Hilltop',          'SE-20-42-25-W4', 'clay loam',  'Eroded knolls on the north side run low in organic matter — variable-rate P helps here.'),
  ('0de30000-0000-4000-8000-000000000109', 'Sandhill',         'SW-20-42-25-W4', 'sandy loam', 'Lightest soil on the farm. Dries out first in a dry July; good early-seeding ground.'),
  ('0de30000-0000-4000-8000-000000000110', 'Correction Line',  'NE-15-42-25-W4', 'loam',       'Jog in the road on the north side — watch the corner with the drill.'),
  ('0de30000-0000-4000-8000-000000000111', 'Miller Half',      'E-1-42-25-W4',   'loam',       'Rented from the Miller family (cash rent, five-year lease).'),
  ('0de30000-0000-4000-8000-000000000112', 'North Pivot',      'NW-6-43-24-W4',  'silt loam',  '7-tower pivot, about 130 ac under the circle. Corners are seeded to grass.'),
  ('0de30000-0000-4000-8000-000000000113', 'Creek Pivot West', 'SW-6-43-24-W4',  'silt loam',  'Fed from the creek pump station. 7 towers.'),
  ('0de30000-0000-4000-8000-000000000114', 'Creek Pivot East', 'SE-6-43-24-W4',  'loam',       'Newest pivot (VRI-ready). Fed from the creek pump station.'),
  ('0de30000-0000-4000-8000-000000000115', 'Creek Flat',       'NE-6-43-24-W4',  'silt loam',  'Prairie Creek crosses the SE corner; the flat along it floods some springs.')
) as v(id, name, legal, tex, notes);

-- Boundaries.
with g as (
  select id::uuid as field_id, geom from (values
    -- Home Quarter: the quarter less the ~8 ac yard in its NE corner
    ('0de30000-0000-4000-8000-000000000101', st_difference(
        st_makeenvelope(-113.5499, 52.4501, -113.5382, 52.4571, 4326),
        st_makeenvelope(-113.5412, 52.4553, -113.5380, 52.4573, 4326))),
    ('0de30000-0000-4000-8000-000000000102', st_makeenvelope(-113.5380, 52.4501, -113.5264, 52.4571, 4326)),
    -- Schoolhouse: less a 2 ac corner
    ('0de30000-0000-4000-8000-000000000103', st_difference(
        st_makeenvelope(-113.5499, 52.4429, -113.5382, 52.4499, 4326),
        st_makeenvelope(-113.5500, 52.4488, -113.5476, 52.4500, 4326))),
    ('0de30000-0000-4000-8000-000000000104', st_makeenvelope(-113.5380, 52.4429, -113.5264, 52.4499, 4326)),
    -- Slough Quarter: a hole for the slough
    ('0de30000-0000-4000-8000-000000000105', st_difference(
        st_makeenvelope(-113.5262, 52.4501, -113.5145, 52.4571, 4326),
        st_buffer(st_setsrid(st_makepoint(-113.5200, 52.4540), 4326)::geography, 118)::geometry)),
    -- Railway Quarter: rail line takes the NW corner
    ('0de30000-0000-4000-8000-000000000106', st_difference(
        st_makeenvelope(-113.5262, 52.4429, -113.5145, 52.4499, 4326),
        st_geomfromtext('POLYGON((-113.5263 52.4470, -113.5263 52.4500, -113.5215 52.4500, -113.5263 52.4470))', 4326))),
    -- West Half: two quarters side by side
    ('0de30000-0000-4000-8000-000000000107', st_makeenvelope(-113.6211, 52.4429, -113.5976, 52.4499, 4326)),
    ('0de30000-0000-4000-8000-000000000108', st_makeenvelope(-113.6092, 52.4501, -113.5976, 52.4571, 4326)),
    ('0de30000-0000-4000-8000-000000000109', st_makeenvelope(-113.6211, 52.4501, -113.6094, 52.4571, 4326)),
    ('0de30000-0000-4000-8000-000000000110', st_makeenvelope(-113.5736, 52.4429, -113.5620, 52.4499, 4326)),
    -- Miller Half: two quarters north-south
    ('0de30000-0000-4000-8000-000000000111', st_makeenvelope(-113.5262, 52.4284, -113.5145, 52.4427, 4326)),
    -- Pivots: 410 m circles centred on their quarters
    ('0de30000-0000-4000-8000-000000000112', st_buffer(st_setsrid(st_makepoint(-113.5085, 52.5115), 4326)::geography, 410, 'quad_segs=24')::geometry),
    ('0de30000-0000-4000-8000-000000000113', st_buffer(st_setsrid(st_makepoint(-113.5085, 52.5043), 4326)::geography, 410, 'quad_segs=24')::geometry),
    ('0de30000-0000-4000-8000-000000000114', st_buffer(st_setsrid(st_makepoint(-113.4966, 52.5043), 4326)::geography, 410, 'quad_segs=24')::geometry),
    -- Creek Flat: the creek cuts across the SE corner
    ('0de30000-0000-4000-8000-000000000115', st_difference(
        st_makeenvelope(-113.5025, 52.5080, -113.4908, 52.5150, 4326),
        st_buffer(st_geomfromtext('LINESTRING(-113.4985 52.5070, -113.4960 52.5092, -113.4935 52.5098, -113.4900 52.5125)', 4326)::geography, 45)::geometry))
  ) as t(id, geom)
)
insert into public.field_boundaries (field_id, geom, valid_from, source, created_at)
select field_id,
       st_multi(st_setsrid(geom, 4326)),
       current_date - 1000,
       (case when field_id in ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000114')
             then 'drawn' else 'kml' end)::public.boundary_source,
       now() - interval '1000 days'
from g;

update public.fields f
   set centroid = st_pointonsurface(b.geom)::geography
  from public.field_boundaries b
 where b.field_id = f.id and b.valid_to is null;

-- Irrigation: one pump station on Prairie Creek, one licence, three pivots.
insert into public.water_licences (id, farm_id, licence_number, volume, rate_of_diversion, priority_number, notes, source, holder, status, priority_date, points_of_diversion, lands, volume_m3)
values ('0de30000-0000-4000-8000-000000000201', (select id from public.farms limit 1), '00412345-00-00', 480, 0.12, '1998-04-17-01',
        'Licence for the three creek pivots. Diversion stops when the creek gauge falls below the minimum flow in the licence conditions.',
        'other', 'Prairie Creek Farm Ltd.', 'issued', current_date - 10400, 'SE-6-43-24-W4', 'SW, SE and NW of 6-43-24-W4', 592000);

insert into public.pumps (id, farm_id, name, legal_land, lat, lon, horse_power, voltage, brand, model, gpm, kind, phase, hz, notes, purpose)
values ('0de30000-0000-4000-8000-000000000211', (select id from public.farms limit 1), 'Creek pump station', 'SE-6-43-24-W4',
        52.5012, -113.4930, 125, 600, 'Cornell', '6RB', 2100, 'pump', 3, 60,
        'Vertical turbine on the creek intake. Screens cleaned every spring before start-up.', 'irrigation');

insert into public.field_pivots (field_id, pump_id, water_licence_id, acres_irrigated, length_m, towers, brand, model, gpm, pivot_year, system_type, end_gun, sprinkler_package, application_efficiency, time_to_full_circle_h, water_source, operated_by)
values
  ('0de30000-0000-4000-8000-000000000112', '0de30000-0000-4000-8000-000000000211', '0de30000-0000-4000-8000-000000000201', 130, 400, 7, 'Valley', '8000', 700, extract(year from current_date)::int - 14, 'pivot', false, 'Nelson R3000 on drops', 0.85, 42, 'other', 'Alex Rivers'),
  ('0de30000-0000-4000-8000-000000000113', '0de30000-0000-4000-8000-000000000211', '0de30000-0000-4000-8000-000000000201', 130, 400, 7, 'Valley', '8000', 700, extract(year from current_date)::int - 11, 'pivot', false, 'Nelson R3000 on drops', 0.85, 40, 'other', 'Alex Rivers'),
  ('0de30000-0000-4000-8000-000000000114', '0de30000-0000-4000-8000-000000000211', '0de30000-0000-4000-8000-000000000201', 131, 402, 7, 'Zimmatic', '9500P', 720, extract(year from current_date)::int - 3, 'pivot', false, 'Senninger UP3 on drops', 0.88, 38, 'other', 'Jordan Pike');
