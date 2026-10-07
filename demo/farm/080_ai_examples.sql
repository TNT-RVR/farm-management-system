-- Example AI write-ups. In a real copy these come from the app's AI features;
-- here each one says so in its first line (or starts "Example: " where the
-- field is too short, with the full line in the body).

-- Rotation advice: this year and next.
insert into public.rotation_advice (crop_year, requested_by, status, request, request_hash, advice, model, created_at, finished_at)
select extract(year from current_date)::int + v.dy, (select id from public.users order by created_at limit 1), 'done',
       json_build_object('year', extract(year from current_date)::int + v.dy, 'note', 'Example request for the demo farm')::text,
       md5('demo-rotation-' || v.dy),
       'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || v.advice,
       'claude-opus-5-5', now() - make_interval(days => v.ago), now() - make_interval(days => v.ago) + interval '95 seconds'
from (values
  (0, 160, E'- **The plan is sound**: canola on six fields (about 860 ac) keeps every field at least three years between canola crops.\n- **Creek Pivot West** goes canola after wheat; irrigated canola is the best margin on the farm at about $410/ac.\n- **Peas on West Half** are the right call — they break the cereal disease cycle and leave nitrogen for next year''s canola.\n- **Watch Slough Quarter**: cleavers were heavy last year, so plan a pre-seed burnoff with a Group 14 partner.\n- **Oats on Sandhill** suit the light soil; the margin is thin, but it feeds the cows if prices stay low.\n- Wheat acres (about 740) are covered by storage and the deferred contract with room to spare.'),
  (1, 3,   E'- **Canola drops to about 600 ac** next year (Railway Quarter, West Half, Sandhill). That is fine for rotation but leaves margin on the table if canola holds over $14/bu.\n- **West Half after peas** is the strongest canola field next year: nitrate credit from the peas, and no canola for four years.\n- **Sandhill canola is the risk**: light soil and a dry July cut yields 15–20% there. Consider barley and moving canola to Correction Line.\n- **All three pivots in cereals** (barley on North Pivot, wheat on both creek pivots) is heavy on cereals under water; one pivot in peas or canola would spread disease risk.\n- **Malt barley on North Pivot** fits the soil test (38 lb nitrate left) as long as nitrogen stays moderate.\n- Keep **Hay Flat in alfalfa** one more year; the stand is still thick and the cows need the hay.')
) as v(dy, ago, advice);

-- Facts for the Monday meeting (a few per season).
insert into public.meeting_facts (id, topic, title, body, so_what, months, source_url, source)
select 'demo-fact-' || v.n, v.topic, 'Example: ' || v.title,
       'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || v.body,
       'Example: ' || v.so_what, v.months::smallint[], null, 'written'
