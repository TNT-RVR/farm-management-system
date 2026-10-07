-- Grain: bins, this fall's harvest loads (field -> bin, or straight to the
-- buyer), deliveries out, contracts, prices, moisture tests.
-- Ids: bins 05NN, delivery sites 055N, contracts 056N.

-- Bins. The home yard is 'Main Yard' (the app measures field distances from it).
insert into public.bins (id, name, capacity_bu, geom, site, notes_md, active, usual_contents)
select v.id::uuid, v.name, v.cap, st_setsrid(st_makepoint(v.lng, v.lat), 4326), v.site, v.notes, true, v.usual
from (values
  ('0de30000-0000-4000-8000-000000000501', '#1',  5500, -113.54055, 52.45690, 'Main Yard', 'Hopper bottom, aeration fan.', 'grain'),
  ('0de30000-0000-4000-8000-000000000502', '#2',  5500, -113.54020, 52.45690, 'Main Yard', 'Hopper bottom, aeration fan.', 'grain'),
  ('0de30000-0000-4000-8000-000000000503', '#3',  5500, -113.53985, 52.45690, 'Main Yard', 'Hopper bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000504', '#4',  5500, -113.53950, 52.45690, 'Main Yard', 'Hopper bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000505', '#5',  10500, -113.54055, 52.45655, 'Main Yard', 'Flat bottom, full floor aeration.', 'grain'),
  ('0de30000-0000-4000-8000-000000000506', '#6',  10500, -113.54015, 52.45655, 'Main Yard', 'Flat bottom, full floor aeration. Temperature cables.', 'grain'),
  ('0de30000-0000-4000-8000-000000000507', '#7',  10500, -113.53975, 52.45655, 'Main Yard', 'Flat bottom, full floor aeration.', 'grain'),
  ('0de30000-0000-4000-8000-000000000508', '#8',  10500, -113.53935, 52.45655, 'Main Yard', 'Flat bottom, full floor aeration.', 'grain'),
  ('0de30000-0000-4000-8000-000000000509', '#9',  10500, -113.53895, 52.45655, 'Main Yard', 'Flat bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000510', '#10', 10500, -113.53855, 52.45655, 'Main Yard', 'Flat bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000511', '#11', 22000, -113.54040, 52.45610, 'Main Yard', 'Big flat bottom with a sweep auger.', 'grain'),
  ('0de30000-0000-4000-8000-000000000512', '#12', 22000, -113.53985, 52.45610, 'Main Yard', 'Big flat bottom with a sweep auger.', 'grain'),
  ('0de30000-0000-4000-8000-000000000513', '#13', 22000, -113.53930, 52.45610, 'Main Yard', 'Big flat bottom with a sweep auger.', 'grain'),
  ('0de30000-0000-4000-8000-000000000514', '#14', 22000, -113.53875, 52.45610, 'Main Yard', 'Big flat bottom with a sweep auger. Temperature cables.', 'grain'),
  ('0de30000-0000-4000-8000-000000000515', '#15', 4000,  -113.53870, 52.45700, 'Main Yard', 'Feed bin by the cattle pens.', 'grain'),
  ('0de30000-0000-4000-8000-000000000516', '#16', 16000, -113.50310, 52.50790, 'North Yard', 'Flat bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000517', '#17', 16000, -113.50270, 52.50790, 'North Yard', 'Flat bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000518', '#18', 16000, -113.50230, 52.50790, 'North Yard', 'Flat bottom. Malt barley only — keep it clean.', 'grain'),
  ('0de30000-0000-4000-8000-000000000519', '#19', 16000, -113.50190, 52.50790, 'North Yard', 'Flat bottom.', 'grain'),
  ('0de30000-0000-4000-8000-000000000520', 'F1',  4500,  -113.53830, 52.45700, 'Main Yard', 'Fertilizer hopper (urea for spring).', 'fertilizer')
) as v(id, name, cap, lng, lat, site, notes, usual);

