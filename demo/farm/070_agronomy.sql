-- Agronomy: products and prices, this season's field passes (seeding, spraying,
-- harvest), chemical labels with example label rules, soil tests with example
-- AI assessments, sample sites, scouting, fertilizer programs and blends.
-- Ids: products 09NN, soil reports 0aNN.

-- Products (chemicals by the litre, fertilizer by the kg). Generic names.
insert into public.jd_products (id, name, unit, price_per_unit, pmra_registration, notes, category, label_note, manual_crops) values
  ('0de30000-0000-4000-8000-000000000901', 'Glyphosate 540', 'L', 6.20, 'DEMO-1001', 'Burnoff and pre-harvest.', 'chemical', null, '{}'),
  ('0de30000-0000-4000-8000-000000000902', 'Glufosinate 150', 'L', 14.50, 'DEMO-1002', 'Liberty-system canola only.', 'chemical', null, '{canola}'),
  ('0de30000-0000-4000-8000-000000000903', 'Clethodim 240', 'L', 38.00, 'DEMO-1003', 'Grass partner in canola and peas.', 'chemical', null, '{canola,pea}'),
  ('0de30000-0000-4000-8000-000000000904', 'Florasulam + MCPA', 'L', 24.00, 'DEMO-1004', 'Broadleaf herbicide for cereals.', 'chemical', null, '{wheat,barley}'),
  ('0de30000-0000-4000-8000-000000000905', 'Pinoxaden 100', 'L', 46.00, 'DEMO-1005', 'Wild oats in wheat and barley.', 'chemical', null, '{wheat,barley}'),
  ('0de30000-0000-4000-8000-000000000906', 'Imazamox + Bentazon', 'L', 19.00, 'DEMO-1006', 'Peas. Watch the re-cropping interval.', 'chemical', null, '{pea}'),
  ('0de30000-0000-4000-8000-000000000907', 'MCPA Ester 600', 'L', 9.80, 'DEMO-1007', null, 'chemical', null, '{oats,wheat,barley}'),
  ('0de30000-0000-4000-8000-000000000908', 'Prothioconazole + Fluopyram', 'L', 118.00, 'DEMO-1008', 'Sclerotinia fungicide for canola.', 'chemical', null, '{canola}'),
  ('0de30000-0000-4000-8000-000000000909', 'Prothioconazole + Tebuconazole', 'L', 72.00, 'DEMO-1009', 'Fusarium head blight on the irrigated cereals.', 'chemical', null, '{wheat,barley}'),
  ('0de30000-0000-4000-8000-000000000910', 'Diquat 240', 'L', 21.00, 'DEMO-1010', 'Desiccant for peas.', 'chemical', null, '{pea}'),
  ('0de30000-0000-4000-8000-000000000921', '46-0-0 Urea', 'kg', 0.82, null, null, 'fertilizer', null, '{}'),
  ('0de30000-0000-4000-8000-000000000922', '11-52-0 MAP', 'kg', 1.08, null, null, 'fertilizer', null, '{}'),
  ('0de30000-0000-4000-8000-000000000923', '21-0-0-24 AMS', 'kg', 0.62, null, null, 'fertilizer', null, '{}'),
  ('0de30000-0000-4000-8000-000000000924', '82-0-0 Anhydrous', 'kg', 1.10, null, null, 'fertilizer', null, '{}');

insert into public.jd_product_aliases (deere_name, product_id, ignored)
select name, id, false from public.jd_products where id::text like '0de30000-0000-4000-8000-0000000009%';

-- The registry entries and labels behind the product numbers (made up).
insert into public.chemicals (registration_number, name, registration_status, marketing_type, active_ingredients, product_type, registrant, use_site_categories, sites_of_use, pests, first_registered, expiry_date)
select p.pmra_registration, p.name, 'Registered', 'Commercial', p.name, case when p.name like 'Prothio%' then 'Fungicide' when p.name like 'Diquat%' then 'Herbicide (desiccant)' else 'Herbicide' end,
       'Example Crop Protection Co.', 'Terrestrial food crops', 'Canola, wheat, barley, peas, oats',
       case when p.name like 'Prothio%' then 'Sclerotinia stem rot, fusarium head blight, leaf spots' else 'Annual broadleaf and grass weeds' end,
       current_date - 4000, current_date + 1500
from public.jd_products p where p.pmra_registration like 'DEMO-%';

-- The product inserts queued a label read for each; mark them read.
update public.chemical_labels l set
  extraction_status = 'ok', extracted_at = now() - interval '120 days', extraction_model = 'claude-sonnet-5',
  application_method = 'ground', water_volume = '10–20 US gal/ac', rainfast_hours = case when l.registration_number in ('DEMO-1001', 'DEMO-1010') then 1 else 4 end,
  reentry_hours = 12, reentry_field_hours = 12,
  reentry_note = 'Example: stay out of treated fields for 12 hours unless wearing the label''s protective clothing.',
  extraction_notes = 'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
    || 'Read from the product label. Rates are per acre in 10–20 US gal of water by ground; check the crop list for the stage limits before spraying.',
  grazing_rules_status = 'read', grazing_rules_extracted_at = now() - interval '120 days',
  grazing_rules_note = 'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Grazing and feeding limits as the label states them.',
  recrop_status = 'read', recrop_extracted_at = now() - interval '120 days',
  recrop_note = 'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Following crops the label allows, and how long to wait.',
  evidence = jsonb_build_object('reentry_hours', 'Example: do not enter or allow worker entry into treated areas during the restricted-entry interval of 12 hours.'),
  label_pages = 18
where l.registration_number like 'DEMO-%';

update public.chemical_labels set grazing_restriction = 'Example: do not graze or cut for hay within 7 days of application.'
 where registration_number in ('DEMO-1004', 'DEMO-1007');
