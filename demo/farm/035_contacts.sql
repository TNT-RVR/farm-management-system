-- Contacts: buyers, suppliers, the agronomist, trucking. All made up.
-- Contact ids: 0de30000-0000-4000-8000-0000000003NN.

insert into public.contacts (id, company, contact_name, email, phone, type, notes_md, tags, active, address) values
  ('0de30000-0000-4000-8000-000000000301', 'Prairie Ag Supply', 'Morgan Hale', 'morgan@prairieagsupply.example', '403-555-0141', 'supplier',
   'Fertilizer, chemical and seed. Books fall fertilizer in August; prepay discount ends 15 December.', '{fertilizer,chemical,seed}', true, 'Box 120, Prairie Creek, AB'),
  ('0de30000-0000-4000-8000-000000000302', 'Creekside Grain Terminal', 'Dana Ortiz', 'grain@creeksideterminal.example', '403-555-0152', 'buyer',
   'Canola and wheat. 22 km from the yard. Books deliveries a week out.', '{grain}', true, 'Range Road 252, Prairie Creek, AB'),
  ('0de30000-0000-4000-8000-000000000303', 'Parkland Pulse Processors', 'Lee Chan', 'lee@parklandpulse.example', '403-555-0163', 'buyer',
   'Yellow peas. Wants samples before booking a load.', '{grain,pulses}', true, 'Parkland Industrial Park, AB'),
  ('0de30000-0000-4000-8000-000000000304', 'Aspen Valley Malt', 'Pat Sorensen', 'pat@aspenvalleymalt.example', '403-555-0174', 'buyer',
   'Malt barley contracts from the pivots. Germination and protein tested at intake.', '{grain}', true, null),
  ('0de30000-0000-4000-8000-000000000305', 'Northfield Seeds', 'Jamie Brandt', 'jamie@northfieldseeds.example', '403-555-0185', 'supplier',
   'Certified wheat, barley and pea seed. Cleans our own peas too.', '{seed}', true, null),
  ('0de30000-0000-4000-8000-000000000306', 'Ridgeview Veterinary Clinic', 'Dr. Robin Avery', 'clinic@ridgeviewvet.example', '403-555-0196', 'other',
   'Herd vet. Preg checking booked for the last week of October.', '{cattle,vet}', true, null),
  ('0de30000-0000-4000-8000-000000000307', 'Western Feed & Mineral', 'Chris Wolfe', 'orders@westernfeed.example', '403-555-0207', 'supplier',
   'Mineral, salt, lick tubs and creep pellets.', '{cattle}', true, null),
  ('0de30000-0000-4000-8000-000000000308', 'Taylor Crop Consulting', 'Riley Taylor, P.Ag.', 'riley@taylorcrop.example', '403-555-0218', 'agronomist',
   'Independent agronomist. Pulls our soil samples in September and scouts the pivots every two weeks in season.', '{agronomy}', true, null),
  ('0de30000-0000-4000-8000-000000000309', 'Big Sky Hauling', 'Terry Nolan', 'dispatch@bigskyhauling.example', '403-555-0229', 'trucking',
   'Super-B grain hauling when our own trucks are busy.', '{trucking}', true, null),
  ('0de30000-0000-4000-8000-000000000310', 'Valley Equipment Ltd.', 'Service desk', 'service@valleyequipment.example', '403-555-0230', 'supplier',
   'Combine and tractor dealer. Parts counter open Saturdays in harvest.', '{equipment}', true, null),
  ('0de30000-0000-4000-8000-000000000311', 'County Line Auction Mart', 'Sale barn office', 'office@countylineauction.example', '403-555-0241', 'buyer',
   'Calf sales Thursdays October to December.', '{cattle}', true, null),
  ('0de30000-0000-4000-8000-000000000312', 'Lakeland Fuel Co-op', 'Bulk fuel', 'bulk@lakelandfuel.example', '403-555-0252', 'supplier',
   'Bulk diesel and gas delivered to the yard tanks.', '{fuel}', true, null),
  ('0de30000-0000-4000-8000-000000000313', 'Precision Pivot Service', 'Sam Kowalski', 'service@precisionpivot.example', '403-555-0263', 'custom_operator',
   'Pivot and pump repairs. Winterizes the creek pump station in October.', '{irrigation}', true, null),
  ('0de30000-0000-4000-8000-000000000314', null, 'Evelyn Miller', null, '403-555-0274', 'other',
   'Landlord, Miller Half. Cash rent due 1 November.', '{landlord}', true, 'Prairie Creek, AB');

-- Contacts to add (Contacts → Contacts to add): what a sweep of the farm's
-- mail and books turned up, so Add, No and Undo can be tried. Made up.
insert into public.contact_candidates (company, contact_name, role, email, phone, type, why, source, source_detail, status, decided_at, decided_by, contact_id, created_at) values
  ('Southfork Seed Cleaning', 'Morgan Fehr', 'Plant manager', 'morgan@southforkseed.example', '403-555-0281', 'supplier',
   'Cleaned the wheat seed in March and sent the germination results.', 'mail', '6 emails, last in March', 'pending', null, null, null, now() - interval '16 days'),
  ('Ridgeview Vet Clinic', 'Dr. Alex Brandt', 'Large-animal vet', 'clinic@ridgeviewvet.example', '403-555-0292', 'other',
   'Preg-checked the cows in October; four bills in the books.', 'both', '3 emails and 4 bills', 'pending', null, null, null, now() - interval '16 days'),
  ('Hi-Line Electrical', null, null, null, null, 'supplier',
   'Two bills for the pump station panel. No email or phone on file yet.', 'quickbooks', '2 bills', 'pending', null, null, null, now() - interval '16 days'),
  ('Big Sky Hauling', 'Terry Nolan', 'Dispatch', 'dispatch@bigskyhauling.example', '403-555-0229', 'trucking',
   'Hauled canola to the terminal in October.', 'both', '5 emails and 3 bills', 'approved', now() - interval '15 days',
   (select id from public.users order by created_at limit 1), '0de30000-0000-4000-8000-000000000309', now() - interval '16 days'),
  ('Prairie Farm Weekly', null, 'Newsletter', 'news@prairiefarmweekly.example', null, 'other',
   'A newsletter, not a business the farm deals with.', 'mail', '40 emails', 'rejected', now() - interval '15 days',
   (select id from public.users order by created_at limit 1), null, now() - interval '16 days');
