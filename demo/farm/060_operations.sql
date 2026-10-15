-- Running the farm: equipment, service, fuel, tasks, calendar, checklists,
-- monthly jobs, notifications, the weekly meeting.
-- Ids: equipment 08NN, legacy equipment 085N, tasks 06NN, checklist templates 07NN.

-- The fleet (the Equipment pages read jd_equipment; is_manual = typed in, not synced).
insert into public.jd_equipment (id, jd_id, name, category, make, model, equipment_type, serial_number, vin, engine_hours, engine_hours_at, archived, is_manual, notes,
                                 warranty_provider, warranty_starts_on, warranty_expires_on, warranty_hours, warranty_note, created_at)
values
  ('0de30000-0000-4000-8000-000000000801', 'demo-eq-01', '8R 370 tractor', 'machine', 'John Deere', '8R 370', 'Tractor', '1RW8370RXMD012345', null, 3420, now() - interval '2 days', false, true,
   'Main drill tractor. Duals on for seeding, off for the grain cart.', 'Valley Equipment Ltd.', current_date - 1300, current_date - 200, 3000, 'Base warranty ended; PowerGard extension not bought.', now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000802', 'demo-eq-02', '7230R loader tractor', 'machine', 'John Deere', '7230R', 'Tractor', '1RW7230RCJD054321', null, 6855, now() - interval '1 day', false, true,
   'Loader tractor: bale feeding, snow, the auger.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000803', 'demo-eq-03', 'S780 combine', 'machine', 'John Deere', 'S780', 'Combine', '1H0S780SCL0765432', null, 2148, now() - interval '1 day', false, true,
   'Separator hours about 1,560. Concaves changed two seasons ago.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000804', 'demo-eq-04', 'R4045 sprayer', 'machine', 'John Deere', 'R4045', 'Sprayer', '1N04045RVPN098765', null, 1012, now() - interval '3 days', false, true,
   '120 ft boom, ExactApply. Rinse tank after every Group 2 product.', 'Valley Equipment Ltd.', current_date - 520, current_date + 210, 3000, 'Three years or 3,000 hours, whichever comes first.', now() - interval '2 years'),
  ('0de30000-0000-4000-8000-000000000805', 'demo-eq-05', 'M1170 windrower', 'machine', 'MacDon', 'M1170', 'Windrower', 'MD1170-22-03311', null, 1255, now() - interval '20 days', false, true,
   'Hay and swathed canola. 35 ft draper header.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000806', 'demo-eq-06', 'Kenworth T800 semi', 'machine', 'Kenworth', 'T800', 'Truck', null, '1XKDD49X5KJ456789', 9840, now() - interval '3 days', false, true,
   'Pulls the Doepker tridem grain trailer. CVIP due in spring.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000807', 'demo-eq-07', 'Truck 2 (IH tandem)', 'machine', 'International', '4900', 'Truck', null, '1HTSHAAR1WH567890', 11230, now() - interval '5 days', false, true,
   'Old faithful. 20 ft box with a roll tarp.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000808', 'demo-eq-08', 'Truck 3 (Freightliner tandem)', 'machine', 'Freightliner', 'M2 106', 'Truck', null, '1FVHG3DV7EHF67890', 7410, now() - interval '5 days', false, true,
   null, null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000809', 'demo-eq-09', 'Bourgault 3320 drill', 'implement', 'Bourgault', '3320 PHD', 'Air drill', 'B3320-60-11842', null, null, null, false, true,
   '60 ft, 10 in spacing. Mid-row banders for nitrogen.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000810', 'demo-eq-10', 'Bourgault 7950 air cart', 'implement', 'Bourgault', '7950', 'Air cart', 'B7950-15523', null, null, null, false, true,
   'Four tanks; tank 4 is the inoculant tank for peas.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000811', 'demo-eq-11', 'FD145 draper header', 'implement', 'MacDon', 'FD145', 'Header', 'FD145-19-22871', null, null, null, false, true,
   '45 ft flex draper for straight-cut canola and peas.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000812', 'demo-eq-12', 'Grain cart', 'implement', 'Brent', '1196', 'Grain cart', 'BR1196-08812', null, null, null, false, true,
   '1,100 bu. Scale on the cart is within 1% of the elevator.', null, null, null, null, null, now() - interval '3 years'),
  ('0de30000-0000-4000-8000-000000000813', 'demo-eq-13', 'StarFire 7500 receiver', 'technology', 'John Deere', 'StarFire 7500', 'GPS receiver', 'PCGT75A123456', null, null, null, false, true,
   'SF3 correction. Moves between the 8R and the sprayer.', null, null, null, null, null, now() - interval '2 years'),
  ('0de30000-0000-4000-8000-000000000814', 'demo-eq-14', 'Ranch pickup', 'other', 'Ford', 'F-350', 'Pickup', null, '1FT8W3BT1NEC12345', null, null, false, true,
   'Bale deck. 186,000 km.', null, null, null, null, null, now() - interval '3 years');