update public.chemical_labels set grazing_restriction = 'Example: do not graze treated crops or feed treated straw to livestock.'
 where registration_number in ('DEMO-1008', 'DEMO-1010');

insert into public.chemical_label_crops (registration_number, crop, pest, rate, preharvest_interval_days, replant_interval_days, rotation_restriction, origin, evidence, reentry_hours, reentry_field_hours)
select v.reg, v.crop, v.pest, v.rate, v.phi, null, v.rot, 'claude', jsonb_build_object('quote', 'Example: ' || v.quote), 12, 12
from (values
  ('DEMO-1001', 'Wheat', 'Pre-harvest weed control', '0.67 L/ac', 7, null, 'Apply when grain is under 30% moisture.'),
  ('DEMO-1001', 'Canola', 'Pre-harvest weed control', '0.67 L/ac', 7, null, 'Not on canola grown for seed.'),
  ('DEMO-1002', 'Canola', 'Annual broadleaf and grass weeds', '1.35 L/ac', 60, null, 'Glufosinate-tolerant canola only, cotyledon to early bolting.'),
  ('DEMO-1004', 'Wheat', 'Broadleaf weeds', '0.5 L/ac', 60, null, 'Two-leaf to flag-leaf stage.'),
  ('DEMO-1004', 'Barley', 'Broadleaf weeds', '0.5 L/ac', 60, null, 'Two-leaf to flag-leaf stage.'),
  ('DEMO-1006', 'Peas', 'Broadleaf and grass weeds', '0.5 L/ac', 60, 'Canola other than imidazolinone-tolerant: next season with caution', 'One to six nodes.'),
  ('DEMO-1008', 'Canola', 'Sclerotinia stem rot', '0.3 L/ac', 30, null, '20–50% bloom.'),
  ('DEMO-1009', 'Wheat', 'Fusarium head blight', '0.32 L/ac', 30, null, 'Early flowering.'),
  ('DEMO-1010', 'Peas', 'Desiccation', '0.7 L/ac', 7, null, 'When 75% of pods are yellow-brown.')
) as v(reg, crop, pest, rate, phi, rot, quote);

insert into public.chemical_grazing_rules (registration_number, crop, crop_key, kind, days, never, condition, quote, source) values
  ('DEMO-1004', 'Wheat',  'wheat',  'graze', 7,  false, null, 'Example: do not graze or cut for hay within 7 days of application.', 'label'),
  ('DEMO-1004', 'Barley', 'barley', 'graze', 7,  false, null, 'Example: do not graze or cut for hay within 7 days of application.', 'label'),
  ('DEMO-1007', null,     null,     'graze', 7,  false, 'Lactating dairy animals: 14 days.', 'Example: do not graze treated areas within 7 days of application.', 'label'),
  ('DEMO-1007', null,     null,     'slaughter', 3, false, 'Remove meat animals from treated fields 3 days before slaughter.', 'Example: meat animals must be removed from treated areas 3 days before slaughter.', 'label'),
  ('DEMO-1008', 'Canola', 'canola', 'feed',  null, true, null, 'Example: do not feed treated crop or straw to livestock.', 'label'),
  ('DEMO-1010', 'Peas',   'pea',    'graze', null, true, null, 'Example: do not graze treated crops or feed treated straw to livestock.', 'label'),
  ('DEMO-1001', null,     null,     'graze', 5,  false, 'After a pre-harvest application.', 'Example: do not graze or harvest treated vegetation for livestock feed within 5 days.', 'label');

insert into public.chemical_recrop_rules (registration_number, following_crop, crop_key, months, status, condition, quote, source) values
  ('DEMO-1006', 'Wheat',  'wheat',  10, 'ok',   null, 'Example: wheat, barley and peas may be seeded the year following application.', 'label'),
  ('DEMO-1006', 'Barley', 'barley', 10, 'ok',   null, 'Example: wheat, barley and peas may be seeded the year following application.', 'label'),
  ('DEMO-1006', 'Canola', 'canola', 22, 'second_season', 'Imidazolinone-tolerant canola may follow the next year.', 'Example: do not seed canola other than imidazolinone-tolerant varieties until the second season after application.', 'label'),
  ('DEMO-1006', 'Oats',   'oats',   10, 'ok',   null, 'Example: oats may be seeded the year following application.', 'label'),
  ('DEMO-1004', 'Canola', 'canola', 11, 'ok',   null, 'Example: canola, peas and cereals may be grown the year following application.', 'label'),
  ('DEMO-1004', 'Peas',   'pea',    11, 'ok',   null, 'Example: canola, peas and cereals may be grown the year following application.', 'label'),
  ('DEMO-1002', 'Wheat',  'wheat',  null, 'ok', null, 'Example: no rotational crop restrictions the year after application.', 'label'),
  ('DEMO-1002', 'Peas',   'pea',    null, 'ok', null, 'Example: no rotational crop restrictions the year after application.', 'label');

