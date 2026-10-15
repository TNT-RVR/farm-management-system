-- Map → Layers → Farm layers, and the hauling map's field entries (made up).
-- Everything is placed from the field boundaries in the database (021), as
-- fractions of each field's bounding box, so it lands on the right quarters.

-- The yard is the north-east corner cut out of Home Quarter. The bins and the
-- pivot bins were placed for an older layout of the demo fields; put them back
-- in the yard and beside the North Pivot.
update public.bins b set geom = st_setsrid(st_makepoint(-113.53375 + v.c * 0.00034, 52.45570 - v.r * 0.00036), 4326)
from (values ('#1',0,0),('#2',1,0),('#3',2,0),('#4',3,0),('#5',0,1),('#6',1,1),('#7',2,1),('#8',3,1),('#9',4,1),('#10',5,1),
             ('#11',0,2),('#12',1,2),('#13',2,2),('#14',3,2),('#15',4,0),('F1',5,2)) as v(name, c, r)
where b.name = v.name;
update public.bins b set geom = st_setsrid(st_makepoint(-113.54425 + v.c * 0.00034, 52.47785), 4326)
from (values ('#16',0),('#17',1),('#18',2),('#19',3)) as v(name, c)
where b.name = v.name;

-- Shop and bins: where the hauling distances start.
insert into public.operating_settings (key, value, updated_by) values
  ('shop', jsonb_build_object('lat', 52.45470, 'lng', -113.53280, 'label', 'Shop', 'note', 'Home yard shop, Home Quarter'), (select id from public.users order by created_at limit 1)),
  ('bins', jsonb_build_object('lat', 52.45535, 'lng', -113.53300, 'label', 'Bins', 'note', 'Centre of the home yard bins'), (select id from public.users order by created_at limit 1))
on conflict (key) do nothing;

-- ── Field approaches: one per field, on the road allowance ─────────────────
-- side: which edge of the field the approach is on; frac: how far along it.
create temporary table demo_approach on commit drop as
select v.field_id::uuid as field_id, v.note,
       -- the entry pin: just inside the field
       case v.side when 'W' then st_xmin(b.geom) + 0.00012 when 'E' then st_xmax(b.geom) - 0.00012
                   else st_xmin(b.geom) + v.frac * (st_xmax(b.geom) - st_xmin(b.geom)) end as lng,
       case v.side when 'S' then st_ymin(b.geom) + 0.00008 when 'N' then st_ymax(b.geom) - 0.00008
                   else st_ymin(b.geom) + v.frac * (st_ymax(b.geom) - st_ymin(b.geom)) end as lat,
       -- where it meets the road: about 15 m out
       case v.side when 'W' then st_xmin(b.geom) - 0.00022 when 'E' then st_xmax(b.geom) + 0.00022
                   else st_xmin(b.geom) + v.frac * (st_xmax(b.geom) - st_xmin(b.geom)) end as road_lng,
       case v.side when 'S' then st_ymin(b.geom) - 0.00014 when 'N' then st_ymax(b.geom) + 0.00014
                   else st_ymin(b.geom) + v.frac * (st_ymax(b.geom) - st_ymin(b.geom)) end as road_lat
from (values
  ('0de30000-0000-4000-8000-000000000101', 'S', 0.50, 'South approach off the township road. Holds water in a wet spring.'),
  ('0de30000-0000-4000-8000-000000000102', 'N', 0.30, 'North approach, 24 ft wide.'),
  ('0de30000-0000-4000-8000-000000000103', 'E', 0.50, 'East approach across from Hay Flat.'),
  ('0de30000-0000-4000-8000-000000000104', 'N', 0.70, 'North approach; gate stays shut when cows are on the aftermath.'),
  ('0de30000-0000-4000-8000-000000000105', 'N', 0.50, 'North approach, culvert underneath.'),
  ('0de30000-0000-4000-8000-000000000106', 'E', 0.50, 'Gate on the east road only — the rail line blocks the west side.'),
  ('0de30000-0000-4000-8000-000000000107', 'N', 0.50, 'North approach at the middle fence line.'),
  ('0de30000-0000-4000-8000-000000000108', 'S', 0.40, 'South approach; steep coming up out of the ditch.'),
  ('0de30000-0000-4000-8000-000000000109', 'S', 0.60, 'South approach.'),
  ('0de30000-0000-4000-8000-000000000110', 'W', 0.50, 'West approach; watch the jog in the road to the north.'),
  ('0de30000-0000-4000-8000-000000000111', 'W', 0.30, 'West approach off the range road.'),
  ('0de30000-0000-4000-8000-000000000112', 'S', 0.50, 'South side, through the pivot corner.'),
  ('0de30000-0000-4000-8000-000000000113', 'S', 0.50, 'South side, through the pivot corner.'),
  ('0de30000-0000-4000-8000-000000000114', 'E', 0.50, 'East side by the pump-station trail.'),
  ('0de30000-0000-4000-8000-000000000115', 'N', 0.50, 'North approach — the creek crossing in the south-east corner is not passable.')
) as v(field_id, side, frac, note)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null;

