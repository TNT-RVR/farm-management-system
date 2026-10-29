-- Cattle and inventory screens that were empty in the demo (all made up):
-- the farm's usual bale weights, the cow-calf cost benchmark, the inputs
-- inventory (seed, fertilizer, chemical, fuel on hand), price watches on the
-- markets page, this year's ticked-off monthly jobs, the owner's quiet hours,
-- pasture sprays with their no-grazing days, water points on the pastures, and
-- a rented corn stubble for winter grazing. Dates are relative to the build
-- day, like the files before it, and shift to "today" when a visitor opens it.

-- ── Bale weights (Cattle → Feed: estimating baled feed) ─────────────────────
insert into public.bale_weight_defaults (bale_type, lb_per_bale, note, updated_by) values
  ('round', 1350, '5x6 hard-core rounds off the Hay Flat; weighed 12 on the scale in August.', (select id from public.users order by created_at limit 1)),
  ('big_square', 1150, '3x4x8 straw and greenfeed squares from the custom baler.', (select id from public.users order by created_at limit 1));

-- ── Cow-calf cost benchmark (Cattle → Economics) ───────────────────────────
-- The shape the quarterly refresh writes: the published base per cow, carried
-- forward on an input price index where one fits. Factors here are made up.
insert into public.cost_benchmarks (key, base_year, source, index_as_of, lines, total_per_cow, refreshed_at) values
  ('cattle_cow_calf_ab', 2026,
   'Example cow-calf cost of production, 150 cow herd, hay ration — made-up figures for the demo, not a published budget',
   date_trunc('quarter', current_date - 100)::date,
   jsonb_build_array(
     jsonb_build_object('key', 'cow_cost_per_head',     'label', 'Cow cost',          'base', 464, 'factor', null,  'current', 464, 'escalated', false),
     jsonb_build_object('key', 'feed_cost_per_head',    'label', 'Winter feed',       'base', 612, 'factor', 1.034, 'current', 633, 'escalated', true),
     jsonb_build_object('key', 'pasture_cost_per_head', 'label', 'Pasture',           'base', 138, 'factor', null,  'current', 138, 'escalated', false),
     jsonb_build_object('key', 'vet_cost_per_head',     'label', 'Vet and medicine',  'base', 34,  'factor', 1.021, 'current', 35,  'escalated', true),
     jsonb_build_object('key', 'other_cost_per_head',   'label', 'Everything else',   'base', 563, 'factor', 1.012, 'current', 570, 'escalated', true)
   ),
   1840, now() - interval '24 days');

-- ── Inputs inventory (Inventory → Inputs) ──────────────────────────────────
-- What is in the shed and the tanks: bought from Prairie Ag Supply, used on
-- fields this season, and one count adjustment. On hand is the view over these.
insert into public.input_items (name, category, unit, unit_cost, supplier_contact_id, notes, active, chemical_id) values
  ('Hybrid canola seed (example)', 'seed', 'bag', 640, '0de30000-0000-4000-8000-000000000301', '50 lb bags, 10 ac each. Order next year''s by December for the early discount.', true, null),
  ('Certified wheat seed (example)', 'seed', 'bu', 16.50, '0de30000-0000-4000-8000-000000000301', 'Cleaned and treated.', true, null),
  ('Yellow pea seed (example)', 'seed', 'bu', 14.00, '0de30000-0000-4000-8000-000000000301', null, true, null),
  ('46-0-0 urea', 'fert', 'tonne', 905, '0de30000-0000-4000-8000-000000000301', 'Kept in the yard fertilizer bin.', true, null),
  ('11-52-0 MAP', 'fert', 'tonne', 1080, '0de30000-0000-4000-8000-000000000301', null, true, null),
  ('21-0-0-24 AMS', 'fert', 'tonne', 640, '0de30000-0000-4000-8000-000000000301', 'Canola only.', true, null),
  ('Glyphosate 540', 'chem', 'L', 6.20, '0de30000-0000-4000-8000-000000000301', 'Two 450 L totes in the chem shed.', true,
     (select id from public.chemicals where registration_number = 'DEMO-1001' limit 1)),
  ('Florasulam + MCPA', 'chem', 'L', 24.00, '0de30000-0000-4000-8000-000000000301', null, true,
     (select id from public.chemicals where registration_number = 'DEMO-1004' limit 1)),
  ('MCPA Ester 600', 'chem', 'L', 9.80, '0de30000-0000-4000-8000-000000000301', 'Also used for thistle spot-spraying on pasture.', true,
     (select id from public.chemicals where registration_number = 'DEMO-1007' limit 1)),
  ('Prothioconazole + Fluopyram', 'chem', 'L', 118.00, '0de30000-0000-4000-8000-000000000301', 'Keep from freezing — moved to the heated shop for winter.', true,
     (select id from public.chemicals where registration_number = 'DEMO-1008' limit 1)),
  ('Marked diesel', 'fuel', 'L', 1.18, null, 'Yard tank, 4,500 L.', true, null),
  ('Mineral tubs (example)', 'other', 'tub', 92, '0de30000-0000-4000-8000-000000000301', 'For the cows at Willow Ridge.', true, null);