-- This season's passes. Day offsets are from today: seeding early May,
-- in-crop spraying in June, fungicide in July, harvest from bin_loads.
create temporary table demo_ops on commit drop as
with fp as (
  select p.field_id, f.name as field_name, c.name as crop, p.variety, p.planned_acres as acres,
         right(p.field_id::text, 3) as fx,
         (fp2.field_id is not null) as irrigated
  from public.crop_plans p
  join public.crops c on c.id = p.crop_id
  join public.fields f on f.id = p.field_id
  left join public.field_pivots fp2 on fp2.field_id = p.field_id
  where p.crop_year = extract(year from current_date)::int
)
select fp.*, o.kind, o.ago, o.mix, o.rate_gal, o.op_type
from fp
cross join lateral (values
  ('burnoff',   157 - (fp.fx::int % 5), jsonb_build_array(jsonb_build_array('Glyphosate 540', 0.67)), 10, 'application'),
  ('seeding',   150 - (fp.fx::int % 12), null::jsonb, null, 'seeding'),
  ('incrop',    118 - (fp.fx::int % 9),
     case fp.crop
       when 'Canola' then jsonb_build_array(jsonb_build_array('Glufosinate 150', 1.35), jsonb_build_array('Clethodim 240', 0.08))
       when 'Wheat'  then jsonb_build_array(jsonb_build_array('Florasulam + MCPA', 0.5), jsonb_build_array('Pinoxaden 100', 0.5))
       when 'Barley' then jsonb_build_array(jsonb_build_array('Florasulam + MCPA', 0.5), jsonb_build_array('Pinoxaden 100', 0.5))
       when 'Peas'   then jsonb_build_array(jsonb_build_array('Imazamox + Bentazon', 0.5))
       when 'Oats'   then jsonb_build_array(jsonb_build_array('MCPA Ester 600', 0.4))
     end, 10, 'application'),
  ('fungicide', 88 - (fp.fx::int % 6),
     case when fp.crop = 'Canola' then jsonb_build_array(jsonb_build_array('Prothioconazole + Fluopyram', 0.3))
          when fp.irrigated and fp.crop in ('Wheat', 'Barley') then jsonb_build_array(jsonb_build_array('Prothioconazole + Tebuconazole', 0.32)) end, 15, 'application'),
  ('desiccate', 64, case when fp.crop = 'Peas' then jsonb_build_array(jsonb_build_array('Diquat 240', 0.7)) end, 20, 'application'),
  ('preharvest', 35, case when fp.field_id = '0de30000-0000-4000-8000-000000000111' then jsonb_build_array(jsonb_build_array('Glyphosate 540', 0.67)) end, 10, 'application')
) as o(kind, ago, mix, rate_gal, op_type)
where fp.crop not in ('Alfalfa')
  and (o.op_type = 'seeding' or o.mix is not null);

insert into public.jd_field_operations (jd_id, field_id, operation_type, crop_season, started_at, ended_at, treated_crop, operator_name, machine_id, machine_vin,
  products, raw, synced_at, wind_speed_kmh, air_temp_c, humidity_pct, app_speed_kmh, conditions_source, conditions_at, applied_area_ha, work_minutes, source, confirm_status)
select 'demo-op-' || o.fx || '-' || o.kind,
       o.field_id, o.op_type, extract(year from current_date)::int,
       ((current_date - o.ago)::timestamp + time '08:30' + make_interval(mins => (o.fx::int % 7) * 40)) at time zone 'America/Edmonton',
       ((current_date - o.ago)::timestamp + time '08:30' + make_interval(mins => (o.fx::int % 7) * 40 + round(o.acres * case when o.op_type = 'seeding' then 1.6 else 0.45 end)::int)) at time zone 'America/Edmonton',
       o.crop,
       case when o.op_type = 'seeding' then 'Alex Rivers' else 'Jordan Pike' end,
       case when o.op_type = 'seeding' then 'demo-eq-01' else 'demo-eq-04' end,
       case when o.op_type = 'seeding' then '1RW8370RXMD012345' else '1N04045RVPN098765' end,
       case when o.op_type = 'seeding' then
         jsonb_build_array(
           jsonb_build_object('name', o.variety, 'productType', 'VARIETY',
             'rate', jsonb_build_object('value', case o.crop when 'Canola' then 5 when 'Wheat' then 120 when 'Barley' then 100 when 'Peas' then 200 when 'Oats' then 95 else 80 end, 'unitId', 'lb1ac-1', 'unit', 'lb/ac')),
           jsonb_build_object('name', '46-0-0 Urea', 'productType', 'FERTILIZER',
             'rate', jsonb_build_object('value', case o.crop when 'Peas' then 0 when 'Canola' then 200 when 'Wheat' then 170 else 150 end * case when o.irrigated then 1.2 else 1 end, 'unitId', 'lb1ac-1', 'unit', 'lb/ac')),
           jsonb_build_object('name', '11-52-0 MAP', 'productType', 'FERTILIZER',
             'rate', jsonb_build_object('value', case o.crop when 'Peas' then 45 else 55 end, 'unitId', 'lb1ac-1', 'unit', 'lb/ac')),
           jsonb_build_object('name', '21-0-0-24 AMS', 'productType', 'FERTILIZER',
             'rate', jsonb_build_object('value', case o.crop when 'Canola' then 80 else 30 end, 'unitId', 'lb1ac-1', 'unit', 'lb/ac'))
         )
       else
         jsonb_build_array(jsonb_build_object(
           'name', 'Tank mix', 'tankMix', true,
           'rate', jsonb_build_object('value', o.rate_gal, 'unitId', 'gal1ac-1', 'unit', 'gal/ac'),
           'carrier', jsonb_build_object('name', 'Water', 'rate', jsonb_build_object('value', o.rate_gal - 0.1, 'unitId', 'gal1ac-1')),
           'components', (select jsonb_agg(jsonb_build_object('name', m->>0, 'productType', 'CHEMICAL', 'guid', md5(o.fx || o.kind || (m->>0)),
                                     'rate', jsonb_build_object('value', (m->>1)::numeric, 'unitId', 'l1ac-1', 'unit', 'L/ac')))
                          from jsonb_array_elements(o.mix) m)))
       end,
       jsonb_build_object(
         'cropName', upper(o.crop),
         'fieldOperationMachines', jsonb_build_array(jsonb_build_object(
            'name', case when o.op_type = 'seeding' then '8R 370 tractor' else 'R4045 sprayer' end,
            'vin', case when o.op_type = 'seeding' then '1RW8370RXMD012345' else '1N04045RVPN098765' end,
            'operators', jsonb_build_array(jsonb_build_object('name', case when o.op_type = 'seeding' then 'Alex Rivers' else 'Jordan Pike' end)))),
         'varieties', case when o.op_type = 'seeding' then jsonb_build_array(jsonb_build_object('name', o.variety, 'brand', 'Northfield Seeds')) else '[]'::jsonb end
       ),
       now() - make_interval(days => o.ago),
       case when o.op_type = 'application' then 6 + (o.fx::int + o.ago) % 11 end,
       case when o.op_type = 'application' then 11 + (o.fx::int + o.ago) % 12 end,
       case when o.op_type = 'application' then 45 + (o.fx::int * 7 + o.ago) % 30 end,
       case when o.op_type = 'application' then 22 + (o.fx::int % 5) end,
       case when o.op_type = 'application' then 'deere' end,
       case when o.op_type = 'application' then ((current_date - o.ago)::timestamp + time '10:00') at time zone 'America/Edmonton' end,
       round(o.acres * 0.404686, 2),
       round(o.acres * case when o.op_type = 'seeding' then 1.6 else 0.45 end),
       'deere', null