insert into public.field_entries (field_id, lat, lng, note, set_by, updated_at)
select field_id, round(lat::numeric, 6), round(lng::numeric, 6), note, '0de30000-0000-4000-8000-0000000000a1', now() - interval '200 days'
from demo_approach;

-- Road distances from the shop and the bins to each entry, and from each entry
-- to the elevators: about the road-grid distance (the roads run on the survey
-- lines), as the morning route check would have stored them.
insert into public.road_routes (from_key, to_key, from_lat, from_lng, to_lat, to_lng, distance_km, duration_min, source, computed_at,
  road_km, trail_km, connector_km, method, approach_lat, approach_lng, entry_basis, note)
select r.from_key, r.to_key, r.from_lat, r.from_lng, r.to_lat, r.to_lng,
       round(r.km::numeric, 2), round((r.km / 72.0 * 60 + 2)::numeric, 1), 'osrm', now() - interval '1 day',
       round(r.km::numeric, 2), 0, 0, 'road', r.road_lat, r.road_lng, 'pin', null
from (
  select s.key as from_key, 'field:' || a.field_id as to_key,
         (s.value ->> 'lat')::float8 as from_lat, (s.value ->> 'lng')::float8 as from_lng, a.lat as to_lat, a.lng as to_lng,
         a.road_lat, a.road_lng,
         1.08 * (abs(a.lat - (s.value ->> 'lat')::float8) * 111.132 + abs(a.lng - (s.value ->> 'lng')::float8) * 67.8) + 0.3 as km
  from demo_approach a cross join public.operating_settings s
  where s.key in ('shop', 'bins')
  union all
  select 'field:' || a.field_id, 'site:' || d.id, a.lat, a.lng, d.lat::float8, d.lng::float8, d.lat::float8, d.lng::float8,
         1.1 * (abs(a.lat - d.lat::float8) * 111.132 + abs(a.lng - d.lng::float8) * 67.8) + 0.4
  from demo_approach a cross join public.delivery_sites d
  where d.active and d.lat is not null
) r;

-- ── Farm layers ────────────────────────────────────────────────────────────
insert into public.map_layers (id, name, layer_type, style, visible_default, sort_order, source) values
  ('0de30000-0000-4000-8000-000000000b01', 'Water', 'custom', '{"stroke": "#0ea5e9"}', true, 1, null),
  ('0de30000-0000-4000-8000-000000000b02', 'Gates & approaches', 'custom', '{"stroke": "#f59e0b"}', true, 2, null),
  ('0de30000-0000-4000-8000-000000000b03', 'Rock piles', 'custom', '{"stroke": "#78716c"}', true, 3, null),
  ('0de30000-0000-4000-8000-000000000b04', 'Power lines', 'utility', '{"stroke": "#dc2626"}', true, 4, null);

-- Field-relative places: (field, fx, fy) → a point in that field's box.
create temporary table demo_place on commit drop as
select v.layer::uuid as layer_id, v.field_id::uuid as field_id, v.label, v.kind, v.w_m, v.h_m, v.colour, v.descr,
       st_xmin(b.geom) + v.fx * (st_xmax(b.geom) - st_xmin(b.geom)) as lng,
       st_ymin(b.geom) + v.fy * (st_ymax(b.geom) - st_ymin(b.geom)) as lat
from (values
  -- Water: dugouts (drawn as their outline) and culverts
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000101', 'Yard dugout', 'pond', 50, 28, '#0ea5e9', 0.62, 0.90, 'Fenced. Yard water and the sprayer fill.'),
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000108', 'Hilltop dugout', 'pond', 40, 25, '#0ea5e9', 0.08, 0.10, 'Dug in the low corner. Full by mid-May most years.'),
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000111', 'Miller dugout', 'pond', 45, 25, '#0ea5e9', 0.92, 0.96, 'Landlord''s dugout — keep the sprayer back 30 m.'),
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000101', 'Culvert — south approach', 'point', 0, 0, '#0284c7', 0.50, -0.012, '600 mm culvert under the approach. Plugs with straw in spring — check it in April.'),
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000105', 'Culvert — north approach', 'point', 0, 0, '#0284c7', 0.50, 1.012, '450 mm culvert.'),
  ('0de30000-0000-4000-8000-000000000b01', '0de30000-0000-4000-8000-000000000115', 'Creek crossing culvert', 'point', 0, 0, '#0284c7', 0.88, 0.04, 'Big culvert on the creek. Not rated for a loaded grain truck.'),
  -- Gates and approaches
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000104', 'Hay Flat gate', 'point', 0, 0, '#f59e0b', 0.70, 0.995, '20 ft gate. Shut when cows are on the aftermath.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000106', 'Railway Quarter gate', 'point', 0, 0, '#f59e0b', 0.995, 0.50, 'The only way in — the rail line blocks the west side.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000107', 'West Half middle gate', 'point', 0, 0, '#f59e0b', 0.50, 0.995, 'Gate at the old middle fence line; wide enough for the 60 ft drill folded.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000108', 'Hilltop approach', 'point', 0, 0, '#f59e0b', 0.40, 0.005, 'Steep coming up out of the ditch. Loaded trucks go in from the south only.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000110', 'Correction Line approach', 'point', 0, 0, '#f59e0b', 0.005, 0.50, 'Watch the jog in the road to the north.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000115', 'Creek Flat approach', 'point', 0, 0, '#f59e0b', 0.50, 0.995, 'Use this one — the south-east corner floods.'),
  ('0de30000-0000-4000-8000-000000000b02', '0de30000-0000-4000-8000-000000000111', 'Miller Half approach', 'point', 0, 0, '#f59e0b', 0.005, 0.30, 'Shared with the landlord''s yard road.'),
  -- Rock piles
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000107', 'Middle fence rock pile', 'pile', 40, 12, '#78716c', 0.50, 0.50, 'Long pile along the old middle fence. Add to it, don''t farm around a new one.'),
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000107', 'Rock pile', 'point', 0, 0, '#78716c', 0.50, 0.18, null),
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000108', 'Knoll rock pile', 'point', 0, 0, '#78716c', 0.34, 0.80, 'On the eroded knoll — rocks come up every spring.'),
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000109', 'Sandhill rock pile', 'point', 0, 0, '#78716c', 0.22, 0.62, null),
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000111', 'Rock pile by the bluff', 'pile', 25, 15, '#78716c', 0.58, 0.40, 'Next to the willow bluff.'),
  ('0de30000-0000-4000-8000-000000000b03', '0de30000-0000-4000-8000-000000000103', 'Rock pile', 'point', 0, 0, '#78716c', 0.16, 0.32, 'Big one — mark it before the sprayer goes in.')
) as v(layer, field_id, label, kind, w_m, h_m, colour, fx, fy, descr)
join public.field_boundaries b on b.field_id = v.field_id::uuid and b.valid_to is null;