insert into public.input_movements (input_item_id, movement_type, quantity, unit_cost, moved_at, crop_id, field_id, crop_year, po_number, notes, created_by)
select i.id, v.mtype::public.input_movement_type, v.qty, v.cost, current_date - v.ago,
       (select id from public.crops where name = v.crop), v.field::uuid,
       case when v.mtype = 'use' then extract(year from current_date)::int end,
       v.po, v.note, v.who::uuid
from (values
  -- Seed bought in winter, seeded in May.
  ('Hybrid canola seed (example)', 'purchase', 62,   640,   230, null,     null, 'PO-1182', 'Early-order discount taken.', '0de30000-0000-4000-8000-0000000000a1'),
  ('Hybrid canola seed (example)', 'use',      30,   null,  165, 'Canola', '0de30000-0000-4000-8000-000000000110', null, 'Correction Line.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Hybrid canola seed (example)', 'use',      28,   null,  163, 'Canola', '0de30000-0000-4000-8000-000000000115', null, 'Creek Flat.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Certified wheat seed (example)', 'purchase', 900,  16.50, 210, null,     null, 'PO-1190', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('Certified wheat seed (example)', 'use',      560,  null,  172, 'Wheat',  '0de30000-0000-4000-8000-000000000102', null, 'East Home, 1.8 bu/ac.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Certified wheat seed (example)', 'use',      290,  null,  170, 'Wheat',  '0de30000-0000-4000-8000-000000000107', null, null, '0de30000-0000-4000-8000-0000000000a2'),
  ('Yellow pea seed (example)', 'purchase', 520, 14.00, 205, null, null, 'PO-1191', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('Yellow pea seed (example)', 'use',      505, null,  176, 'Peas', '0de30000-0000-4000-8000-000000000108', null, 'Hilltop, 3.2 bu/ac.', '0de30000-0000-4000-8000-0000000000a2'),
  -- Fertilizer: spring fill, and fall urea already in the bin.
  ('46-0-0 urea', 'purchase', 48, 935, 190, null, null, 'PO-1201', 'Spring fill.', '0de30000-0000-4000-8000-0000000000a1'),
  ('46-0-0 urea', 'use',      44, null, 168, 'Wheat', '0de30000-0000-4000-8000-000000000102', null, 'Side-banded at seeding.', '0de30000-0000-4000-8000-0000000000a2'),
  ('46-0-0 urea', 'purchase', 36, 905, 12,  null, null, 'PO-1263', 'Fall prepay, for the West Half next spring.', '0de30000-0000-4000-8000-0000000000a1'),
  ('11-52-0 MAP', 'purchase', 14, 1080, 190, null, null, 'PO-1201', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('11-52-0 MAP', 'use',      12.5, null, 166, 'Canola', '0de30000-0000-4000-8000-000000000110', null, 'Seed-placed.', '0de30000-0000-4000-8000-0000000000a2'),
  ('21-0-0-24 AMS', 'purchase', 8, 640, 190, null, null, 'PO-1201', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('21-0-0-24 AMS', 'use',      7.2, null, 165, 'Canola', '0de30000-0000-4000-8000-000000000110', null, null, '0de30000-0000-4000-8000-0000000000a2'),
  -- Chemical.
  ('Glyphosate 540', 'purchase', 900, 6.20, 200, null, null, 'PO-1205', 'Two totes.', '0de30000-0000-4000-8000-0000000000a1'),
  ('Glyphosate 540', 'use',      310, null, 172, null, '0de30000-0000-4000-8000-000000000107', null, 'Pre-seed burnoff.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Glyphosate 540', 'use',      260, null, 60,  'Wheat', '0de30000-0000-4000-8000-000000000102', null, 'Pre-harvest.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Florasulam + MCPA', 'purchase', 240, 24.00, 150, null, null, 'PO-1222', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('Florasulam + MCPA', 'use',      150, null, 140, 'Wheat', '0de30000-0000-4000-8000-000000000102', null, null, '0de30000-0000-4000-8000-0000000000a2'),
  ('Florasulam + MCPA', 'use',      78,  null, 138, 'Wheat', '0de30000-0000-4000-8000-000000000107', null, null, '0de30000-0000-4000-8000-0000000000a2'),
  ('MCPA Ester 600', 'purchase', 40, 9.80, 120, null, null, 'PO-1230', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('MCPA Ester 600', 'use',      12, null, 3,   null, null, null, 'Thistle patches on the Hay Flat aftermath.', '0de30000-0000-4000-8000-0000000000a3'),
  ('Prothioconazole + Fluopyram', 'purchase', 90, 118.00, 110, null, null, 'PO-1236', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('Prothioconazole + Fluopyram', 'use',      60, null, 100, 'Canola', '0de30000-0000-4000-8000-000000000110', null, '20–30% bloom.', '0de30000-0000-4000-8000-0000000000a2'),
  ('Prothioconazole + Fluopyram', 'adjustment', -2, null, 20, null, null, null, 'Shed count: one jug short.', '0de30000-0000-4000-8000-0000000000a3'),
  -- Fuel and cattle supplies.
  ('Marked diesel', 'purchase', 4200, 1.21, 75, null, null, null, 'Yard tank fill.', '0de30000-0000-4000-8000-0000000000a1'),
  ('Marked diesel', 'use',      3550, null, 30, null, null, null, 'Harvest so far.', '0de30000-0000-4000-8000-0000000000a1'),
  ('Marked diesel', 'purchase', 3800, 1.18, 9,  null, null, null, 'Yard tank fill.', '0de30000-0000-4000-8000-0000000000a1'),
  ('Mineral tubs (example)', 'purchase', 24, 92, 140, null, null, 'PO-1225', null, '0de30000-0000-4000-8000-0000000000a1'),
  ('Mineral tubs (example)', 'use',      18, null, 45, null, null, null, 'Willow Ridge, summer.', '0de30000-0000-4000-8000-0000000000a3')
) as v(item, mtype, qty, cost, ago, crop, field, po, note, who)
join public.input_items i on i.name = v.item;

-- ── Price watches (Markets) ────────────────────────────────────────────────
-- Two armed and waiting, one that fired last week and waits to re-arm.
insert into public.market_alerts (series_id, created_by, direction, threshold, label, active, last_fired_at, last_fired_value, armed, created_at) values
  ('0de30000-0000-4000-8000-000000000571', (select id from public.users order by created_at limit 1), 'above', 680, 'Canola over $680 — sell the next 5,000 bu', true, null, null, true, now() - interval '40 days'),
  ('0de30000-0000-4000-8000-000000000573', (select id from public.users order by created_at limit 1), 'below', 240, 'Feed barley under $240 — buy for the cows instead of selling ours', true, null, null, true, now() - interval '60 days'),
  ('0de30000-0000-4000-8000-000000000572', '0de30000-0000-4000-8000-0000000000a1', 'above', 300, 'Wheat over $300', true, now() - interval '6 days', 302.40, false, now() - interval '75 days'),
  ((select id from public.market_series where code = 'ab.feeder.steers.500-600.calgary'), (select id from public.users order by created_at limit 1),
   'above', 575, '5-weight steers over $575/cwt — think about selling calves early', true, null, null, true, now() - interval '20 days');

-- ── Monthly jobs: this year's copies already ticked off (Monthly) ──────────
-- The public copy is mid-change: older schemas key a copy by crop year, newer
-- ones by year and month with a state. Fill whichever this schema has.
do $$
declare
  v_year int := extract(year from current_date)::int;
  v_now int := extract(month from current_date)::int;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'monthly_task_instances' and column_name = 'state') then
    execute $q$
      insert into public.monthly_task_instances (template_id, crop_year, year, month, state, skip_note, completed_by, completed_at)
      select t.id, $1, $1, v.m, v.state, v.note, v.who::uuid,
             make_timestamptz($1, v.m, least(v.day, 28), 15, 0, 0, 'America/Edmonton')
        from (values
          ('Book fall fertilizer and lock in prepay', 8, 'done', null, '0de30000-0000-4000-8000-0000000000a1', 22),
          ('Calving barn ready', 2, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 20),
          ('Sprayer start-up and calibration', 4, 'done', null, '0de30000-0000-4000-8000-0000000000a2', 25),
          ('Brand and vaccinate calves', 6, 'done', null, '0de30000-0000-4000-8000-0000000000a1', 14),
          ('Check stored grain temperatures', 1, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 28),
          ('Check stored grain temperatures', 2, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 26),
          ('Check stored grain temperatures', 3, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 27),
          ('Check stored grain temperatures', 4, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 24),
          ('Check stored grain temperatures', 5, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 22),
          ('Check stored grain temperatures', 6, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 26),
          ('Check stored grain temperatures', 7, 'skipped', 'Bins empty until harvest.', '0de30000-0000-4000-8000-0000000000a3', 2),
          ('Check stored grain temperatures', 8, 'skipped', 'Bins empty until harvest.', '0de30000-0000-4000-8000-0000000000a3', 2),
          ('Check stored grain temperatures', 9, 'done', null, '0de30000-0000-4000-8000-0000000000a3', 28)
        ) as v(title, m, state, note, who, day)
        join public.monthly_task_templates t on t.title = v.title
       where v.m < $2
    $q$ using v_year, v_now;
  else
    execute $q$
      insert into public.monthly_task_instances (template_id, crop_year, completed, completed_by, completed_at)
      select t.id, $1, true, v.who::uuid, make_timestamptz($1, v.m, v.day, 15, 0, 0, 'America/Edmonton')
        from (values
          ('Book fall fertilizer and lock in prepay', 8, '0de30000-0000-4000-8000-0000000000a1', 22),
          ('Calving barn ready', 2, '0de30000-0000-4000-8000-0000000000a3', 20),
          ('Sprayer start-up and calibration', 4, '0de30000-0000-4000-8000-0000000000a2', 25),
          ('Brand and vaccinate calves', 6, '0de30000-0000-4000-8000-0000000000a1', 14)
        ) as v(title, m, who, day)
        join public.monthly_task_templates t on t.title = v.title
       where v.m < $2
    $q$ using v_year, v_now;
  end if;
end $$;

-- ── Notification timing (Settings → Notifications) ─────────────────────────
-- The owner has quiet hours on and gets the morning digest a little early.
insert into public.notification_settings (user_id, quiet_on, quiet_start, quiet_end, digest_at) values
  ((select id from public.users order by created_at limit 1), true, '21:30', '06:00', '06:30'),
  ('0de30000-0000-4000-8000-0000000000a1', true, '22:00', '05:30', '07:00');

-- ── Pasture sprays and their no-grazing days (Cattle → Grazing) ────────────
-- MCPA (example label: 7 days off grass) — the Hay Flat spot-spray three days
-- ago still keeps the cows off it this week.
insert into public.pasture_sprays (pasture_id, applied_on, product, registration_number, notes, created_by) values
  ('0de30000-0000-4000-8000-000000000415', current_date - 128, 'MCPA Ester 600', 'DEMO-1007', 'Thistle and dandelion, whole pasture, 0.5 L/ac.', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000412', current_date - 112, 'MCPA Ester 600', 'DEMO-1007', 'Canada thistle patches along the creek, spot-sprayed by quad — kept 10 m off the water.', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000414', current_date - 400, 'Glyphosate 540', 'DEMO-1001', 'Spot-treated a leafy spurge patch by the bush gate.', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000417', current_date - 3, 'MCPA Ester 600', 'DEMO-1007', 'Thistle patches on the aftermath before the cows go in.', '0de30000-0000-4000-8000-0000000000a3');

-- ── Water points on the pastures (grazing map pins) ────────────────────────
-- Each pasture's water is the cattle water already mapped inside it or
-- marked as serving it.
update public.pastures p set water_source_geom = w.geom
  from (
    select p2.id, st_multi(st_collect(cw.geom))::geometry(MultiPoint, 4326) as geom
      from public.pastures p2
      join public.cattle_water cw
        on cw.geom is not null
       and (p2.id = any(cw.serves) or st_intersects(cw.geom, p2.boundary))
     group by p2.id
  ) w
 where w.id = p.id;

-- ── Corn stubble rented for winter grazing (Cattle → Feed) ─────────────────
-- A neighbour's grain corn stubble; the cows go on after the calves are sold.
insert into public.stubble_grazing (ranch_id, field_id, name, acres, yield_bu, herd_count_id, start_date, weather_loss_pct, ears_counted, snow_state, notes) values
  ('0de30000-0000-4000-8000-000000000401', null, 'Okonkwo corn stubble (rented, example)', 120, 135, '0de30000-0000-4000-8000-000000000421',
   current_date + 18, 15, 9, 'open', 'Rented by the acre. Electric fence across the south end; water hauled to the tank.'),
  ('0de30000-0000-4000-8000-000000000401', null, 'Beaulieu corn stubble, east 40 (example)', 40, 120, '0de30000-0000-4000-8000-000000000423',
   current_date + 45, 20, null, 'open', 'Bred heifers after the main stubble. Count ears before they go on.');