from demo_ops o;

-- Harvest passes, from the first and last load off each field.
insert into public.jd_field_operations (jd_id, field_id, operation_type, crop_season, started_at, ended_at, treated_crop, operator_name, machine_id, machine_vin,
  products, raw, synced_at, applied_area_ha, work_minutes, source)
select 'demo-op-' || right(l.field_id::text, 3) || '-harvest', l.field_id, 'harvest', l.crop_year,
       (min(l.loaded_on)::timestamp + time '12:30') at time zone 'America/Edmonton',
       (max(l.loaded_on)::timestamp + time '21:00') at time zone 'America/Edmonton',
       c.name, 'Alex Rivers', 'demo-eq-03', '1H0S780SCL0765432',
       jsonb_build_array(jsonb_build_object('name', min(l.variety), 'productType', 'VARIETY')),
       jsonb_build_object('cropName', upper(c.name),
         'fieldOperationMachines', jsonb_build_array(jsonb_build_object('name', 'S780 combine', 'vin', '1H0S780SCL0765432',
            'operators', jsonb_build_array(jsonb_build_object('name', 'Alex Rivers'))))),
       now() - make_interval(days => current_date - max(l.loaded_on)),
       round(max(b.acres) * 0.404686 * case when bool_or(l.last_from_field) then 1 else 0.55 end, 2),
       round(max(b.acres) * 0.9 * case when bool_or(l.last_from_field) then 1 else 0.55 end),
       'deere'
from public.bin_loads l
join public.crops c on c.id = l.crop_id
join public.field_boundaries b on b.field_id = l.field_id and b.valid_to is null
group by l.field_id, l.crop_year, c.name;

-- One Deere hand entry still waiting to be confirmed (shows on Home).
insert into public.jd_field_operations (jd_id, field_id, operation_type, crop_season, started_at, ended_at, treated_crop, operator_name, products, raw, synced_at, applied_area_ha, source, confirm_status)
values ('demo-op-104-weeds', '0de30000-0000-4000-8000-000000000104', 'application', extract(year from current_date)::int,
        ((current_date - 101)::timestamp + time '09:00') at time zone 'America/Edmonton', null, 'Alfalfa', 'Casey Moore',
        jsonb_build_array(jsonb_build_object('name', 'MCPA Ester 600', 'rate', jsonb_build_object('value', 0.25, 'unitId', 'l1ac-1', 'unit', 'L/ac'))),
        jsonb_build_object('cropName', 'ALFALFA'), now() - interval '100 days', 0, 'deere', 'pending');

-- The tough peas sample on West Half was dealt with weeks ago.
update public.bin_air_alerts set dismissed_at = now() - interval '50 days', dismissed_by = '0de30000-0000-4000-8000-0000000000a1', dismissed_note = 'Dried down in the bin with the fan.'
 where field_id = '0de30000-0000-4000-8000-000000000107';
update public.notifications set read_at = now() - interval '50 days', created_at = now() - interval '57 days'
 where kind = 'bin_needs_air' and title like 'West Half%';

-- Chemical bought this year: what was sprayed plus a little left over.
insert into public.product_purchases (product_id, supplier, invoice_no, invoice_date, description, ref_no, quantity, pack_unit, unit_price, amount, pack_size, canonical_unit, price_per_canonical, is_product)
select p.id, 'Prairie Ag Supply', 'PAS-' || (31000 + row_number() over (order by p.name)), current_date - 170,
       p.name || ' — ' || u.pack || case when u.pack >= 115 then ' L tote' else ' L jug' end, null,
       ceil(u.used * 1.08 / u.pack), case when u.pack >= 115 then 'tote' else 'jug' end, round(p.price_per_unit * u.pack, 2), round(ceil(u.used * 1.08 / u.pack) * p.price_per_unit * u.pack, 2),
       u.pack, 'L', p.price_per_unit, true
from public.jd_products p
join lateral (
  select sum(a.rate_value * b.acres) as used,
         case when sum(a.rate_value * b.acres) > 2000 then 450 when sum(a.rate_value * b.acres) > 300 then 115 else 10 end as pack
  from public.product_applications a
  join public.field_boundaries b on b.field_id = a.field_id and b.valid_to is null
  where a.product_id = p.id
) u on u.used > 0
where p.category = 'chemical';

insert into public.product_purchases (product_id, supplier, invoice_no, invoice_date, description, quantity, pack_unit, unit_price, amount, pack_size, canonical_unit, price_per_canonical, is_product)
select p.id, 'Prairie Ag Supply', 'PAS-F' || (5100 + row_number() over (order by p.name)), current_date - 185, p.name || ' (bulk, tonnes)',
       v.tonnes, 'tonne', p.price_per_unit * 1000, round(v.tonnes * p.price_per_unit * 1000, 2), 1000, 'kg', p.price_per_unit, true