insert into public.delivery_sites (id, name, kind, active, lat, lng, location_note, created_by) values
  ('0de30000-0000-4000-8000-000000000551', 'Creekside Grain Terminal', 'elevator', true, 52.4720, -113.4210, 'East of town on the highway. Scale opens at 7.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000552', 'Parkland Pulse plant', 'plant', true, 52.5230, -113.6260, 'Pulse cleaning and splitting plant.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000553', 'Aspen Valley Malt', 'plant', true, 52.3720, -113.4480, 'Malt intake; samples tested on arrival.', '0de30000-0000-4000-8000-0000000000a1');

-- Contracts for this crop year (and one for next).
insert into public.contracts (id, crop_year, crop_id, buyer_contact_id, contract_number, bushels, price_per_unit, delivery_start, delivery_end, status, notes_md) values
  ('0de30000-0000-4000-8000-000000000561', extract(year from current_date)::int, (select id from public.crops where name = 'Canola'),
   '0de30000-0000-4000-8000-000000000302', 'CGT-24518', 12000, 14.20, current_date - 10, current_date + 55, 'partial', '1 CAN, basis fixed. Book trucks a week ahead.'),
  ('0de30000-0000-4000-8000-000000000562', extract(year from current_date)::int, (select id from public.crops where name = 'Peas'),
   '0de30000-0000-4000-8000-000000000303', 'PPP-0917', 8000, 9.40, current_date - 45, current_date + 25, 'partial', 'No. 2 yellow or better. Off the combine.'),
  ('0de30000-0000-4000-8000-000000000563', extract(year from current_date)::int, (select id from public.crops where name = 'Barley'),
   '0de30000-0000-4000-8000-000000000304', 'AVM-3391', 10000, 6.90, current_date - 20, current_date + 115, 'partial', 'Malt, AAC Synergy. Protein 10.5–13%, germination 95%+.'),
  ('0de30000-0000-4000-8000-000000000564', extract(year from current_date)::int, (select id from public.crops where name = 'Wheat'),
   '0de30000-0000-4000-8000-000000000302', 'CGT-24602', 15000, 8.05, current_date + 90, current_date + 175, 'open', 'Deferred delivery, 1 CWRS 13.5% protein.'),
  ('0de30000-0000-4000-8000-000000000565', extract(year from current_date)::int + 1, (select id from public.crops where name = 'Canola'),
   '0de30000-0000-4000-8000-000000000302', 'CGT-25011', 5000, 14.55, current_date + 300, current_date + 390, 'open', 'New crop, Act of God clause.');

-- This fall's harvest, field by field: how much came off, when, what truck,
-- and which bins (filled in order).
create temporary table demo_harvest on commit drop as
select h.field_id::uuid as field_id, c.id as crop_id, c.name as crop_name, c.test_weight_lb_per_bu as lb_per_bu,
       p.variety,
       round(p.yield_per_acre_override * b.acres * h.yf) as total_bu,
       h.done, h.start_ago, h.end_ago, h.truck, h.moist, h.bins, h.direct_loads, h.site::uuid as site_id, h.contract::uuid as contract_id