insert into public.equipment_service_plans (id, equipment_id, name, interval_hours, interval_months, last_done_hours, last_done_on, warn_within_hours, notes, active) values
  ('0de30000-0000-4000-8000-000000000821', '0de30000-0000-4000-8000-000000000801', 'Engine oil and filter', 500, 12, 3010, current_date - 160, 50, '15W-40, 26 L.', true),
  ('0de30000-0000-4000-8000-000000000822', '0de30000-0000-4000-8000-000000000801', 'Hydraulic and transmission filters', 1500, null, 2250, current_date - 420, 100, null, true),
  ('0de30000-0000-4000-8000-000000000823', '0de30000-0000-4000-8000-000000000803', 'Engine oil and filter', 250, 12, 1880, current_date - 70, 25, 'Due every 250 h in harvest.', true),
  ('0de30000-0000-4000-8000-000000000824', '0de30000-0000-4000-8000-000000000803', 'Pre-harvest inspection', null, 12, null, current_date - 72, 0, 'Dealer inspection: belts, chains, rotor, chopper knives.', true),
  ('0de30000-0000-4000-8000-000000000825', '0de30000-0000-4000-8000-000000000804', 'Engine oil and filter', 500, 12, 640, current_date - 140, 50, null, true),
  ('0de30000-0000-4000-8000-000000000826', '0de30000-0000-4000-8000-000000000804', 'Nozzle check and calibration', null, 12, null, current_date - 150, 0, 'Catch test every nozzle body each spring.', true),
  ('0de30000-0000-4000-8000-000000000827', '0de30000-0000-4000-8000-000000000802', 'Engine oil and filter', 500, 12, 6420, current_date - 250, 50, null, true),
  ('0de30000-0000-4000-8000-000000000828', '0de30000-0000-4000-8000-000000000806', 'Oil change', 400, 6, 9520, current_date - 120, 40, null, true),
  ('0de30000-0000-4000-8000-000000000829', '0de30000-0000-4000-8000-000000000806', 'CVIP inspection', null, 12, null, current_date - 300, 0, 'Commercial vehicle inspection.', true),
  ('0de30000-0000-4000-8000-000000000830', '0de30000-0000-4000-8000-000000000805', 'Engine oil and filter', 250, 12, 1010, current_date - 110, 25, null, true);