from public.jd_products p
join (values ('46-0-0 Urea', 178.0), ('11-52-0 MAP', 63.5), ('21-0-0-24 AMS', 41.0)) as v(name, tonnes) on v.name = p.name;

-- The purchase trigger stamps the original retailer's name; this farm's is Prairie Ag Supply.
update public.jd_products set price_source = 'Prairie Ag Supply invoice' where price_source like 'ICI%';

insert into public.chem_stock_adjustments (product_id, kind, quantity, occurred_on, note, created_by) values
  ('0de30000-0000-4000-8000-000000000901', 'count', 310, current_date - 30, 'Counted the chem shed after pre-harvest.', '0de30000-0000-4000-8000-0000000000a2');

-- Soil tests: this fall's samples on six fields, last fall's on four more.
insert into public.soil_test_reports (id, field_id, crop_year, part_label, crop_label, lab, report_ref, report_date, source_file)
select v.id::uuid, v.field::uuid, extract(year from current_date)::int + v.dy, '', v.next_crop, 'Prairie Soil Lab', v.ref,
       case when v.dy = 0 then current_date - 9 else current_date - 370 end, null
from (values
  ('0de30000-0000-4000-8000-000000000a01', '0de30000-0000-4000-8000-000000000102', 0,  'Wheat',  'PSL-24-11831'),
  ('0de30000-0000-4000-8000-000000000a02', '0de30000-0000-4000-8000-000000000103', 0,  'Wheat',  'PSL-24-11832'),
  ('0de30000-0000-4000-8000-000000000a03', '0de30000-0000-4000-8000-000000000105', 0,  'Wheat',  'PSL-24-11833'),
  ('0de30000-0000-4000-8000-000000000a04', '0de30000-0000-4000-8000-000000000112', 0,  'Barley', 'PSL-24-11834'),
  ('0de30000-0000-4000-8000-000000000a05', '0de30000-0000-4000-8000-000000000113', 0,  'Wheat',  'PSL-24-11835'),
  ('0de30000-0000-4000-8000-000000000a06', '0de30000-0000-4000-8000-000000000114', 0,  'Wheat',  'PSL-24-11836'),
  ('0de30000-0000-4000-8000-000000000a11', '0de30000-0000-4000-8000-000000000107', -1, 'Peas',   'PSL-23-09712'),
  ('0de30000-0000-4000-8000-000000000a12', '0de30000-0000-4000-8000-000000000109', -1, 'Oats',   'PSL-23-09713'),
  ('0de30000-0000-4000-8000-000000000a13', '0de30000-0000-4000-8000-000000000101', -1, 'Wheat',  'PSL-23-09714'),
  ('0de30000-0000-4000-8000-000000000a14', '0de30000-0000-4000-8000-000000000108', -1, 'Wheat',  'PSL-23-09715')
) as v(id, field, dy, next_crop, ref);

insert into public.soil_test_samples (report_id, sample_code, depth_label, depth_top_in, depth_bottom_in, om_pct, no3n_ppm, no3n_lb_ac, p_bicarb_ppm, k_ppm, so4s_ppm, ph, cec_meq,
                                      base_k_pct, base_mg_pct, base_ca_pct, base_na_pct, zn_ppm, cu_ppm, mn_ppm, fe_ppm, b_ppm, cl_ppm, ec_ms_cm)
select r.id, s.code, s.depth, s.top, s.bot,
       case when s.top = 0 then v.om end,
       round(v.no3 * s.nf / (s.bot - s.top) * 6 / 3.6, 1),
       round(v.no3 * s.nf),
       case when s.top = 0 then v.p end,
       case when s.top = 0 then v.k end,
       round(v.s * s.sf, 1),
       round(v.ph + s.phd, 1),
       case when s.top = 0 then v.cec end,
       case when s.top = 0 then round(v.k / 391.0 / v.cec * 100, 1) end,
       case when s.top = 0 then 18.5 end, case when s.top = 0 then round(100 - 18.5 - v.k / 391.0 / v.cec * 100 - 1.2, 1) end, case when s.top = 0 then 1.2 end,
       case when s.top = 0 then v.zn end, case when s.top = 0 then 1.4 end, case when s.top = 0 then 12 end, case when s.top = 0 then 85 end, case when s.top = 0 then 1.1 end,
       round(8 * s.sf, 1), round(0.35 + s.top * 0.01, 2)
from public.soil_test_reports r
join (values
  ('0de30000-0000-4000-8000-000000000a01', 6.4, 22, 18, 410, 9.0, 6.6, 31, 1.6),
  ('0de30000-0000-4000-8000-000000000a02', 5.8, 31, 14, 360, 7.5, 6.9, 27, 1.1),
  ('0de30000-0000-4000-8000-000000000a03', 6.1, 26, 12, 340, 5.5, 6.4, 28, 0.9),
  ('0de30000-0000-4000-8000-000000000a04', 5.2, 38, 24, 330, 11.0, 7.3, 24, 1.8),
  ('0de30000-0000-4000-8000-000000000a05', 5.0, 45, 21, 300, 8.0, 7.1, 23, 1.3),
  ('0de30000-0000-4000-8000-000000000a06', 4.8, 52, 16, 290, 6.0, 7.4, 22, 0.8),
  ('0de30000-0000-4000-8000-000000000a11', 6.0, 18, 15, 380, 7.0, 6.5, 29, 1.2),
  ('0de30000-0000-4000-8000-000000000a12', 3.6, 14, 11, 210, 4.5, 6.2, 15, 0.7),
  ('0de30000-0000-4000-8000-000000000a13', 6.2, 29, 20, 395, 8.5, 6.7, 30, 1.5),
  ('0de30000-0000-4000-8000-000000000a14', 4.1, 24, 9, 300, 6.5, 7.6, 25, 0.9)
) as v(report, om, no3, p, k, s, ph, cec, zn) on v.report::uuid = r.id
cross join (values ('A', '0-6"', 0, 6, 0.45, 1.0, 0.0), ('B', '6-24"', 6, 24, 0.55, 2.2, 0.3)) as s(code, depth, top, bot, nf, sf, phd);