from (values
  (1, 'canola', 'Canola seed survival is often only 50–60%',
   'Field studies on the prairies regularly find that only about half of canola seeds planted become plants that survive to harvest. Seeding speed, depth and cold soil all lower it.',
   'Set the seeding rate from a target plant stand and our own emergence counts, not from pounds per acre.', '{3,4,5}'),
  (2, 'cereals', 'Wheat protein drops when yields jump',
   'When yield rises without extra nitrogen, the same nitrogen is spread over more grain and protein falls. Irrigated wheat is the most exposed.',
   'On the pivots, keep a late nitrogen top-up in the plan for protein.', '{5,6,7}'),
  (3, 'storage', 'Canola above 8% moisture needs air sooner',
   'Canola stored at 10% moisture and 25 °C can start to heat in a few weeks. Cooling the bin quickly matters as much as drying it.',
   'Run the fans on every canola bin for the first week, even when it went in dry.', '{8,9,10}'),
  (4, 'cattle', 'Cows need about 1% more energy for every degree below their comfort point',
   'Below roughly −20 °C with a dry winter coat, a cow''s energy need climbs about 1% per degree of cold. Wind and a wet coat make it worse.',
   'In a cold snap, add grain or better hay to the ration before body condition slips.', '{11,12,1,2}'),
  (5, 'spraying', 'Wind over 15 km/h doubles drift from fine nozzles',
   'Drift studies show the share of spray that leaves the target roughly doubles between 10 and 20 km/h, and fine droplets drift furthest.',
   'Use the low-drift tips and stop at 20 km/h, especially near the slough and the yard trees.', '{5,6,7}'),
  (6, 'pulses', 'Pea roots fix most of their nitrogen after flowering starts',
   'Nodules on field peas do the bulk of their nitrogen fixing from late vegetative stage into pod fill. Dry or hot weather then cuts fixation.',
   'Do not add starter nitrogen to peas beyond a small amount; it slows the nodules down.', '{4,5,6}'),
  (7, 'forage', 'Alfalfa needs a six-week rest before the first killing frost',
   'Cutting alfalfa in the four to six weeks before a killing frost leaves the roots short of reserves and thins the stand the next spring.',
   'Finish the last cut of Hay Flat by late August, or wait until after a hard frost.', '{8,9}'),
  (8, 'weather', 'Frost-free days vary by more than three weeks year to year',
   'In central Alberta the frost-free season averages about 110 days but swings by three weeks or more between years.',
   'Seed the longest-season crops first, and keep a shorter-season canola variety for late fields.', '{3,4}'),
  (9, 'storage', 'A bin cools from the bottom up — temperature cables lie at the top',
   'Aeration pushes a cooling front up through the grain. Until it reaches the top, the top layer can still be warm even though the fan has run for days.',
   'Read the top sensors before shutting the fan off.', '{9,10,11}'),
  (10, 'cattle', 'Weaning weight rises about 1.5 lb for every day older at weaning',
   'Calves gain roughly 1.5–2 lb a day in the fall on good pasture with their mothers.',
   'Weaning a week later than planned is worth about 10 lb per calf if the grass is there.', '{9,10}')
) as v(n, topic, title, body, so_what, months);

-- Grants the app found (made-up programs).
insert into public.grants (title, funder, url, status, amount_min, amount_max, eligibility_summary, summary, notes_md, opens_on, closes_on, region, categories, assigned_to, source, external_key, created_at)
values
  ('Example: On-farm water efficiency program', 'Provincial agriculture ministry (example)', null, 'applying', 5000, 50000,
   'Example: Alberta producers upgrading irrigation to low-pressure drops, variable-rate irrigation or better metering. Cost-share up to 50%.',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
   || 'Cost-share for irrigation upgrades that save water. Prairie Creek''s two older Valley pivots could qualify for new drops and pressure regulators, and the creek pump for a variable-frequency drive.',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
   || E'**Draft outline**\n- Project: new drops and regulators on North Pivot and Creek Pivot West; a VFD on the creek pump.\n- Water saved: about 1.5 in a year across 260 ac.\n- Cost: about $48,000; asking for 50%.\n- Quotes needed from Precision Pivot Service before submitting.',
   current_date - 60, current_date + 34, 'Alberta', '{irrigation,water,equipment}', '0de30000-0000-4000-8000-0000000000a1', 'auto', 'demo-grant-1', now() - interval '40 days'),
  ('Example: Grazing and water development grant', 'Regional watershed group (example)', null, 'reviewing', 2000, 15000,
   'Example: Livestock producers fencing off riparian areas and installing off-stream watering. Up to 75% of materials.',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
   || 'Pays for fencing creek banks and putting in off-stream water. The Creek Paddock crossing at Willow Ridge is a good fit: a solar pump and trough would let the creek bank be fenced off.',
   null, current_date - 20, current_date + 61, 'Alberta', '{cattle,water,environment}', (select id from public.users order by created_at limit 1), 'auto', 'demo-grant-2', now() - interval '18 days'),
  ('Example: Nitrogen management cost-share', 'Federal-provincial partnership (example)', null, 'new', 1000, 25000,
   'Example: Grain farms adopting a nitrogen plan — soil testing, variable-rate application, enhanced-efficiency fertilizer.',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
   || 'Covers part of the cost of soil testing, variable-rate maps and slow-release nitrogen. The farm already soil tests every field on a two-year cycle, which is most of the paperwork.',
   null, current_date - 5, current_date + 120, 'Canada', '{fertilizer,agronomy}', null, 'auto', 'demo-grant-3', now() - interval '5 days'),
  ('Example: Farm safety training rebate', 'Provincial farm safety association (example)', null, 'submitted', 500, 3000,
   'Example: Farms sending workers to first aid, grain bin entry or equipment safety courses.',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n'
   || 'Rebates course fees for farm staff. Casey and Jordan did grain bin entry training this spring.',
   'Submitted with the receipts.', current_date - 200, current_date - 30, 'Alberta', '{safety,training}', null, 'auto', 'demo-grant-4', now() - interval '150 days');