insert into public.map_features (layer_id, field_id, geom, properties, label, updated_at)
select p.layer_id,
       case when p.label like 'Culvert%' then null else p.field_id end,
       case when p.kind = 'point' then st_setsrid(st_makepoint(p.lng, p.lat), 4326)
            -- a dugout: a rounded oblong of the stated size
            when p.kind = 'pond' then st_setsrid(st_translate(st_scale(st_buffer(st_makepoint(0, 0), 1, 'quad_segs=6'), p.w_m / 2 / 67800.0, p.h_m / 2 / 111132.0), p.lng, p.lat), 4326)
            else st_makeenvelope(p.lng - p.w_m / 2 / 67800.0, p.lat - p.h_m / 2 / 111132.0, p.lng + p.w_m / 2 / 67800.0, p.lat + p.h_m / 2 / 111132.0, 4326) end,
       jsonb_strip_nulls(jsonb_build_object('stroke', p.colour, 'fill', case when p.kind <> 'point' then p.colour end, 'description', p.descr, 'kind', p.kind)),
       p.label, now() - interval '300 days'
from demo_place p;

-- Lines: the Slough Quarter drain, and the power lines.
insert into public.map_features (layer_id, field_id, geom, properties, label, updated_at)
select '0de30000-0000-4000-8000-000000000b01'::uuid, '0de30000-0000-4000-8000-000000000105'::uuid,
       st_setsrid(st_makeline(array[
         st_makepoint(-113.51290, 52.45270), st_makepoint(-113.51050, 52.45290),
         st_makepoint(-113.50860, 52.45320), st_makepoint(st_xmax(b.geom) + 0.0001, 52.45330)]), 4326),
       '{"stroke": "#0ea5e9", "stroke-width": 2, "description": "Shallow surface drain from the slough to the east ditch. Licensed; clean it out with the scraper every few years."}'::jsonb,
       'Slough drain', now() - interval '300 days'
from public.field_boundaries b where b.field_id = '0de30000-0000-4000-8000-000000000105' and b.valid_to is null
union all
select '0de30000-0000-4000-8000-000000000b04'::uuid, null::uuid,
       st_setsrid(st_makeline(st_makepoint(st_xmin(b.geom) - 0.00010, st_ymin(b.geom) - 0.0003), st_makepoint(st_xmin(b.geom) - 0.00010, st_ymax(b.geom) + 0.0072)), 4326),
       '{"stroke": "#dc2626", "stroke-width": 2, "description": "25 kV line on the west side of Schoolhouse and Home Quarter. Fold the sprayer booms before the corner."}',
       'Power line (25 kV)', now() - interval '300 days'
from public.field_boundaries b where b.field_id = '0de30000-0000-4000-8000-000000000103' and b.valid_to is null
union all
select '0de30000-0000-4000-8000-000000000b04'::uuid, '0de30000-0000-4000-8000-000000000101'::uuid,
       st_setsrid(st_makeline(st_makepoint(st_xmin(b.geom) - 0.00010, 52.45480), st_makepoint(-113.53300, 52.45480)), 4326),
       '{"stroke": "#dc2626", "stroke-width": 2, "description": "Overhead drop to the yard, across the north end of Home Quarter."}',
       'Yard power drop', now() - interval '300 days'
from public.field_boundaries b where b.field_id = '0de30000-0000-4000-8000-000000000101' and b.valid_to is null;