insert into public.soil_sample_sites (field_id, code, lat, lng, crop_year, depth_label, notes, active, created_by)
select r.field_id, 'S' || k, st_y(pt) + (k - 2) * 0.0012, st_x(pt) + (k - 2) * 0.0015, r.crop_year, '0-6", 6-24"',
       case k when 1 then 'Knoll' when 2 then 'Mid-slope (benchmark)' else 'Lower slope' end, true, '0de30000-0000-4000-8000-0000000000a1'
from public.soil_test_reports r
join public.field_boundaries b on b.field_id = r.field_id and b.valid_to is null
cross join lateral (select st_pointonsurface(b.geom) as pt) p
cross join generate_series(1, 3) k
where r.crop_year = extract(year from current_date)::int;

-- Example AI assessments of this fall's soil tests.
insert into public.soil_test_assessments (report_id, crop_label, assessment_md, recommendation, model, generated_at, column_notes)
select r.id, r.crop_label,
       'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || v.body,
       v.rec::jsonb, 'claude-opus-5-5', now() - interval '8 days', v.notes::jsonb
from public.soil_test_reports r
join (values
  ('0de30000-0000-4000-8000-000000000a01',
   E'East Home came off canola with 22 lb of nitrate-N left in the top two feet, which is about what a 52 bu canola crop leaves on heavy black soil. Organic matter at 6.4% will mineralise a good share of next year''s nitrogen, so the wheat needs less than the book rate.\n\nPhosphorus is moderate at 18 ppm. Keep seed-placed MAP at the usual rate to hold it there; there is no case for building it on this field. Potassium and zinc are ample. Sulphur in the subsoil is fine for wheat.\n\nFor a 65 bu wheat target, plan on about 110 lb of actual N in total, most of it side-banded at seeding.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":95,"product_lb_per_ac":207,"timing":"Side-band at seeding","note":"Plus about 6 lb from the MAP."},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":26,"product_lb_per_ac":50,"timing":"Seed-placed","note":"Maintenance rate."}]',
   '{"no3n_lb_ac":{"summary":"Example: low-to-moderate carry-over, normal after canola.","priorCrop":"Canola","nextCrop":"Wheat"},"p_bicarb_ppm":{"summary":"Example: moderate; maintain, do not build.","priorCrop":"Canola","nextCrop":"Wheat"}}'),
  ('0de30000-0000-4000-8000-000000000a02',
   E'Schoolhouse has a little more nitrate left (31 lb) than the other canola fields, likely from the lower yield on the west side. Phosphorus at 14 ppm is on the low side of moderate.\n\nThe pH of 6.9 and good organic matter mean no lime or micronutrient concerns. Sulphur is adequate for wheat.\n\nFor wheat, trim nitrogen to about 100 lb actual and lift seed-placed phosphate slightly to start building P on this quarter.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":85,"product_lb_per_ac":185,"timing":"Side-band at seeding","note":null},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":31,"product_lb_per_ac":60,"timing":"Seed-placed","note":"Slightly above removal to build."}]',
   '{"p_bicarb_ppm":{"summary":"Example: low-moderate; worth building slowly.","priorCrop":"Canola","nextCrop":"Wheat"}}'),
  ('0de30000-0000-4000-8000-000000000a03',
   E'Slough Quarter is the leanest of the canola fields: 26 lb nitrate-N but only 12 ppm phosphorus and 5.5 ppm sulphate in the top six inches. The wet margins around the slough pull the average pH down to 6.4.\n\nPhosphorus is now the limiting nutrient here. A wheat crop will respond to a higher seed-placed rate, and the field would benefit from a build-up program over the next two canola cycles.\n\nSulphur is low enough that a little AMS with the wheat is cheap insurance.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":90,"product_lb_per_ac":196,"timing":"Side-band at seeding","note":null},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":36,"product_lb_per_ac":70,"timing":"Seed-placed","note":"Maximum safe seed-placed rate for wheat."},{"nutrient":"S","product":"21-0-0-24 AMS","lb_per_ac":10,"product_lb_per_ac":42,"timing":"Side-band at seeding","note":null}]',
   '{"so4s_ppm":{"summary":"Example: low in the surface; add a little sulphur.","priorCrop":"Canola","nextCrop":"Wheat"},"p_bicarb_ppm":{"summary":"Example: low; the limiting nutrient on this field.","priorCrop":"Canola","nextCrop":"Wheat"}}'),
  ('0de30000-0000-4000-8000-000000000a04',
   E'North Pivot came off 89 bu irrigated wheat and still has 38 lb of nitrate in the profile, which is typical under a pivot where late water keeps mineralising. Phosphorus is good at 24 ppm and potassium adequate.\n\nThe pH of 7.3 is fine for barley. Malt barley needs protein kept under 13%, so nitrogen should be moderate even under irrigation.\n\nFor a 115 bu malt barley target, about 95 lb of actual N is enough.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":85,"product_lb_per_ac":185,"timing":"Side-band at seeding","note":"Keep protein in the malt window."},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":26,"product_lb_per_ac":50,"timing":"Seed-placed","note":null}]',
   '{}'),
  ('0de30000-0000-4000-8000-000000000a05',
   E'Creek Pivot West carried a 64 bu canola crop and has 45 lb nitrate-N left, the most of any field sampled this fall. Organic matter is lower (5.0%) on this silt loam, so less comes from the soil itself over the season.\n\nPhosphorus and potassium are adequate. The wheat should be pushed for yield under the pivot: 90 bu is realistic with water.\n\nPlan about 150 lb of actual N in total, with a split: most at seeding and 30 lb through the pivot or as a top-dress at flag leaf to protect protein.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":115,"product_lb_per_ac":250,"timing":"Side-band at seeding","note":null},{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":30,"product_lb_per_ac":65,"timing":"Top-dress at flag leaf","note":"For protein."},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":28,"product_lb_per_ac":55,"timing":"Seed-placed","note":null}]',
   '{"no3n_lb_ac":{"summary":"Example: the highest carry-over on the farm this fall.","priorCrop":"Canola","nextCrop":"Wheat"}}'),
  ('0de30000-0000-4000-8000-000000000a06',
   E'Creek Pivot East grew 120 bu malt barley and still has 52 lb nitrate in the profile. Phosphorus is moderate at 16 ppm and potassium the lowest of the pivots at 290 ppm, though still adequate.\n\nZinc is marginal (0.8 ppm) on this field. Wheat is not very sensitive, but a small zinc rate in the blend is inexpensive.\n\nFor 90 bu wheat, plan about 135 lb of actual N with a split application.',
   '[{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":100,"product_lb_per_ac":217,"timing":"Side-band at seeding","note":null},{"nutrient":"N","product":"46-0-0 Urea","lb_per_ac":30,"product_lb_per_ac":65,"timing":"Top-dress at flag leaf","note":null},{"nutrient":"P","product":"11-52-0 MAP","lb_per_ac":31,"product_lb_per_ac":60,"timing":"Seed-placed","note":null},{"nutrient":"Zn","product":"Zinc sulphate","lb_per_ac":1,"product_lb_per_ac":3,"timing":"In the blend","note":"Marginal zinc."}]',
   '{"zn_ppm":{"summary":"Example: marginal; add a little zinc.","priorCrop":"Barley","nextCrop":"Wheat"}}')
) as v(report, body, rec, notes) on v.report::uuid = r.id;