from (values
  ('0de30000-0000-4000-8000-000000000107', 1.04, 1.0, 58, 52, 'semi',   15.2, array['0de30000-0000-4000-8000-000000000511'], 6, '0de30000-0000-4000-8000-000000000552', '0de30000-0000-4000-8000-000000000562'),
  ('0de30000-0000-4000-8000-000000000106', 1.02, 1.0, 46, 43, 'tandem', 13.8, array['0de30000-0000-4000-8000-000000000515','0de30000-0000-4000-8000-000000000509','0de30000-0000-4000-8000-000000000510'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000114', 1.03, 1.0, 44, 41, 'semi',   13.6, array['0de30000-0000-4000-8000-000000000518'], 4, '0de30000-0000-4000-8000-000000000553', '0de30000-0000-4000-8000-000000000563'),
  ('0de30000-0000-4000-8000-000000000112', 1.02, 1.0, 39, 36, 'semi',   14.0, array['0de30000-0000-4000-8000-000000000516'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000101', 1.05, 1.0, 35, 32, 'tandem', 13.9, array['0de30000-0000-4000-8000-000000000505'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000108', 1.04, 1.0, 31, 28, 'tandem', 14.2, array['0de30000-0000-4000-8000-000000000512'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000111', 1.05, 1.0, 27, 21, 'semi',   13.7, array['0de30000-0000-4000-8000-000000000513'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000109', 1.06, 1.0, 22, 19, 'tandem', 13.1, array['0de30000-0000-4000-8000-000000000514'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000113', 1.02, 1.0, 18, 16, 'semi',    8.9, array['0de30000-0000-4000-8000-000000000517'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000102', 1.05, 1.0, 16, 13, 'semi',    8.6, array['0de30000-0000-4000-8000-000000000506'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000103', 1.03, 1.0, 12, 10, 'semi',    9.1, array['0de30000-0000-4000-8000-000000000507'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000105', 1.01, 1.0,  9,  7, 'tandem',  9.4, array['0de30000-0000-4000-8000-000000000508'], 0, null, null),
  ('0de30000-0000-4000-8000-000000000110', 1.04, 0.55, 4,  1, 'tandem',  9.8, array['0de30000-0000-4000-8000-000000000501','0de30000-0000-4000-8000-000000000502'], 0, null, null)
) as h(field_id, yf, done, start_ago, end_ago, truck, moist, bins, direct_loads, site, contract)
join public.crop_plans p on p.field_id = h.field_id::uuid and p.crop_year = extract(year from current_date)::int
join public.crops c on c.id = p.crop_id
join public.field_boundaries b on b.field_id = p.field_id and b.valid_to is null;

create temporary table demo_loads on commit drop as
with base as (
  select h.*,
         case h.truck when 'semi' then 24300 else 15200 end as load_kg,
         case h.truck when 'semi' then 15400 else 11300 end as tare,
         h.total_bu * h.done * h.lb_per_bu / 2.20462262 as harvested_kg
  from demo_harvest h
), n as (
  select b.*, ceil(b.harvested_kg / b.load_kg)::int as nloads from base b
), l as (
  select n.*, i,
         case when i < n.nloads then n.load_kg else n.harvested_kg - n.load_kg * (n.nloads - 1) end as net_kg
  from n cross join lateral generate_series(1, n.nloads) i
)
select l.*,
       (current_date - l.start_ago + round((l.start_ago - l.end_ago) * (i - 1)::numeric / greatest(l.nloads - 1, 1))::int) as loaded_on,
       sum(net_kg) over (partition by field_id order by i) - net_kg as kg_before
from l;

insert into public.bin_loads (bin_id, crop_id, variety, crop_year, field_id, loaded_on, gross_kg, tare_kg, lb_per_bu, truck, trailer, driver, driver_id,
                              note, created_by, last_from_field, delivery_site_id, contract_id, entry_kind, moisture_pct, protein_pct)
select case when d.i <= d.direct_loads then null else
         (select bn from unnest(d.bins) with ordinality as u(bn, k)
           join public.bins bb on bb.id = u.bn::uuid
          where (select sum(b2.capacity_bu) from unnest(d.bins) with ordinality as u2(bn2, k2) join public.bins b2 on b2.id = u2.bn2::uuid where k2 <= u.k)
                >= ((d.kg_before - least(d.i - 1, d.direct_loads) * d.load_kg + d.net_kg) * 2.20462262 / d.lb_per_bu)
          order by k limit 1)::uuid
       end,
       d.crop_id, d.variety, extract(year from current_date)::int, d.field_id, d.loaded_on,
       round(d.tare + d.net_kg), d.tare, d.lb_per_bu,
       case when d.truck = 'semi' then 'Kenworth T800' else (array['Truck 2 (IH tandem)', 'Truck 3 (Freightliner tandem)'])[1 + d.i % 2] end,
       case when d.truck = 'semi' then 'Doepker tridem' end,
       case when d.truck = 'semi' then 'Jordan Pike' else (array['Casey Moore', 'Alex Rivers'])[1 + d.i % 2] end,
       case when d.truck = 'semi' then '0de30000-0000-4000-8000-0000000000a2'::uuid else (array['0de30000-0000-4000-8000-0000000000a3', '0de30000-0000-4000-8000-0000000000a1'])[1 + d.i % 2]::uuid end,
       case when d.i <= d.direct_loads then 'Straight to the buyer off the combine.' end,
       '0de30000-0000-4000-8000-0000000000a2',
       (d.i = d.nloads and d.done = 1.0),
       case when d.i <= d.direct_loads then d.site_id end,
       case when d.i <= d.direct_loads then d.contract_id end,
       'weighed',
       round((d.moist + ((abs(hashtext(d.field_id::text || d.i)) % 9) - 4) * 0.15)::numeric, 1),
       case when d.crop_name = 'Wheat' then round((13.4 + ((abs(hashtext(d.field_id::text || d.i)) % 9) - 4) * 0.1)::numeric, 1)
            when d.crop_name = 'Barley' and d.field_id = '0de30000-0000-4000-8000-000000000114' then round((11.6 + ((abs(hashtext(d.field_id::text || d.i)) % 9) - 4) * 0.1)::numeric, 1) end
from demo_loads d
order by d.loaded_on, d.field_id, d.i;

-- Malt barley that went straight to the maltster has the plant's tickets.
insert into public.scale_tickets (crop_year, crop_id, contract_id, buyer, ticket_no, delivered_on, gross_lb, tare_lb, net_lb, moisture_pct, dockage_pct,
                                  net_units, unit, grade, protein_pct, created_by, driver, truck, notes)
select l.crop_year, l.crop_id, l.contract_id, 'Aspen Valley Malt', 'AVM-' || (71230 + row_number() over (order by l.loaded_on, l.created_at)),
       l.loaded_on, round(l.gross_kg * 2.20462262), round(l.tare_kg * 2.20462262), round(l.net_kg * 2.20462262), l.moisture_pct, 0.8,
       round(l.bushels * 0.992, 2), 'bu', 'Select CW two-row', l.protein_pct, '0de30000-0000-4000-8000-0000000000a1', l.driver, l.truck, 'Accepted for malt.'
from public.bin_loads l
where l.contract_id = '0de30000-0000-4000-8000-000000000563';

-- Canola out of bin #6 to the terminal on the canola contract.
insert into public.grain_movements (crop_year, bin_id, crop_id, field_id, contract_id, movement_type, bushels, moved_at, ticket_number, notes, created_by)
select extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000506', (select id from public.crops where name = 'Canola'),
       '0de30000-0000-4000-8000-000000000102', '0de30000-0000-4000-8000-000000000561', 'delivery_out', t.bu, current_date - t.ago, 'CGT-' || t.tk,
       'Delivered to Creekside Grain Terminal.', '0de30000-0000-4000-8000-0000000000a1'
from (values (1061.4, 9, '88412'), (1052.8, 8, '88437'), (1066.0, 6, '88502'), (1049.5, 3, '88590')) as t(bu, ago, tk);

insert into public.scale_tickets (crop_year, crop_id, contract_id, bin_id, buyer, ticket_no, delivered_on, gross_lb, tare_lb, net_lb, moisture_pct, dockage_pct,
                                  net_units, unit, grade, created_by, driver, truck, receipt_no)
select extract(year from current_date)::int, (select id from public.crops where name = 'Canola'), '0de30000-0000-4000-8000-000000000561',
       '0de30000-0000-4000-8000-000000000506', 'Creekside Grain Terminal', t.tk, current_date - t.ago,
       round(t.bu * 50 / 0.988) + 33950, 33950, round(t.bu * 50 / 0.988), t.m, 1.2, t.bu, 'bu', '1 CAN', '0de30000-0000-4000-8000-0000000000a1',
       'Jordan Pike', 'Kenworth T800', 'R-' || t.tk
from (values (1061.4, 9, '88412', 8.4), (1052.8, 8, '88437', 8.7), (1066.0, 6, '88502', 8.3), (1049.5, 3, '88590', 8.9)) as t(bu, ago, tk, m);

-- Last year's carry-over still in the yard.
insert into public.grain_movements (crop_year, bin_id, crop_id, movement_type, bushels, moved_at, notes, created_by) values
  (extract(year from current_date)::int - 1, '0de30000-0000-4000-8000-000000000503', (select id from public.crops where name = 'Canola'), 'adjustment', 3150, current_date - 330, 'Carry-over count after last harvest.', '0de30000-0000-4000-8000-0000000000a1'),
  (extract(year from current_date)::int - 1, '0de30000-0000-4000-8000-000000000504', (select id from public.crops where name = 'Wheat'),  'adjustment', 2700, current_date - 330, 'Carry-over count after last harvest.', '0de30000-0000-4000-8000-0000000000a1');

-- What is in each bin now (one open row per bin).
insert into public.bin_contents (bin_id, crop_id, variety, crop_year, bushels, note, filled_on, updated_by)
select o.bin_id, o.crop_id,
       (select l.variety from public.bin_loads l where l.bin_id = o.bin_id and l.crop_id = o.crop_id order by l.loaded_on limit 1),
       o.crop_year, round(o.bu), o.note, o.filled_on, '0de30000-0000-4000-8000-0000000000a1'
from (
  select m.bin_id, m.crop_id, m.crop_year,
         sum(case when m.movement_type in ('harvest_in', 'transfer_in', 'adjustment') then m.bushels else -m.bushels end) as bu,
         min(m.moved_at) as filled_on,
         case when m.crop_year < extract(year from current_date)::int then 'Carry-over from last year.' end as note
  from public.grain_movements m
  group by m.bin_id, m.crop_id, m.crop_year
) o
where o.bu > 0;

-- Bin plan for this year: which field each bin is for.
insert into public.bin_allocations (crop_year, bin_id, crop_id, field_id, estimated_bu, actual_bu, sealed_for_seed)
select distinct on (l.bin_id) l.crop_year, l.bin_id, l.crop_id, l.field_id,
       round(least(bb.capacity_bu, h.total_bu) / 100) * 100,
       round(sum(l.bushels) over (partition by l.bin_id)),
       false
from public.bin_loads l
join public.bins bb on bb.id = l.bin_id
join demo_harvest h on h.field_id = l.field_id
where l.bin_id is not null
order by l.bin_id, l.loaded_on;

insert into public.bin_allocations (crop_year, bin_id, crop_id, field_id, estimated_bu, actual_bu, sealed_for_seed)
select extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000519', p.crop_id, p.field_id,
       round(p.yield_per_acre_override * p.planned_acres / 100) * 100, null, false
from public.crop_plans p
where p.field_id = '0de30000-0000-4000-8000-000000000115' and p.crop_year = extract(year from current_date)::int;

insert into public.bin_allocations (crop_year, bin_id, crop_id, field_id, estimated_bu, actual_bu, sealed_for_seed)
values (extract(year from current_date)::int, '0de30000-0000-4000-8000-000000000504', (select id from public.crops where name = 'Wheat'),
        null, 2700, 2700, true);

-- Alfalfa hay off Hay Flat (not weighed over the grain scale).
insert into public.crop_history (crop_year, field_id, crop_id, variety, acres, yield_per_acre, yield_unit, actual_yield_total, source, source_note)
select extract(year from current_date)::int, p.field_id, p.crop_id, p.variety, p.planned_acres, 5950, 'lbs', round(5950 * p.planned_acres), 'manual',
       'Two cuts: 380 + 240 round bales at about 1,400 lb.'
from public.crop_plans p
where p.field_id = '0de30000-0000-4000-8000-000000000104' and p.crop_year = extract(year from current_date)::int;

-- Prices: this year, next year and the last two (for the profit screens).
insert into public.year_unlocks (crop_year)
select y from generate_series(extract(year from current_date)::int - 2, extract(year from current_date)::int - 1) y
on conflict (crop_year) do nothing;

insert into public.crop_prices (crop_id, crop_year, price_per_unit)
select c.id, extract(year from current_date)::int + v.dy, v.price
from (values
  ('Canola', -2, 15.60), ('Canola', -1, 13.40), ('Canola', 0, 14.10), ('Canola', 1, 14.40),
  ('Wheat',  -2, 9.10),  ('Wheat',  -1, 8.20),  ('Wheat',  0, 8.05),  ('Wheat',  1, 8.30),
  ('Barley', -2, 6.40),  ('Barley', -1, 5.60),  ('Barley', 0, 6.10),  ('Barley', 1, 5.90),
  ('Peas',   -2, 10.80), ('Peas',   -1, 9.60),  ('Peas',   0, 9.30),  ('Peas',   1, 9.20),
  ('Oats',   -2, 4.60),  ('Oats',   -1, 3.90),  ('Oats',   0, 4.10),  ('Oats',   1, 4.00),
  ('Alfalfa', -2, 0.085), ('Alfalfa', -1, 0.07), ('Alfalfa', 0, 0.075), ('Alfalfa', 1, 0.07),
  ('Green Feed', -2, 0.06), ('Green Feed', -1, 0.055), ('Green Feed', 0, 0.06), ('Green Feed', 1, 0.06)
) as v(crop, dy, price)
join public.crops c on c.name = v.crop;

delete from public.year_unlocks
 where crop_year between extract(year from current_date)::int - 2 and extract(year from current_date)::int - 1;

-- Moisture tests this fall.
insert into public.moisture_tests (tested_at, crop_year, field_id, crop_id, bin_id, temperature_c, meter_reading, chart_key, moisture_pct, grade, note, created_by, sample_condition)
select (current_date - t.ago)::timestamp + t.at::time, extract(year from current_date)::int, t.field_id::uuid, p.crop_id, t.bin_id::uuid, t.temp, t.reading,
       c.moisture_chart_key, t.m, t.grade, t.note, t.who::uuid, 'screened'
from (values
  ('0de30000-0000-4000-8000-000000000107', null, 59, '14:10', 22.0, 41.0, 17.1, 'tough', 'Too tough yet — wait a day.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000107', '0de30000-0000-4000-8000-000000000511', 57, '15:30', 24.0, 37.5, 15.3, 'dry', null, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000101', '0de30000-0000-4000-8000-000000000505', 34, '13:00', 18.0, 33.0, 13.9, 'dry', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000111', '0de30000-0000-4000-8000-000000000513', 24, '16:20', 16.0, 34.0, 14.1, 'dry', null, '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000102', '0de30000-0000-4000-8000-000000000506', 15, '12:40', 15.0, 28.0, 8.6, 'dry', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000105', '0de30000-0000-4000-8000-000000000508', 8, '18:05', 12.0, 31.0, 9.6, 'dry', 'Run the fan anyway: green seed in the low spots.', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000110', '0de30000-0000-4000-8000-000000000501', 3, '11:30', 9.0, 34.5, 10.8, 'tough', 'Morning dew. Fan on #1 until it is under 10.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000110', '0de30000-0000-4000-8000-000000000502', 1, '15:45', 14.0, 30.0, 9.5, 'dry', null, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000115', null, 1, '16:30', 13.0, 38.0, 12.9, 'damp', 'Pods still rubbery on the creek side. Give it a few days.', '0de30000-0000-4000-8000-0000000000a1')
) as t(field_id, bin_id, ago, at, temp, reading, m, grade, note, who)
join public.crop_plans p on p.field_id = t.field_id::uuid and p.crop_year = extract(year from current_date)::int
join public.crops c on c.id = p.crop_id;

-- Marketing: example prices (made up for the demo), cash bids, targets.
insert into public.market_series (id, code, kind, name, commodity, unit, region, source, crop_id, derived, notes)
select v.id::uuid, v.code, 'crop', v.name, v.commodity, '$/tonne', 'Alberta', 'ab-crop', c.id, false, 'Example prices made up for the demo farm.'
from (values
  ('0de30000-0000-4000-8000-000000000571', 'demo.crop.canola', 'Canola (example)', 'Canola', 'Canola'),
  ('0de30000-0000-4000-8000-000000000572', 'demo.crop.wheat',  'Wheat (example)',  'Wheat',  'Wheat'),
  ('0de30000-0000-4000-8000-000000000573', 'demo.crop.barley', 'Feed barley (example)', 'Barley', 'Barley'),
  ('0de30000-0000-4000-8000-000000000574', 'demo.crop.peas',   'Yellow peas (example)', 'Dry peas', 'Peas'),
  ('0de30000-0000-4000-8000-000000000575', 'demo.crop.oats',   'Oats (example)',   'Oats',   'Oats')
) as v(id, code, name, commodity, crop)
join public.crops c on c.name = v.crop;

-- Weekly prices for two years: a base, a slow cycle and a little noise.
insert into public.market_prices (series_id, observed_on, value)
select s.id::uuid, (current_date - w * 7),
       round((s.base * (1 + 0.09 * sin((w + s.phase) / 9.0) + 0.04 * cos(w / 4.3) + ((abs(hashtext(s.id || w)) % 21) - 10) / 600.0))::numeric, 2)
from (values
  ('0de30000-0000-4000-8000-000000000571', 625, 3), ('0de30000-0000-4000-8000-000000000572', 295, 11),
  ('0de30000-0000-4000-8000-000000000573', 265, 7), ('0de30000-0000-4000-8000-000000000574', 340, 15),
  ('0de30000-0000-4000-8000-000000000575', 255, 5)
) as s(id, base, phase)
cross join generate_series(0, 104) w;

insert into public.cash_bids (crop_id, buyer, bid_on, price_per_unit, unit, delivery_month, location, notes, created_by)
select c.id, v.buyer, current_date - v.ago, v.price, 'bu', v.month, v.loc, null, '0de30000-0000-4000-8000-0000000000a1'
from (values
  ('Canola', 'Creekside Grain Terminal', 1, 14.18, 'Spot', 'Creekside'),
  ('Canola', 'Creekside Grain Terminal', 8, 13.96, 'Spot', 'Creekside'),
  ('Canola', 'Creekside Grain Terminal', 1, 14.52, 'Mar', 'Creekside'),
  ('Wheat',  'Creekside Grain Terminal', 1, 7.92, 'Spot', 'Creekside'),
  ('Wheat',  'Creekside Grain Terminal', 1, 8.21, 'Feb', 'Creekside'),
  ('Barley', 'Prairie feedlot bid', 2, 5.95, 'Nov', 'Delivered feedlot'),
  ('Peas',   'Parkland Pulse Processors', 3, 9.25, 'Spot', 'Parkland plant'),
  ('Oats',   'Prairie feed mill bid', 5, 4.05, 'Nov', 'Delivered')
) as v(crop, buyer, ago, price, month, loc)
join public.crops c on c.name = v.crop;

insert into public.marketing_targets (crop_id, crop_year, mode, value, quantity, series_id, note, active, created_by)
select c.id, extract(year from current_date)::int, v.mode, v.val, v.qty, v.series::uuid, v.note, true, (select id from public.users order by created_at limit 1)
from (values
  ('Canola', 'absolute', 660, 8000, '0de30000-0000-4000-8000-000000000571', 'Sell another 8,000 bu if canola reaches $660/t.'),
  ('Wheat', 'over_breakeven', 40, 10000, '0de30000-0000-4000-8000-000000000572', 'Price the rest of the wheat once it is $40/t over breakeven.'),
  ('Barley', 'absolute', 290, 6000, '0de30000-0000-4000-8000-000000000573', 'Feed barley left after the cattle are fed.')
) as v(crop, mode, val, qty, series, note)
join public.crops c on c.name = v.crop;