insert into public.equipment_service_log (equipment_id, plan_id, done_on, engine_hours, notes, cost, done_by) values
  ('0de30000-0000-4000-8000-000000000801', '0de30000-0000-4000-8000-000000000821', current_date - 160, 3010, 'Oil, filter, fuel filters.', 412.50, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000803', '0de30000-0000-4000-8000-000000000824', current_date - 72, 1878, 'Dealer pre-harvest inspection. Replaced feeder chain and two rotor belts.', 6840.00, '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000803', '0de30000-0000-4000-8000-000000000823', current_date - 70, 1880, 'Oil and filter before harvest.', 389.00, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000804', '0de30000-0000-4000-8000-000000000826', current_date - 150, 600, 'Replaced 14 worn tips on the right wing.', 520.00, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000804', '0de30000-0000-4000-8000-000000000825', current_date - 140, 640, null, 298.00, '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000806', '0de30000-0000-4000-8000-000000000828', current_date - 120, 9520, 'Oil change and greased the fifth wheel.', 465.00, '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000805', '0de30000-0000-4000-8000-000000000830', current_date - 110, 1010, 'Before first-cut hay.', 255.00, '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000802', null, current_date - 35, 6790, 'New loader hose on the grapple circuit.', 186.40, '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000803', null, current_date, 2148, 'Blew down the combine; checked chopper knives.', null, '0de30000-0000-4000-8000-0000000000a2');

insert into public.jd_equipment_alerts (jd_id, equipment_jd_id, occurred_at, severity, color, description, code, engine_hours, acknowledged, ignored) values
  ('demo-alert-1', 'demo-eq-03', now() - interval '2 days', 'MEDIUM', 'YELLOW', 'Engine oil change due within 25 hours', 'SVC-OIL', 2146, false, false),
  ('demo-alert-2', 'demo-eq-04', now() - interval '25 days', 'LOW', 'YELLOW', 'Boom section 7 valve slow to respond', 'BSV-07', 1004, true, false);

-- Legacy equipment list (checklists hang off it).
insert into public.equipment (id, name, type, make, model, year, serial, notes_md, active) values
  ('0de30000-0000-4000-8000-000000000851', 'S780 combine', 'Combine', 'John Deere', 'S780', extract(year from current_date)::int - 6, '1H0S780SCL0765432', null, true),
  ('0de30000-0000-4000-8000-000000000852', 'R4045 sprayer', 'Sprayer', 'John Deere', 'R4045', extract(year from current_date)::int - 3, '1N04045RVPN098765', null, true),
  ('0de30000-0000-4000-8000-000000000853', 'Creek pivots', 'Pivot', 'Valley / Zimmatic', null, null, null, 'The three pivots on the creek pump station.', true);

-- Fuel: bulk deliveries to the yard tanks over two years.
insert into public.fuel_purchases (supplier, invoice_no, invoice_date, product, description, litres, price_per_l, amount, checked, source, created_by)
select 'Lakeland Fuel Co-op', 'LF-' || (40100 + g), current_date - g * 17 - 2,
       'farm_diesel', 'Marked diesel, bulk delivery',
       l.litres, l.price, round(l.litres * l.price, 2), true, 'invoice', '0de30000-0000-4000-8000-0000000000a1'
from generate_series(0, 42) g
cross join lateral (
  select (case when extract(month from current_date - g * 17) in (4, 5, 8, 9, 10) then 8200 else 4100 end
          + (abs(hashtext('d' || g)) % 9) * 100)::numeric as litres,
         round((1.18 + 0.12 * sin(g / 5.0) + ((abs(hashtext('p' || g)) % 7) - 3) / 100.0)::numeric, 3) as price
) l;

insert into public.fuel_purchases (supplier, invoice_no, invoice_date, product, description, litres, price_per_l, amount, checked, source, created_by)
select 'Lakeland Fuel Co-op', 'LF-G' || (2200 + g), current_date - g * 30 - 5, 'gasoline', 'Regular gasoline, bulk',
       (520 + (abs(hashtext('g' || g)) % 5) * 40)::numeric, round((1.38 + 0.1 * sin(g / 3.0))::numeric, 3),
       round((520 + (abs(hashtext('g' || g)) % 5) * 40) * round((1.38 + 0.1 * sin(g / 3.0))::numeric, 3), 2), true, 'invoice', '0de30000-0000-4000-8000-0000000000a1'
from generate_series(0, 23) g;

-- Tasks.
insert into public.tasks (id, title, description_md, field_id, created_by, due_at, status, completed_at, completed_by, parent_task_id, source, equipment_id, created_at)
select v.id::uuid, v.title, v.descr, v.field::uuid, coalesce(v.creator, (select id::text from public.users order by created_at limit 1))::uuid,
       case when v.due is null then null else ((current_date + v.due)::timestamp + time '17:00') at time zone 'America/Edmonton' end,
       v.status::public.task_status,
       case when v.status = 'done' then ((current_date - v.done)::timestamp + time '16:30') at time zone 'America/Edmonton' end,
       case when v.status = 'done' then v.doneby::uuid end,
       v.parent::uuid, 'manual', v.eq::uuid,
       now() - make_interval(days => coalesce(v.done, 0) + 6)
from (values
  ('0de30000-0000-4000-8000-000000000601', 'Finish combining Correction Line canola', 'About half done. Bins #1 and #2. Watch the moisture in the mornings.', '0de30000-0000-4000-8000-000000000110', null, 2, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000602', 'Straight-cut Creek Flat canola once the pods are dry', 'Sample on the creek side first; it was 12.9% last test. Goes to bin #19.', '0de30000-0000-4000-8000-000000000115', null, 6, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000603', 'Book preg checking with Ridgeview Vet', 'Both herds, last week of October. Need the chute and the alley panels set up.', null, null, 4, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000604', 'Winterize the creek pump station', 'Before the first hard frost. See the pivot winterizing checklist too.', '0de30000-0000-4000-8000-000000000113', null, 12, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000605', 'Drain the pump column and pull the intake screens', null, null, null, 11, 'open', null, null, '0de30000-0000-4000-8000-000000000604', null),
  ('0de30000-0000-4000-8000-000000000606', 'Shut off and lock out the pump panel', null, null, null, 12, 'open', null, null, '0de30000-0000-4000-8000-000000000604', null),
  ('0de30000-0000-4000-8000-000000000607', 'Haul four more loads of canola to Creekside', 'Contract CGT-24518 — 7,800 bu still to go. From bin #6 then #7.', null, null, 10, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000608', 'Fall soil sampling on next year''s canola fields', 'Railway Quarter, West Half, Sandhill. Riley is pulling the cores; mark the field entrances for him.', null, null, 14, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000609', 'Fall anhydrous on West Half', 'Pea stubble going to canola. Rate from the soil test once it is back.', '0de30000-0000-4000-8000-000000000107', null, 21, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000610', 'Order winter mineral and salt', 'Western Feed & Mineral — 12 bags breeder mineral a month from November.', null, null, 16, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000611', 'Wean and vaccinate calves', 'Both herds. Pre-condition shots; keep the 30 heifer calves with yellow tags.', null, null, 21, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000612', 'Change oil in the combine', 'Oil change is due — the combine flagged it two days ago.', null, null, -2, 'open', null, null, null, '0de30000-0000-4000-8000-000000000803'),
  ('0de30000-0000-4000-8000-000000000613', 'Fix the west gate at Willow Ridge', 'Hinge pin sheared. Cows got into the Bush Quarter on Sunday.', null, null, -1, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000614', 'Run the fan on bin #1 overnight', 'Canola came in at 10.8%. Fan until it reads under 10.', null, null, 0, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000615', 'Renew the Miller Half lease', 'Five-year lease ends this fall. Evelyn is happy to renew at the same rent.', '0de30000-0000-4000-8000-000000000111', null, 25, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000616', 'Clean out the seed shed', null, null, null, null, 'open', null, null, null, null),
  ('0de30000-0000-4000-8000-000000000621', 'Desiccate the peas on West Half', 'Reglone, 1.1 L/ac in 20 gal water.', '0de30000-0000-4000-8000-000000000107', '0de30000-0000-4000-8000-0000000000a1', -64, 'done', 63, '0de30000-0000-4000-8000-0000000000a2', null, null),
  ('0de30000-0000-4000-8000-000000000622', 'Cut and bale second-cut hay on Hay Flat', null, '0de30000-0000-4000-8000-000000000104', null, -55, 'done', 52, '0de30000-0000-4000-8000-0000000000a3', null, null),
  ('0de30000-0000-4000-8000-000000000623', 'Book the combine pre-harvest inspection', null, null, null, -75, 'done', 73, '0de30000-0000-4000-8000-0000000000a1', null, '0de30000-0000-4000-8000-000000000803'),
  ('0de30000-0000-4000-8000-000000000624', 'Pre-harvest glyphosate on Miller Half', 'Wheat at 30% kernel moisture.', '0de30000-0000-4000-8000-000000000111', '0de30000-0000-4000-8000-0000000000a1', -35, 'done', 33, '0de30000-0000-4000-8000-0000000000a2', null, null),
  ('0de30000-0000-4000-8000-000000000625', 'Move the Willow Ridge pairs to South Paddock', null, null, '0de30000-0000-4000-8000-0000000000a1', -18, 'done', 18, '0de30000-0000-4000-8000-0000000000a3', null, null),
  ('0de30000-0000-4000-8000-000000000626', 'Fix the aeration fan on bin #9', 'Seized bearing; replaced the motor.', null, null, -42, 'done', 41, '0de30000-0000-4000-8000-0000000000a1', null, null),
  ('0de30000-0000-4000-8000-000000000627', 'Send the Q3 GST return', null, null, null, -6, 'done', 7, null, null, null),
  ('0de30000-0000-4000-8000-000000000628', 'Blow down the combine and check the chopper knives', null, null, '0de30000-0000-4000-8000-0000000000a1', 0, 'done', 0, '0de30000-0000-4000-8000-0000000000a2', null, '0de30000-0000-4000-8000-000000000803')
) as v(id, title, descr, field, creator, due, status, done, doneby, parent, eq);

update public.tasks set completed_by = (select id from public.users order by created_at limit 1)
 where id = '0de30000-0000-4000-8000-000000000627';

insert into public.task_assignees (task_id, user_id, assigned_by, assigned_at)
select t.task::uuid, case when t.who = 'OWNER' then (select id from public.users order by created_at limit 1) else t.who::uuid end,
       (select id from public.users order by created_at limit 1), now() - interval '5 days'
from (values
  ('0de30000-0000-4000-8000-000000000601', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000602', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000603', 'OWNER'),
  ('0de30000-0000-4000-8000-000000000604', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000604', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000605', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000606', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000607', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000608', 'OWNER'),
  ('0de30000-0000-4000-8000-000000000609', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000610', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000611', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000611', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000611', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000612', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000613', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000614', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000615', 'OWNER'),
  ('0de30000-0000-4000-8000-000000000621', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000622', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000623', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000624', '0de30000-0000-4000-8000-0000000000a2'),
  ('0de30000-0000-4000-8000-000000000625', '0de30000-0000-4000-8000-0000000000a3'),
  ('0de30000-0000-4000-8000-000000000626', '0de30000-0000-4000-8000-0000000000a1'),
  ('0de30000-0000-4000-8000-000000000628', '0de30000-0000-4000-8000-0000000000a2')
) as t(task, who);

-- Calendar.
insert into public.calendar_events (title, kind, field_id, user_ids, starts_at, ends_at, all_day, rrule, notes_md, source, created_by)
select v.title, v.kind::public.event_kind, v.field::uuid, v.users,
       ((v.d)::timestamp + v.t1::time) at time zone 'America/Edmonton',
       case when v.t2 is null then null else ((v.d)::timestamp + v.t2::time) at time zone 'America/Edmonton' end,
       v.allday, v.rrule, v.notes, 'manual', (select id from public.users order by created_at limit 1)
from (values
  ('Monday farm meeting', 'meeting', null, array['0de30000-0000-4000-8000-0000000000a1','0de30000-0000-4000-8000-0000000000a2','0de30000-0000-4000-8000-0000000000a3']::uuid[],
   date_trunc('week', current_date)::date - 56, '07:30', '08:15', false, 'FREQ=WEEKLY', 'In the shop. Tasks, the week''s weather, who is where.'),
  ('Bin walk: temperatures and fans', 'maintenance', null, array['0de30000-0000-4000-8000-0000000000a3']::uuid[],
   date_trunc('week', current_date)::date - 52, '16:00', '17:00', false, 'FREQ=WEEKLY', 'Read the cables on #6 and #14; spot-check the hoppers.'),
  ('Fall fertilizer delivery — anhydrous tanks', 'delivery', '0de30000-0000-4000-8000-000000000107', '{}'::uuid[],
   current_date + 9, '08:00', '12:00', false, null, 'Prairie Ag Supply drops two 3,000-gal nurse tanks at the West Half approach.'),
  ('Canola delivery window — Creekside', 'delivery', null, array['0de30000-0000-4000-8000-0000000000a2']::uuid[],
   current_date + 10, '07:00', '15:00', false, null, 'Four loads booked on CGT-24518.'),
  ('Pivot service — Precision Pivot', 'maintenance', '0de30000-0000-4000-8000-000000000113', array['0de30000-0000-4000-8000-0000000000a1']::uuid[],
   current_date + 12, '09:00', '15:00', false, null, 'Winterize the pump station and check the gearboxes on all three pivots.'),
  ('Agronomy review with Riley', 'meeting', null, array['0de30000-0000-4000-8000-0000000000a1']::uuid[],
   current_date + 16, '13:00', '15:00', false, null, 'Soil tests back, next year''s rotation and the fertilizer plan.'),
  ('Preg check — Ridgeview Vet', 'general', null, array['0de30000-0000-4000-8000-0000000000a1','0de30000-0000-4000-8000-0000000000a3']::uuid[],
   current_date + 19, '08:00', '16:00', false, null, 'Home herd in the morning, Willow Ridge cows hauled home the day before.'),
  ('Calf sale — County Line Auction Mart', 'delivery', null, '{}'::uuid[],
   current_date + 38, '09:00', null, true, null, 'Steers and the heifers we are not keeping. Book the liner.'),
  ('Miller Half rent due', 'general', '0de30000-0000-4000-8000-000000000111', '{}'::uuid[],
   current_date + 25, '09:00', null, true, 'FREQ=YEARLY', 'Cash rent to Evelyn Miller.'),
  ('Harvest started', 'field_work', '0de30000-0000-4000-8000-000000000107', '{}'::uuid[],
   current_date - 58, '13:00', null, true, null, 'Peas on West Half.'),
  ('Crop tour with the agronomist', 'field_work', null, array['0de30000-0000-4000-8000-0000000000a1']::uuid[],
   current_date - 85, '09:00', '14:00', false, null, 'All the pivots and the canola.')
) as v(title, kind, field, users, d, t1, t2, allday, rrule, notes);

-- Checklists.
insert into public.checklist_templates (id, name, category, equipment_id, description_md, active, map_based, yearly) values
  ('0de30000-0000-4000-8000-000000000701', 'Combine daily walk-around', 'equipment', '0de30000-0000-4000-8000-000000000851', 'Every morning before the combine leaves the yard.', true, false, false),
  ('0de30000-0000-4000-8000-000000000702', 'Pivot winterizing', 'irrigation', '0de30000-0000-4000-8000-000000000853', 'Every fall before freeze-up, all three pivots and the pump station.', true, false, true),
  ('0de30000-0000-4000-8000-000000000703', 'Sprayer spring start-up', 'equipment', '0de30000-0000-4000-8000-000000000852', null, true, false, false),
  ('0de30000-0000-4000-8000-000000000704', 'Calving barn ready', 'cattle', null, 'By the end of February.', true, false, true);

insert into public.checklist_template_items (template_id, sort_order, text, help_md, requires_note)
select v.t::uuid, v.n, v.txt, v.help, v.note
from (values
  ('0de30000-0000-4000-8000-000000000701', 1, 'Engine oil and coolant levels', null, false),
  ('0de30000-0000-4000-8000-000000000701', 2, 'Blow off the engine compartment and radiator screens', null, false),
  ('0de30000-0000-4000-8000-000000000701', 3, 'Grease the daily points (feeder house, header drive)', null, false),
  ('0de30000-0000-4000-8000-000000000701', 4, 'Check chopper knives and spreader paddles', null, false),
  ('0de30000-0000-4000-8000-000000000701', 5, 'Fire extinguishers charged', null, false),
  ('0de30000-0000-4000-8000-000000000701', 6, 'Engine hours', 'Write the hour meter reading.', true),
  ('0de30000-0000-4000-8000-000000000702', 1, 'Drain all pivot spans and open the end drains', null, false),
  ('0de30000-0000-4000-8000-000000000702', 2, 'Park each pivot downhill with the wheels tracked out', null, false),
  ('0de30000-0000-4000-8000-000000000702', 3, 'Drain the pump column and check valve', null, false),
  ('0de30000-0000-4000-8000-000000000702', 4, 'Pull and clean the creek intake screens', null, false),
  ('0de30000-0000-4000-8000-000000000702', 5, 'Shut off and lock out the pump panel', null, false),
  ('0de30000-0000-4000-8000-000000000702', 6, 'Note any leaking boots or worn sprinklers for spring', null, true),
  ('0de30000-0000-4000-8000-000000000703', 1, 'Flush the tank and boom with clean water', null, false),
  ('0de30000-0000-4000-8000-000000000703', 2, 'Catch-test every nozzle', null, true),
  ('0de30000-0000-4000-8000-000000000703', 3, 'Check boom height sensors and section valves', null, false),
  ('0de30000-0000-4000-8000-000000000704', 1, 'Bed the pens and check the heat lamps', null, false),
  ('0de30000-0000-4000-8000-000000000704', 2, 'Stock the calving kit: chains, puller, gloves, colostrum', null, false),
  ('0de30000-0000-4000-8000-000000000704', 3, 'Camera in the barn working', null, false),
  ('0de30000-0000-4000-8000-000000000704', 4, 'Tags and tagger ready, numbers start at', null, true)
) as v(t, n, txt, help, note);

insert into public.checklist_runs (id, template_id, crop_year, name, assigned_to, due_at, status, created_by, created_at, completed_at) values
  ('0de30000-0000-4000-8000-000000000711', '0de30000-0000-4000-8000-000000000702', extract(year from current_date)::int, 'Pivot winterizing',
   array['0de30000-0000-4000-8000-0000000000a1','0de30000-0000-4000-8000-0000000000a2']::uuid[], (current_date + 14)::timestamp at time zone 'America/Edmonton', 'open',
   (select id from public.users order by created_at limit 1), now() - interval '3 days', null),
  ('0de30000-0000-4000-8000-000000000712', '0de30000-0000-4000-8000-000000000701', extract(year from current_date)::int, 'Combine daily walk-around',
   array['0de30000-0000-4000-8000-0000000000a2']::uuid[], (current_date)::timestamp at time zone 'America/Edmonton', 'done',
   '0de30000-0000-4000-8000-0000000000a1', now() - interval '1 day', now() - interval '3 hours');

insert into public.checklist_run_items (run_id, sort_order, item_text_snapshot, requires_note, checked, checked_by, checked_at, note)
select r.id, i.sort_order, i.text, i.requires_note,
       case when r.status = 'done' then true else i.sort_order <= 2 end,
       case when r.status = 'done' or i.sort_order <= 2 then '0de30000-0000-4000-8000-0000000000a2'::uuid end,
       case when r.status = 'done' or i.sort_order <= 2 then now() - interval '4 hours' end,
       case when i.requires_note and r.status = 'done' then '2,148 h' when i.sort_order = 2 and r.status = 'open' then 'North Pivot parked; both creek pivots still running.' end
from public.checklist_runs r
join public.checklist_template_items i on i.template_id = r.template_id
where r.id in ('0de30000-0000-4000-8000-000000000711', '0de30000-0000-4000-8000-000000000712');

-- Jobs that come round every year.
insert into public.monthly_task_templates (title, start_month, end_month, recurrence, checklist_template_id, default_assignee, notes_md, sort_order, active) values
  ('Book fall fertilizer and lock in prepay', 8, 9, 'annual', null, null, 'Prairie Ag Supply prepay discount.', 1, true),
  ('Fall soil sampling', 9, 10, 'annual', null, null, 'Next year''s canola and wheat fields first.', 2, true),
  ('Winterize pivots and the pump station', 10, 10, 'annual', '0de30000-0000-4000-8000-000000000702', '0de30000-0000-4000-8000-0000000000a1', null, 3, true),
  ('Preg check and wean', 10, 11, 'annual', null, '0de30000-0000-4000-8000-0000000000a1', null, 4, true),
  ('Pay land rent', 11, 11, 'annual', null, null, 'Miller Half, 1 November.', 5, true),
  ('Calving barn ready', 2, 2, 'annual', '0de30000-0000-4000-8000-000000000704', '0de30000-0000-4000-8000-0000000000a3', null, 6, true),
  ('Sprayer start-up and calibration', 4, 4, 'annual', '0de30000-0000-4000-8000-000000000703', '0de30000-0000-4000-8000-0000000000a2', null, 7, true),
  ('Brand and vaccinate calves', 6, 6, 'annual', null, null, null, 8, true),
  ('Check stored grain temperatures', 1, 12, 'multi_per_year', null, '0de30000-0000-4000-8000-0000000000a3', 'Every two weeks while there is grain in the bins.', 9, true);

-- The owner's notifications (other kinds are made by the task triggers above).
insert into public.notifications (user_id, kind, title, body, link, read_at, created_at, details)
select (select id from public.users order by created_at limit 1), v.kind, v.title, v.body, v.link,
       case when v.read then now() - interval '1 hour' end, now() - make_interval(hours => v.hrs), v.details::jsonb
from (values
  ('fert_buy_window', 'Fall nitrogen price is near its low for the year', 'Anhydrous is quoted 4% under its 12-month average. Worth booking the West Half and Railway Quarter fall application.', '/fertilizer', false, 30, null),
  ('fert_deadline', 'Prepay discount ends in 9 days', 'Prairie Ag Supply''s 3% prepay discount on spring fertilizer closes soon.', '/fertilizer', true, 50, null),
  ('task_reminder', 'Reminder: fix the west gate at Willow Ridge', 'Due yesterday.', '/tasks', false, 6, null),
  ('task_completed', 'Task completed: Blow down the combine and check the chopper knives', 'by Jordan Pike', '/tasks/0de30000-0000-4000-8000-000000000628', false, 2, null)
) as v(kind, title, body, link, read, hrs, details);

-- This week's meeting plan.
insert into public.meeting_notes (week_start, plan, updated_by)
values (date_trunc('week', current_date)::date,
        E'Finish Correction Line canola, then the header goes to Creek Flat when it is fit.\nJordan hauls canola to Creekside Thursday and Friday.\nCasey: fans on #1 and #2, fix the Willow Ridge gate.\nAlex: book Precision Pivot for the pump station.\nSam: preg check date, Miller lease renewal.',
        (select id from public.users order by created_at limit 1));