-- Scouting this season.
insert into public.scouting_notes (field_id, crop_year, observed_at, lat, lng, category, subject, severity, note, created_by, resolved_at)
select v.field::uuid, extract(year from current_date)::int, ((current_date - v.ago)::timestamp + time '10:30') at time zone 'America/Edmonton',
       st_y(st_pointonsurface(b.geom)) + v.dy, st_x(st_pointonsurface(b.geom)) + v.dx, v.cat, v.subject, v.sev, v.note, v.who::uuid,
       case when v.resolved then now() - make_interval(days => v.ago - 7) end
from (values
  ('0de30000-0000-4000-8000-000000000102', 140, 0.001, -0.002, 'insect', 'Flea beetles', 2, 'About 15% leaf area loss on the field edge. Seed treatment holding in the middle.', '0de30000-0000-4000-8000-0000000000a1', true),
  ('0de30000-0000-4000-8000-000000000111', 120, -0.002, 0.001, 'weed', 'Wild oats', 2, 'Patches on the north end, 2–3 leaf. In-crop pass going on Thursday.', '0de30000-0000-4000-8000-0000000000a1', true),
  ('0de30000-0000-4000-8000-000000000105', 112, 0.0, 0.001, 'weed', 'Cleavers', 3, 'Heavy around the slough edge. Glufosinate will not fully control past 4 whorls — note for next year.', '0de30000-0000-4000-8000-0000000000a2', false),
  ('0de30000-0000-4000-8000-000000000113', 92, 0.001, 0.0, 'disease', 'Sclerotinia risk', 2, 'Canopy closed, wet week ahead, 20% bloom. Fungicide recommended.', '0de30000-0000-4000-8000-0000000000a1', true),
  ('0de30000-0000-4000-8000-000000000108', 80, -0.001, -0.001, 'disease', 'Tan spot', 1, 'Lower leaves only. Not worth spraying on dryland.', '0de30000-0000-4000-8000-0000000000a1', true),
  ('0de30000-0000-4000-8000-000000000115', 60, 0.0005, 0.002, 'insect', 'Bertha armyworm', 1, 'Pheromone trap counts low (80 moths). Keep watching.', '0de30000-0000-4000-8000-0000000000a3', false),
  ('0de30000-0000-4000-8000-000000000109', 95, 0.0, 0.0, 'other', 'Hail damage', 2, 'Hail on the 12th: about 10% stem breakage on the west side.', '0de30000-0000-4000-8000-0000000000a1', false),
  ('0de30000-0000-4000-8000-000000000107', 11, 0.0015, -0.0025, 'weed', 'Kochia', 2, 'Kochia patch in the pea stubble near the rock pile. Plan a fall burnoff before anhydrous.', '0de30000-0000-4000-8000-0000000000a1', false)
) as v(field, ago, dy, dx, cat, subject, sev, note, who, resolved)
join public.field_boundaries b on b.field_id = v.field::uuid and b.valid_to is null;

-- Fertilizer: prepay programs, what is in the yard, settings, saved blends.
insert into public.fert_programs (supplier, name, discount_pct, discount_per_tonne, deadline, terms, status, note, created_by, pay_by) values
  ('Prairie Ag Supply', 'Spring fertilizer prepay', 3, null, current_date + 9, 'Pay in full by the deadline; product taken by 31 May.', 'open', 'Worth it if operating interest is under 6%.', (select id from public.users order by created_at limit 1), current_date + 9),
  ('Prairie Ag Supply', 'Fall anhydrous early booking', null, 25, current_date + 20, 'Book by the deadline, apply before freeze-up.', 'open', null, (select id from public.users order by created_at limit 1), current_date + 45),
  ('Prairie Ag Supply', 'Summer fill program', 4, null, current_date - 70, 'Urea taken in July–August.', 'passed', 'Storage was full.', (select id from public.users order by created_at limit 1), current_date - 70);