-- Conferences and field days the app found (made up).
insert into public.events (name, organiser, url, starts_on, ends_on, registration_deadline, early_bird_deadline, venue, city, region, country, cost, early_bird_cost, currency, cost_notes, categories, why_go, relevance, status, assigned_to, source, external_key, recurrence)
values
  ('Example: Central Prairie Crop Conference', 'Example growers'' association', null, current_date + 98, current_date + 99, current_date + 85, current_date + 40,
   'Conference centre', 'Red Deer', 'AB', 'Canada', 375, 295, 'CAD', 'Early-bird price includes both lunches.', '{canola,cereals,agronomy}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Two days of canola and wheat agronomy an hour from the farm. The clubroot and nitrogen sessions fit next year''s canola fields.',
   88, 'interested', (select id from public.users order by created_at limit 1), 'auto', 'demo-event-1', 'annual'),
  ('Example: Cow-calf winter feeding workshop', 'Example beef extension group', null, current_date + 27, current_date + 27, current_date + 20, null,
   'Community hall', 'Lacombe', 'AB', 'Canada', 60, null, 'CAD', null, '{cattle,feed}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'A one-day workshop on rationing with feed tests — useful with the greenfeed nitrate result this fall.',
   81, 'registered', '0de30000-0000-4000-8000-0000000000a3', 'auto', 'demo-event-2', 'annual'),
  ('Example: Irrigation efficiency field day', 'Example irrigation council', null, current_date + 240, current_date + 240, current_date + 230, null,
   'Research farm', 'Olds', 'AB', 'Canada', 0, null, 'CAD', 'Free; lunch provided.', '{irrigation}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Demonstrations of drop nozzles, VRI and soil-moisture probes — the same upgrades in the water efficiency grant.',
   72, 'watching', null, 'auto', 'demo-event-3', 'annual'),
  ('Example: Farm equipment and technology show', 'Example exhibition society', null, current_date + 155, current_date + 157, null, null,
   'Exhibition grounds', 'Edmonton', 'AB', 'Canada', 20, null, 'CAD', 'Gate admission.', '{equipment,technology}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Three days of equipment dealers. Worth a look before replacing the 7230R loader tractor.',
   55, 'watching', null, 'auto', 'demo-event-4', 'annual'),
  ('Example: Grain marketing short course', 'Example farm business network', null, current_date + 63, current_date + 64, current_date + 50, current_date + 30,
   'Online', null, null, 'Canada', 450, 395, 'CAD', null, '{marketing,business}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Basis, deferred contracts and price targets — the farm has 15,000 bu of wheat on a deferred contract and targets set for canola.',
   64, 'watching', null, 'auto', 'demo-event-5', 'annual'),
  ('Example: Soil health field day', 'Example forage and grazing association', null, current_date - 70, current_date - 70, null, null,
   'Host farm', 'Ponoka', 'AB', 'Canada', 40, null, 'CAD', null, '{soil,grazing}',
   'Example — written for this made-up farm. In your own copy, the AI writes this from your farm''s data.' || E'\n\n' || 'Bale grazing and cover crops on a farm like ours.',
   60, 'attended', '0de30000-0000-4000-8000-0000000000a1', 'auto', 'demo-event-6', 'annual');