insert into public.fert_inventory (product, quantity, unit, bin_id, location, counted_on, note, created_by) values
  ('46-0-0', 38.5, 't', '0de30000-0000-4000-8000-000000000520', 'Main Yard', current_date - 12, 'Left over from spring; urea in F1.', '0de30000-0000-4000-8000-0000000000a1'),
  ('11-52-0', 6.2, 't', null, 'Shed', current_date - 12, 'Totes in the shed.', '0de30000-0000-4000-8000-0000000000a1');

insert into public.fert_settings (key, value, updated_by) values
  ('soil_zone', '"Black"', (select id from public.users order by created_at limit 1)),
  ('own_application_per_acre', '6.5', (select id from public.users order by created_at limit 1)),
  ('operating_rate_pct', '6.2', (select id from public.users order by created_at limit 1)),
  ('irrigation_inches', '8', (select id from public.users order by created_at limit 1)),
  ('farm_name', '"Prairie Creek Farm"', (select id from public.users order by created_at limit 1));

insert into public.fert_blends (name, field_id, crop_year, acres, targets, lines, cost_per_ac, rate_lb_ac, advice, notes, created_by, created_at)
select v.name, v.field::uuid, extract(year from current_date)::int + 1, b.acres, v.targets::jsonb, v.lines::jsonb, v.cost, v.rate,
       'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || v.advice,
       v.notes, (select id from public.users order by created_at limit 1), now() - make_interval(days => v.ago)
from (values
  ('Slough Quarter wheat', '0de30000-0000-4000-8000-000000000105',
   '{"n":90,"p":36,"k":0,"s":10,"zn":0}',
   '[{"name":"46-0-0 Urea","lb_per_ac":178,"n":0.46,"p":0,"k":0,"s":0,"zn":0,"price_per_tonne":820},{"name":"11-52-0 MAP","lb_per_ac":70,"n":0.11,"p":0.52,"k":0,"s":0,"zn":0,"price_per_tonne":1080},{"name":"21-0-0-24 AMS","lb_per_ac":42,"n":0.21,"p":0,"k":0,"s":0.24,"zn":0,"price_per_tonne":620}]',
   126.40, 290,
   E'- **Phosphorus is the priority** on this quarter: 70 lb/ac of MAP is the most you can safely seed-place with wheat.\n- The AMS covers the low sulphur cheaply and supplies 9 lb of the nitrogen.\n- **Urea side-banded** keeps the rest of the N away from the seed.\n- At current prices this blend is about $126/ac; booking on the prepay saves roughly $3.80/ac.',
   'From this fall''s soil test.', 6),
  ('Creek Pivot West wheat', '0de30000-0000-4000-8000-000000000113',
   '{"n":145,"p":28,"k":0,"s":0,"zn":0}',
   '[{"name":"46-0-0 Urea","lb_per_ac":250,"n":0.46,"p":0,"k":0,"s":0,"zn":0,"price_per_tonne":820},{"name":"11-52-0 MAP","lb_per_ac":55,"n":0.11,"p":0.52,"k":0,"s":0,"zn":0,"price_per_tonne":1080}]',
   119.30, 305,
   E'- **Split the nitrogen**: about 115 lb at seeding, 30 lb at flag leaf, to protect protein under the pivot.\n- Phosphorus is adequate, so MAP at 55 lb/ac is a maintenance rate.\n- No sulphur needed after a well-fed canola crop.',
   null, 5)
) as v(name, field, targets, lines, cost, rate, advice, notes, ago)
join public.field_boundaries b on b.field_id = v.field::uuid and b.valid_to is null;

-- Input costs per acre by crop (this year and next), for the profit screens.
insert into public.crop_inputs (crop_id, crop_year, name, category, cost_per_acre)
select c.id, extract(year from current_date)::int + y.dy, v.name, v.cat::public.input_category, round(v.cost * (1 + y.dy * 0.03), 2)
from (values
  ('Canola', 'Seed', 'seed', 78), ('Canola', 'Fertilizer', 'fert', 132), ('Canola', 'Herbicide', 'chem', 42), ('Canola', 'Fungicide', 'chem', 36), ('Canola', 'Fuel and repairs', 'fuel', 38), ('Canola', 'Crop insurance', 'other', 24),
  ('Wheat', 'Seed', 'seed', 32), ('Wheat', 'Fertilizer', 'fert', 104), ('Wheat', 'Herbicide', 'chem', 36), ('Wheat', 'Fungicide', 'chem', 8), ('Wheat', 'Fuel and repairs', 'fuel', 36), ('Wheat', 'Crop insurance', 'other', 18),
  ('Barley', 'Seed', 'seed', 26), ('Barley', 'Fertilizer', 'fert', 92), ('Barley', 'Herbicide', 'chem', 34), ('Barley', 'Fuel and repairs', 'fuel', 35), ('Barley', 'Crop insurance', 'other', 15),
  ('Peas', 'Seed and inoculant', 'seed', 62), ('Peas', 'Fertilizer', 'fert', 28), ('Peas', 'Herbicide and desiccant', 'chem', 44), ('Peas', 'Fuel and repairs', 'fuel', 34), ('Peas', 'Crop insurance', 'other', 17),
  ('Oats', 'Seed', 'seed', 24), ('Oats', 'Fertilizer', 'fert', 70), ('Oats', 'Herbicide', 'chem', 12), ('Oats', 'Fuel and repairs', 'fuel', 33), ('Oats', 'Crop insurance', 'other', 11),
  ('Alfalfa', 'Fertilizer', 'fert', 30), ('Alfalfa', 'Fuel, twine and repairs', 'fuel', 55)
) as v(crop, name, cat, cost)
join public.crops c on c.name = v.crop
cross join (values (0), (1)) as y(dy);
