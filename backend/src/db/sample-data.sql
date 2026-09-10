-- Sample data for development. Entirely fictional.
--
-- Run sample-data-clear.sql first if re-seeding; `npm run seed` does both.
-- All dates are relative to the current date, so the data stays realistic
-- over time: overdue checks stay overdue, future review dates stay future.
--
-- The five premises deliberately cover every state of the
-- premises_recording_duty view:
--
--   Riverside House      42 employees        -> duty applies (5+ employees)
--   Clyde Street Depot    8 employees        -> duty applies (5+ employees)
--   Ardrossan Workshop    3 employees        -> duty applies (alterations notice)
--   Oban Store            2 employees        -> duty applies (licensed premises)
--   Mull Outstation       1 employee         -> duty does NOT apply
--
-- Mull Outstation still has a fire risk assessment, with recorded_on left
-- NULL: the duty to assess applies to every employer, only the duty to
-- record is conditional.

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

INSERT INTO people (full_name, job_title, email, phone, is_employee, started_on) VALUES
    ('Fiona Muir',     'Health and Safety Manager', 'f.muir@example.com',      '0141 496 0101', TRUE, current_date - 2200),
    ('Callum Reid',    'Facilities Supervisor',     'c.reid@example.com',      '0141 496 0102', TRUE, current_date - 1400),
    ('Aisha Khan',     'Office Administrator',      'a.khan@example.com',      '0141 496 0103', TRUE, current_date - 900),
    ('Tom Blackwood',  'Depot Manager',             't.blackwood@example.com', '0141 496 0104', TRUE, current_date - 3100),
    ('Grace Lennox',   'Warehouse Operative',       'g.lennox@example.com',    '0141 496 0105', TRUE, current_date - 480),
    ('Struan Bain',    'Maintenance Technician',    's.bain@example.com',      '0141 496 0106', TRUE, current_date - 1750),
    ('Priya Nair',     'HR Coordinator',            'p.nair@example.com',      '0141 496 0107', TRUE, current_date - 620),
    ('Douglas Hay',    'Apprentice Technician',     'd.hay@example.com',       '0141 496 0108', TRUE, current_date - 150);

-- ---------------------------------------------------------------------------
-- Premises
-- ---------------------------------------------------------------------------

INSERT INTO premises (name, address_line1, town, postcode, duty_holder_name, duty_holder_role,
                      employee_count, requires_licence, licence_details, is_multi_occupancy, notes) VALUES
    ('Riverside House', '14 Riverside Way', 'Glasgow', 'G2 8HT',
     'Fiona Muir', 'Health and Safety Manager', 42, FALSE, NULL, TRUE,
     'Head office. Floors 2-3 of a shared six-storey building.'),

    ('Clyde Street Depot', 'Unit 7, Clyde Street Industrial Estate', 'Glasgow', 'G1 4LN',
     'Tom Blackwood', 'Depot Manager', 8, FALSE, NULL, FALSE,
     'Vehicle maintenance workshop and materials store.'),

    ('Ardrossan Workshop', '3 Harbour Road', 'Ardrossan', 'KA22 8DA',
     'Tom Blackwood', 'Depot Manager', 3, FALSE, NULL, FALSE,
     'Small fabrication workshop. Alterations notice served following mezzanine works.'),

    ('Oban Store', '22 Shore Street', 'Oban', 'PA34 4LQ',
     'Fiona Muir', 'Health and Safety Manager', 2, TRUE,
     'Premises licence (alcohol retail), Argyll and Bute Council, ref ABC/PL/4471', FALSE,
     'Retail outlet with licensed sales.'),

    ('Mull Outstation', 'Craignure Pier Office', 'Isle of Mull', 'PA65 6AY',
     'Fiona Muir', 'Health and Safety Manager', 1, FALSE, NULL, FALSE,
     'Single-person office. Assessment carried out but recording not required.');

-- ---------------------------------------------------------------------------
-- Safety roles
-- ---------------------------------------------------------------------------

INSERT INTO safety_roles (premises_id, person_id, role, appointed_on, competence_evidence, legal_basis_code)
SELECT p.id, pe.id, v.role, v.appointed_on, v.evidence, v.basis
FROM (VALUES
    ('Riverside House',    'Fiona Muir',    'competent_assistance',   current_date - 2100, 'NEBOSH National General Certificate; NEBOSH Fire Safety Certificate', 'FSSR2006_r17'),
    ('Riverside House',    'Fiona Muir',    'assessor',               current_date - 2100, 'NEBOSH Fire Safety Certificate, refreshed ' || to_char(current_date - 400, 'YYYY'), 'FSSR2006_r8'),
    ('Riverside House',    'Callum Reid',   'fire_warden',            current_date - 1200, 'In-house fire warden training, half day', 'FSSR2006_r20'),
    ('Riverside House',    'Callum Reid',   'nominated_firefighting', current_date - 1200, 'Extinguisher use, practical assessment', 'FSSR2006_r12'),
    ('Riverside House',    'Aisha Khan',    'fire_warden',            current_date - 700,  'In-house fire warden training, half day', 'FSSR2006_r20'),
    ('Clyde Street Depot', 'Tom Blackwood', 'duty_holder',            current_date - 3000, NULL, 'FSA2005_s53'),
    ('Clyde Street Depot', 'Tom Blackwood', 'nominated_firefighting', current_date - 3000, 'Extinguisher use, practical assessment', 'FSSR2006_r12'),
    ('Clyde Street Depot', 'Struan Bain',   'fire_warden',            current_date - 900,  'In-house fire warden training, half day', 'FSSR2006_r20'),
    ('Ardrossan Workshop', 'Tom Blackwood', 'duty_holder',            current_date - 3000, NULL, 'FSA2005_s53')
) AS v(premises, person, role, appointed_on, evidence, basis)
JOIN premises p  ON p.name = v.premises
JOIN people   pe ON pe.full_name = v.person;

-- ---------------------------------------------------------------------------
-- Fire risk assessments
--
-- Riverside House has two: an original, now superseded, and the current
-- review that supersedes it. This exercises the reg 8 requirement to record
-- after an assessment is carried out OR reviewed.
-- ---------------------------------------------------------------------------

INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, carried_out_on, carried_out_by_id,
     assessor_external, assessor_competence, recorded_on, next_review_due,
     covers_young_persons, covers_dangerous_substances, status, summary)
SELECT p.id, 'FRA-RH-2024-01', 'initial', current_date - 730,
       (SELECT id FROM people WHERE full_name = 'Fiona Muir'),
       NULL, 'NEBOSH Fire Safety Certificate', current_date - 728, current_date - 365,
       FALSE, FALSE, 'superseded',
       'Baseline assessment of floors 2-3 following occupation of the building.'
FROM premises p WHERE p.name = 'Riverside House';

INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, supersedes_id, carried_out_on, carried_out_by_id,
     assessor_external, assessor_competence, recorded_on, next_review_due,
     covers_young_persons, covers_dangerous_substances, status, summary)
SELECT p.id, 'FRA-RH-2026-01', 'review',
       (SELECT id FROM fire_risk_assessments WHERE reference = 'FRA-RH-2024-01'),
       current_date - 120,
       (SELECT id FROM people WHERE full_name = 'Fiona Muir'),
       NULL, 'NEBOSH Fire Safety Certificate', current_date - 118, current_date + 245,
       FALSE, FALSE, 'current',
       'Annual review. Reflects the third floor reconfiguration and the new hot desk area.'
FROM premises p WHERE p.name = 'Riverside House';

INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, carried_out_on, carried_out_by_id,
     assessor_external, assessor_competence, recorded_on, next_review_due,
     covers_young_persons, covers_dangerous_substances, status, summary)
SELECT p.id, 'FRA-CSD-2026-01', 'initial', current_date - 200, NULL,
       'Kelvin Fire Risk Consultants Ltd', 'IFE Level 4 Certificate, tiered assessor register',
       current_date - 195, current_date + 165,
       TRUE, TRUE, 'current',
       'Workshop and store. Covers LPG cylinder storage, paints and solvents, and the apprentice on site.'
FROM premises p WHERE p.name = 'Clyde Street Depot';

INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, carried_out_on, carried_out_by_id,
     recorded_on, next_review_due, status, summary)
SELECT p.id, 'FRA-AW-2026-01', 'revision_after_change', current_date - 45,
       (SELECT id FROM people WHERE full_name = 'Fiona Muir'),
       current_date - 44, current_date + 320, 'current',
       'Revised following installation of the storage mezzanine, which altered the escape route from the rear bay.'
FROM premises p WHERE p.name = 'Ardrossan Workshop';

INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, carried_out_on, carried_out_by_id,
     recorded_on, next_review_due, status, summary)
SELECT p.id, 'FRA-OS-2026-01', 'initial', current_date - 300,
       (SELECT id FROM people WHERE full_name = 'Fiona Muir'),
       current_date - 298, current_date + 65, 'current',
       'Retail unit with ancillary stock room.'
FROM premises p WHERE p.name = 'Oban Store';

-- Assessed, but recording is not required at this premises: recorded_on NULL.
INSERT INTO fire_risk_assessments
    (premises_id, reference, assessment_type, carried_out_on, carried_out_by_id,
     recorded_on, next_review_due, status, summary)
SELECT p.id, 'FRA-MO-2026-01', 'initial', current_date - 160,
       (SELECT id FROM people WHERE full_name = 'Fiona Muir'),
       NULL, current_date + 205, 'current',
       'Single-person office. Assessment carried out; no statutory duty to record it.'
FROM premises p WHERE p.name = 'Mull Outstation';

-- ---------------------------------------------------------------------------
-- Significant findings and the measures answering them (reg 9(a))
-- ---------------------------------------------------------------------------

INSERT INTO fra_significant_findings
    (fire_risk_assessment_id, finding, location, ignition_source, fuel_source, persons_affected, risk_rating)
SELECT f.id, v.finding, v.location, v.ignition, v.fuel, v.affected, v.rating
FROM (VALUES
    ('FRA-RH-2026-01', 'Cardboard packaging stored against the electrical intake cupboard',
     'Second floor store room', 'Electrical distribution board', 'Cardboard and paper packaging',
     'Staff on floors 2-3, cleaners out of hours', 'Medium'),
    ('FRA-RH-2026-01', 'Hot desk area has increased occupancy beyond the original layout, narrowing the route to stair 2',
     'Third floor east', 'Not applicable', 'Not applicable',
     'Up to 28 staff on the third floor', 'Medium'),
    ('FRA-RH-2026-01', 'Final exit door to Riverside Lane occasionally wedged open for deliveries',
     'Ground floor rear', 'External, arson risk', 'Refuse containers stored nearby',
     'All occupants of the shared building', 'High'),
    ('FRA-CSD-2026-01', 'LPG cylinders stored inside the workshop rather than in the external cage',
     'Workshop bay 2', 'Hot work, angle grinder sparks', 'LPG',
     'Workshop staff, apprentice', 'High'),
    ('FRA-CSD-2026-01', 'Solvent-soaked rags disposed of in an open general waste bin',
     'Workshop bay 1', 'Spontaneous heating', 'Solvent residues, textiles',
     'Workshop staff', 'Medium'),
    ('FRA-CSD-2026-01', 'Apprentice had not received fire safety induction within first week',
     'Site-wide', 'Not applicable', 'Not applicable',
     'Apprentice technician', 'Medium'),
    ('FRA-AW-2026-01', 'New mezzanine reduces headroom over the rear escape route and obscures the exit sign',
     'Rear bay', 'Not applicable', 'Not applicable',
     'All workshop staff', 'High')
) AS v(fra_ref, finding, location, ignition, fuel, affected, rating)
JOIN fire_risk_assessments f ON f.reference = v.fra_ref;

INSERT INTO fra_measures
    (finding_id, schedule2_measure_code, description, status, responsible_person_id, target_date, completed_on)
SELECT sf.id, v.code, v.description, v.status,
       (SELECT id FROM people WHERE full_name = v.responsible),
       v.target_date, v.completed_on
FROM (VALUES
    ('Cardboard packaging stored against the electrical intake cupboard', 'a',
     'Clear the store room and mark a 1m exclusion zone around the intake cupboard',
     'taken', 'Callum Reid', current_date - 110, current_date - 105),
    ('Cardboard packaging stored against the electrical intake cupboard', 'a',
     'Add the store room to the weekly housekeeping walkthrough',
     'taken', 'Callum Reid', current_date - 110, current_date - 100),
    ('Hot desk area has increased occupancy beyond the original layout, narrowing the route to stair 2', 'c',
     'Reposition two desk banks to restore 1.2m clear width to stair 2',
     'planned', 'Callum Reid', current_date + 21, NULL),
    ('Final exit door to Riverside Lane occasionally wedged open for deliveries', 'a',
     'Fit a self-closing device with a monitored door contact and brief the delivery team',
     'planned', 'Callum Reid', current_date + 35, NULL),
    ('Final exit door to Riverside Lane occasionally wedged open for deliveries', 'a',
     'Relocate refuse containers at least 6m from the building',
     'taken', 'Callum Reid', current_date - 90, current_date - 88),
    ('LPG cylinders stored inside the workshop rather than in the external cage', 'a',
     'Return all cylinders to the external cage and lock it; daily check added to opening routine',
     'taken', 'Tom Blackwood', current_date - 190, current_date - 188),
    ('LPG cylinders stored inside the workshop rather than in the external cage', 'f',
     'Brief all workshop staff on the hot work permit procedure',
     'taken', 'Tom Blackwood', current_date - 180, current_date - 175),
    ('Solvent-soaked rags disposed of in an open general waste bin', 'a',
     'Provide lidded metal bins for oily and solvent-soaked waste, emptied daily',
     'planned', 'Struan Bain', current_date + 14, NULL),
    ('Apprentice had not received fire safety induction within first week', 'f',
     'Deliver fire safety induction and add induction sign-off to the onboarding checklist',
     'taken', 'Tom Blackwood', current_date - 170, current_date - 168),
    ('New mezzanine reduces headroom over the rear escape route and obscures the exit sign', 'b',
     'Relocate the running man sign below the mezzanine edge and add a low-level repeater',
     'planned', 'Tom Blackwood', current_date + 7, NULL),
    ('New mezzanine reduces headroom over the rear escape route and obscures the exit sign', 'c',
     'Commission a fire engineer to confirm the revised escape route is adequate',
     'planned', 'Fiona Muir', current_date + 28, NULL)
) AS v(finding_text, code, description, status, responsible, target_date, completed_on)
JOIN fra_significant_findings sf ON sf.finding = v.finding_text;

-- ---------------------------------------------------------------------------
-- Persons especially at risk (reg 9(b))
-- ---------------------------------------------------------------------------

INSERT INTO fra_persons_at_risk
    (fire_risk_assessment_id, person_id, group_description, category, why_at_risk, measures, peep_in_place, peep_reference)
SELECT f.id,
       (SELECT id FROM people WHERE full_name = v.person),
       v.group_description, v.category, v.why_at_risk, v.measures, v.peep, v.peep_ref
FROM (VALUES
    ('FRA-RH-2026-01', 'Grace Lennox', NULL, 'mobility_impaired',
     'Uses a wheelchair; cannot use the stairs unaided from the third floor',
     'Evacuation chair at stair 1 with two trained operators on shift; refuge point call system tested weekly',
     TRUE, 'PEEP-RH-004'),
    ('FRA-RH-2026-01', NULL, 'Visitors and contractors', 'visitor',
     'Unfamiliar with the building layout and the two-stair arrangement',
     'Signing in at reception, fire action notice on visitor badge, escorted at all times',
     FALSE, NULL),
    ('FRA-RH-2026-01', NULL, 'Cleaning staff working after 19:00', 'lone_worker',
     'Work alone out of hours when the building is largely unoccupied',
     'Lone working check-in procedure; cleaners briefed on both escape routes',
     FALSE, NULL),
    ('FRA-CSD-2026-01', 'Douglas Hay', NULL, 'young_person',
     'Apprentice aged 17; limited experience of workshop hazards and hot work',
     'Direct supervision during hot work; induction completed; not permitted to work alone',
     FALSE, NULL),
    ('FRA-CSD-2026-01', NULL, 'Delivery drivers', 'visitor',
     'Attend the yard without site induction',
     'Restricted to the yard; not permitted in the workshop unaccompanied',
     FALSE, NULL),
    ('FRA-AW-2026-01', NULL, 'All workshop staff', 'other',
     'Single escape route from the rear bay while the mezzanine sign is obscured',
     'Temporary marshalling arrangement until the sign is relocated and the route confirmed',
     FALSE, NULL)
) AS v(fra_ref, person, group_description, category, why_at_risk, measures, peep, peep_ref)
JOIN fire_risk_assessments f ON f.reference = v.fra_ref;

-- ---------------------------------------------------------------------------
-- Fire safety arrangements (reg 10)
-- ---------------------------------------------------------------------------

INSERT INTO fire_safety_arrangements
    (premises_id, schedule2_measure_code, planning, organisation, control, monitoring, review,
     responsible_person_id, effective_from, recorded_on)
SELECT p.id, v.code, v.planning, v.organisation, v.control, v.monitoring, v.review,
       (SELECT id FROM people WHERE full_name = v.responsible),
       v.effective_from, v.effective_from
FROM (VALUES
    ('Riverside House', 'a',
     'Annual review of ignition sources and combustible storage as part of the assessment cycle',
     'Facilities Supervisor owns housekeeping; floor wardens report issues weekly',
     'Smoking prohibited except at the designated external point; contractor hot work permit required',
     'Weekly housekeeping walkthrough recorded against each floor',
     'Reviewed annually with the fire risk assessment, or after any change of layout',
     'Callum Reid', current_date - 118),
    ('Riverside House', 'b',
     'Two protected stairs maintained as the means of escape; layout changes assessed before implementation',
     'Facilities Supervisor responsible for keeping routes clear',
     'Escape routes kept clear at all times; no storage permitted in corridors or stairs',
     'Daily visual walkthrough by reception; formal weekly check recorded',
     'Reviewed annually and after any reconfiguration',
     'Callum Reid', current_date - 118),
    ('Riverside House', 'd',
     'Extinguisher provision matched to the risks on each floor',
     'Servicing contracted to an accredited provider; wardens carry out monthly visual checks',
     'Extinguishers kept on marked stands and not relocated',
     'Monthly visual check and annual service, both recorded',
     'Reviewed on service renewal',
     'Callum Reid', current_date - 118),
    ('Riverside House', 'e',
     'Addressable L2 system covering escape routes and higher risk rooms',
     'Alarm maintenance contracted; weekly call point test rotated by zone',
     'Panel faults escalated to Facilities within one working day',
     'Weekly test and six-monthly service recorded against the panel',
     'Reviewed on contract renewal',
     'Callum Reid', current_date - 118),
    ('Riverside House', 'f',
     'Evacuation strategy is simultaneous evacuation to the Riverside Lane assembly point',
     'Warden per floor, deputy named for each; roll call from the visitor and staff list',
     'Fire action notices at every call point and lift lobby',
     'Drills held and recorded; warden coverage checked against the shift roster',
     'Procedure reviewed after every drill and after any incident',
     'Fiona Muir', current_date - 118),
    ('Clyde Street Depot', 'a',
     'Hot work and flammable storage controls set out in the depot safe system of work',
     'Depot Manager owns the permit system; fire warden checks storage daily',
     'Hot work permit mandatory; LPG stored only in the external cage',
     'Daily cylinder cage check; monthly review of permits issued',
     'Reviewed annually and after any incident or near miss',
     'Tom Blackwood', current_date - 195),
    ('Clyde Street Depot', 'f',
     'Evacuation to the yard muster point; workshop shut down procedure before leaving',
     'Depot Manager is incident controller; fire warden sweeps the workshop',
     'No re-entry without authorisation from the incident controller',
     'Drills held twice yearly given the higher risk; recorded with evacuation times',
     'Reviewed after every drill',
     'Tom Blackwood', current_date - 195)
) AS v(premises, code, planning, organisation, control, monitoring, review, responsible, effective_from)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Dangerous substances (regs 6-7; DSEAR 2002)
-- ---------------------------------------------------------------------------

INSERT INTO dangerous_substances
    (premises_id, fire_risk_assessment_id, name, quantity, location, hazardous_properties,
     supplier_safety_data_ref, ignition_sources, explosive_atmosphere_likely, explosive_atmosphere_notes,
     hazardous_area_classification, area_marked, assessed_on, assessed_by_id)
SELECT p.id,
       (SELECT id FROM fire_risk_assessments WHERE reference = 'FRA-CSD-2026-01'),
       v.name, v.quantity, v.location, v.properties, v.sds, v.ignition,
       v.atmos, v.atmos_notes, v.zone, v.marked, current_date - 195,
       (SELECT id FROM people WHERE full_name = 'Tom Blackwood')
FROM (VALUES
    ('Propane (LPG)', '4 x 19kg cylinders', 'External cage, north wall',
     'Extremely flammable gas; heavier than air, may accumulate at low level',
     'SDS-LPG-2024-11', 'Hot work, vehicle ignition, electrical equipment in the yard',
     TRUE, 'Cage is open-sided and naturally ventilated; accumulation unlikely but credible on release',
     'Zone 2 within 1.5m of the cage', TRUE),
    ('Cellulose thinners', '25 litres', 'Flammables cabinet, workshop bay 1',
     'Highly flammable liquid and vapour; vapour heavier than air',
     'SDS-THIN-2025-03', 'Angle grinder sparks, static discharge during decanting',
     TRUE, 'Vapour may accumulate inside the cabinet if a container is left open',
     'Zone 2 inside the cabinet', TRUE),
    ('Two-pack paint hardener', '10 litres', 'Flammables cabinet, workshop bay 1',
     'Flammable liquid; harmful vapour',
     'SDS-HARD-2025-03', 'Hot work in adjacent bay',
     FALSE, NULL, NULL, FALSE),
    ('Waste oil', '200 litres', 'Bunded drum store, yard',
     'Combustible liquid; low flashpoint contamination possible from solvent mixing',
     'SDS-WOIL-2024-08', 'Hot work, discarded smoking materials',
     FALSE, NULL, NULL, FALSE)
) AS v(name, quantity, location, properties, sds, ignition, atmos, atmos_notes, zone, marked)
JOIN premises p ON p.name = 'Clyde Street Depot';

-- ---------------------------------------------------------------------------
-- Check schedules
--
-- None of these intervals is set by legislation. recommended_by records
-- where each one actually comes from, and is_statutory stays false.
-- ---------------------------------------------------------------------------

INSERT INTO check_schedules (premises_id, applies_to, check_type, interval_days, recommended_by, is_statutory, notes) VALUES
    (NULL, 'equipment_type:call_point',        'function',      7,   'BS 5839-1',                                                    FALSE, '[sample data] Weekly test, rotating call points by zone'),
    (NULL, 'equipment_type:alarm_panel',       'service',       182, 'BS 5839-1',                                                    FALSE, '[sample data] Six-monthly service by competent contractor'),
    (NULL, 'equipment_type:emergency_lighting','function',      30,  'BS 5266-1',                                                    FALSE, '[sample data] Monthly short function test'),
    (NULL, 'equipment_type:emergency_lighting','discharge_test',365, 'BS 5266-1',                                                    FALSE, '[sample data] Annual full rated duration discharge test'),
    (NULL, 'equipment_type:extinguisher',      'visual',        30,  'BS 5306-3',                                                    FALSE, '[sample data] Monthly visual inspection by fire warden'),
    (NULL, 'equipment_type:extinguisher',      'service',       365, 'BS 5306-3',                                                    FALSE, '[sample data] Annual basic service by competent person'),
    (NULL, 'equipment_type:fire_door',         'visual',        182, 'BS 8214 / good practice',                                      FALSE, '[sample data] Six-monthly fire door inspection'),
    (NULL, 'escape_route',                     'walkthrough',   7,   'Scottish Government Practical Fire Safety Guidance, ch.4',      FALSE, '[sample data] Weekly recorded check, plus daily visual'),
    (NULL, 'fire_drill',                       'drill',         365, 'Scottish Government Practical Fire Safety Guidance, ch.4 (113)',FALSE, '[sample data] At least annually; more often where risk warrants'),
    (NULL, 'training:refresher',               'training',      365, 'Local policy',                                                 FALSE, '[sample data] Annual refresher; reg 20 says only "periodically when appropriate"');

INSERT INTO check_schedules (premises_id, applies_to, check_type, interval_days, recommended_by, is_statutory, notes)
SELECT p.id, 'fire_drill', 'drill', 182,
       'Local policy, higher risk premises', FALSE,
       '[sample data] Twice yearly at the depot because of hot work and LPG'
FROM premises p WHERE p.name = 'Clyde Street Depot';

-- ---------------------------------------------------------------------------
-- Equipment
-- ---------------------------------------------------------------------------

INSERT INTO equipment (premises_id, equipment_type, schedule2_measure_code, identifier, location,
                       make, model, serial_number, installed_on, standard_reference)
SELECT p.id, v.type, v.code, v.identifier, v.location, v.make, v.model, v.serial, v.installed, v.standard
FROM (VALUES
    ('Riverside House', 'alarm_panel',        'e', 'PANEL-RH-01', 'Second floor lobby',        'Advanced', 'MxPro 5',      'AP-55219',  current_date - 1800, 'BS 5839-1'),
    ('Riverside House', 'call_point',         'e', 'MCP-RH-201',  'Second floor, stair 1',     'Apollo',   'Series 65',    'MCP-20114', current_date - 1800, 'BS 5839-1'),
    ('Riverside House', 'call_point',         'e', 'MCP-RH-202',  'Second floor, stair 2',     'Apollo',   'Series 65',    'MCP-20115', current_date - 1800, 'BS 5839-1'),
    ('Riverside House', 'call_point',         'e', 'MCP-RH-301',  'Third floor, stair 1',      'Apollo',   'Series 65',    'MCP-20116', current_date - 1800, 'BS 5839-1'),
    ('Riverside House', 'detector',           'e', 'SD-RH-214',   'Second floor store room',   'Apollo',   'XP95 optical', 'SD-88431',  current_date - 1800, 'BS 5839-1'),
    ('Riverside House', 'extinguisher',       'd', 'EXT-RH-201',  'Second floor, stair 1',     'Chubb',    'Water 9L',     'CH-771204', current_date - 1100, 'BS 5306-3'),
    ('Riverside House', 'extinguisher',       'd', 'EXT-RH-202',  'Second floor kitchen',      'Chubb',    'CO2 2kg',      'CH-771205', current_date - 1100, 'BS 5306-3'),
    ('Riverside House', 'extinguisher',       'd', 'EXT-RH-301',  'Third floor, stair 1',      'Chubb',    'Water 9L',     'CH-771206', current_date - 1100, 'BS 5306-3'),
    ('Riverside House', 'emergency_lighting', 'c', 'EL-RH-S1-02', 'Stair 1, second floor',     'Thorn',    'Voyager',      'TH-40021',  current_date - 1800, 'BS 5266-1'),
    ('Riverside House', 'emergency_lighting', 'c', 'EL-RH-S2-02', 'Stair 2, second floor',     'Thorn',    'Voyager',      'TH-40022',  current_date - 1800, 'BS 5266-1'),
    ('Riverside House', 'fire_door',          'b', 'FD-RH-S1-02', 'Stair 1 lobby, second floor','Ahmarra', 'FD30S',        'AH-11203',  current_date - 1800, 'BS 476-22'),
    ('Riverside House', 'signage',            'b', 'SIG-RH-014',  'Third floor east, route to stair 2', NULL, NULL,        NULL,        current_date - 1800, 'BS 5499-4'),
    ('Clyde Street Depot', 'alarm_panel',     'e', 'PANEL-CSD-01','Workshop entrance',         'Kentec',   'Syncro AS',    'KE-31002',  current_date - 2400, 'BS 5839-1'),
    ('Clyde Street Depot', 'call_point',      'e', 'MCP-CSD-01',  'Workshop main door',        'Apollo',   'Series 65',    'MCP-31118', current_date - 2400, 'BS 5839-1'),
    ('Clyde Street Depot', 'extinguisher',    'd', 'EXT-CSD-01',  'Workshop bay 1',            'Chubb',    'Foam 6L',      'CH-880114', current_date - 800,  'BS 5306-3'),
    ('Clyde Street Depot', 'extinguisher',    'd', 'EXT-CSD-02',  'Workshop bay 2',            'Chubb',    'Dry powder 9kg','CH-880115',current_date - 800,  'BS 5306-3'),
    ('Clyde Street Depot', 'fire_blanket',    'd', 'FB-CSD-01',   'Mess room',                 'Chubb',    '1.2m x 1.2m',  'CH-880116', current_date - 800,  'BS EN 1869'),
    ('Clyde Street Depot', 'emergency_lighting','c','EL-CSD-01',  'Workshop rear exit',        'Thorn',    'Voyager',      'TH-40088',  current_date - 2400, 'BS 5266-1'),
    ('Ardrossan Workshop', 'extinguisher',    'd', 'EXT-AW-01',   'Workshop entrance',         'Chubb',    'Foam 6L',      'CH-990201', current_date - 600,  'BS 5306-3'),
    ('Ardrossan Workshop', 'signage',         'b', 'SIG-AW-01',   'Rear bay, obscured by mezzanine', NULL, NULL,           NULL,        current_date - 600,  'BS 5499-4'),
    ('Oban Store',         'extinguisher',    'd', 'EXT-OS-01',   'Behind the counter',        'Chubb',    'Water 6L',     'CH-660301', current_date - 400,  'BS 5306-3')
) AS v(premises, type, code, identifier, location, make, model, serial, installed, standard)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Equipment checks
--
-- Includes a passed set, one pass with defects since remedied, one
-- outstanding failure, and two now overdue, so "what is due" queries have
-- something to find.
-- ---------------------------------------------------------------------------

INSERT INTO equipment_checks
    (equipment_id, check_type, performed_on, performed_by_id, performed_by_external,
     outcome, defects_found, remedial_action, remedied_on, next_due_on, certificate_reference)
SELECT e.id, v.check_type, v.performed_on,
       (SELECT id FROM people WHERE full_name = v.performed_by),
       v.external, v.outcome, v.defects, v.remedial, v.remedied, v.next_due, v.certificate
FROM (VALUES
    ('MCP-RH-201',  'function', current_date - 4,   'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date + 3,   NULL),
    ('MCP-RH-202',  'function', current_date - 11,  'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date - 4,   NULL),
    ('MCP-RH-301',  'function', current_date - 18,  'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date + 10,  NULL),
    ('PANEL-RH-01', 'service',  current_date - 95,  NULL,          'Caledonian Fire Systems Ltd', 'pass_with_defects',
        'Zone 4 sounder circuit showing intermittent fault', 'Sounder replaced and circuit retested', current_date - 88, current_date + 87, 'CFS-2026-0412'),
    ('EXT-RH-201',  'visual',   current_date - 12,  'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date + 18,  NULL),
    ('EXT-RH-202',  'visual',   current_date - 12,  'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date + 18,  NULL),
    ('EXT-RH-301',  'visual',   current_date - 47,  'Aisha Khan',  NULL,                          'pass',              NULL, NULL, NULL, current_date - 17,  NULL),
    ('EXT-RH-201',  'service',  current_date - 210, NULL,          'Caledonian Fire Systems Ltd', 'pass',              NULL, NULL, NULL, current_date + 155, 'CFS-2026-0119'),
    ('EL-RH-S1-02', 'function', current_date - 21,  'Callum Reid', NULL,                          'pass',              NULL, NULL, NULL, current_date + 9,   NULL),
    ('EL-RH-S2-02', 'function', current_date - 21,  'Callum Reid', NULL,                          'fail',
        'Luminaire did not illuminate on test; suspected failed battery pack', 'Battery pack replacement ordered', NULL, current_date + 9, NULL),
    ('EL-RH-S1-02', 'discharge_test', current_date - 300, NULL,    'Caledonian Fire Systems Ltd', 'pass',              NULL, NULL, NULL, current_date + 65,  'CFS-2025-0988'),
    ('FD-RH-S1-02', 'visual',   current_date - 100, 'Callum Reid', NULL,                          'pass_with_defects',
        'Intumescent strip damaged on the hinge side', 'Strip replaced', current_date - 93, current_date + 82, NULL),
    ('EXT-CSD-01',  'visual',   current_date - 9,   'Struan Bain', NULL,                          'pass',              NULL, NULL, NULL, current_date + 21,  NULL),
    ('EXT-CSD-02',  'visual',   current_date - 9,   'Struan Bain', NULL,                          'pass',              NULL, NULL, NULL, current_date + 21,  NULL),
    ('MCP-CSD-01',  'function', current_date - 6,   'Struan Bain', NULL,                          'pass',              NULL, NULL, NULL, current_date + 1,   NULL),
    ('EL-CSD-01',   'function', current_date - 55,  'Struan Bain', NULL,                          'pass',              NULL, NULL, NULL, current_date - 25,  NULL),
    ('EXT-AW-01',   'visual',   current_date - 33,  'Tom Blackwood', NULL,                        'pass',              NULL, NULL, NULL, current_date - 3,   NULL),
    ('EXT-OS-01',   'service',  current_date - 120, NULL,          'Argyll Fire Protection',      'pass',              NULL, NULL, NULL, current_date + 245, 'AFP-2026-0221')
) AS v(identifier, check_type, performed_on, performed_by, external, outcome, defects, remedial, remedied, next_due, certificate)
JOIN equipment e ON e.identifier = v.identifier;

-- ---------------------------------------------------------------------------
-- Escape routes and their checks
-- ---------------------------------------------------------------------------

INSERT INTO escape_routes (premises_id, name, description, final_exit, capacity, travel_distance_m,
                           has_emergency_lighting, signage_notes)
SELECT p.id, v.name, v.description, v.final_exit, v.capacity, v.distance, v.lighting, v.signage
FROM (VALUES
    ('Riverside House',    'Stair 1 (north)', 'Protected stair serving floors 2-3 to the main entrance', 'Riverside Way main entrance', 90, 28.50, TRUE,  'Fully signed to BS 5499-4'),
    ('Riverside House',    'Stair 2 (south)', 'Protected stair serving floors 2-3 to the rear lane',      'Riverside Lane rear exit',    60, 34.00, TRUE,  'Fully signed; third floor route narrowed by hot desks'),
    ('Clyde Street Depot', 'Workshop main',   'Direct route from both bays to the yard',                  'Workshop main door',          25, 18.00, TRUE,  'Signed at high level'),
    ('Clyde Street Depot', 'Workshop rear',   'Secondary route from bay 2 past the flammables cabinet',   'Rear personnel door',         15, 22.50, TRUE,  'Signed; route passes the flammables cabinet'),
    ('Ardrossan Workshop', 'Rear bay route',  'Sole route from the rear bay, now beneath the mezzanine',  'Rear roller shutter pedestrian door', 10, 16.00, FALSE, 'Exit sign obscured by the new mezzanine; temporary signage in place'),
    ('Oban Store',         'Shop front',      'Direct route from the shop floor',                         'Shore Street shop door',      20, 12.00, TRUE,  'Signed')
) AS v(premises, name, description, final_exit, capacity, distance, lighting, signage)
JOIN premises p ON p.name = v.premises;

INSERT INTO escape_route_checks
    (escape_route_id, performed_on, performed_by_id, obstructions_found, outcome, remedial_action, remedied_on, next_due_on)
SELECT r.id, v.performed_on,
       (SELECT id FROM people WHERE full_name = v.performed_by),
       v.obstructions, v.outcome, v.remedial, v.remedied, v.next_due
FROM (VALUES
    ('Stair 1 (north)', current_date - 3,  'Callum Reid', NULL, 'pass', NULL, NULL, current_date + 4),
    ('Stair 2 (south)', current_date - 3,  'Callum Reid',
        'Two boxes of stationery on the third floor half landing', 'pass_with_defects',
        'Boxes removed at the time of the check', current_date - 3, current_date + 4),
    ('Stair 1 (north)', current_date - 10, 'Callum Reid', NULL, 'pass', NULL, NULL, current_date - 3),
    ('Workshop main',   current_date - 5,  'Struan Bain', NULL, 'pass', NULL, NULL, current_date + 2),
    ('Workshop rear',   current_date - 5,  'Struan Bain',
        'Pallet of parts partially blocking the route', 'fail',
        'Pallet relocated; racking ordered so parts are not stored on the floor', NULL, current_date + 2),
    ('Rear bay route',  current_date - 12, 'Tom Blackwood',
        'Exit sign not visible from the working position', 'fail',
        'Temporary sign fitted pending permanent relocation', NULL, current_date - 5)
) AS v(route_name, performed_on, performed_by, obstructions, outcome, remedial, remedied, next_due)
JOIN escape_routes r ON r.name = v.route_name;

-- ---------------------------------------------------------------------------
-- Emergency procedures, drills
-- ---------------------------------------------------------------------------

INSERT INTO emergency_procedures (premises_id, title, procedure, version, effective_from)
SELECT p.id, v.title, v.procedure, v.version, v.effective_from
FROM (VALUES
    ('Riverside House', 'Fire evacuation procedure',
     'On discovering a fire, operate the nearest call point and leave by the nearest available exit. '
     'On hearing the continuous alarm, evacuate immediately by the nearest stair. Do not use the lifts. '
     'Floor wardens sweep their floor and report to the incident controller at the assembly point on '
     'Riverside Lane opposite number 14. Wheelchair users proceed to the stair 1 refuge and use the '
     'call system; trained operators attend with the evacuation chair. Do not re-enter until the '
     'incident controller or the Scottish Fire and Rescue Service authorises it.',
     3, current_date - 118),
    ('Clyde Street Depot', 'Workshop evacuation and shutdown procedure',
     'On discovering a fire, raise the alarm at the workshop main door call point. Before leaving, and '
     'only if it is safe to do so, isolate hot work equipment and close the LPG cage valve. Evacuate to '
     'the yard muster point at the north gate. The fire warden sweeps both bays and the mess room. The '
     'Depot Manager acts as incident controller and meets the fire service at the gate with the '
     'dangerous substances inventory. No re-entry without authorisation.',
     2, current_date - 195)
) AS v(premises, title, procedure, version, effective_from)
JOIN premises p ON p.name = v.premises;

INSERT INTO fire_drills (premises_id, held_at, scenario, evacuation_time_seconds, persons_participating,
                         wardens_present, issues_identified, actions_taken, conducted_by_id)
SELECT p.id, v.held_at, v.scenario, v.seconds, v.participants, v.wardens, v.issues, v.actions,
       (SELECT id FROM people WHERE full_name = v.conducted_by)
FROM (VALUES
    ('Riverside House', now() - interval '95 days',
     'Unannounced, simulated fire in the second floor store room, stair 1 assumed unavailable',
     168, 38, 'Callum Reid, Aisha Khan',
     'Third floor took 41 seconds longer than the second; hot desk area slowed movement to stair 2. '
     'One visitor was not accounted for at first roll call and was found to have signed out earlier.',
     'Desk reconfiguration raised in the assessment review. Sign-out process reiterated at reception.',
     'Fiona Muir'),
    ('Riverside House', now() - interval '280 days',
     'Announced daytime drill, both stairs available',
     142, 35, 'Callum Reid, Aisha Khan',
     'No significant issues. Evacuation chair deployment practised successfully.',
     'None required.',
     'Fiona Muir'),
    ('Clyde Street Depot', now() - interval '60 days',
     'Simulated fire in workshop bay 2 during hot work',
     96, 8, 'Struan Bain',
     'LPG cage valve was not isolated before evacuation; the operative went straight to the muster point.',
     'Shutdown steps re-briefed and added to the laminated card at each bay.',
     'Tom Blackwood'),
    ('Clyde Street Depot', now() - interval '240 days',
     'Announced drill, standard workshop occupancy',
     88, 7, 'Struan Bain',
     'No issues identified.',
     'None required.',
     'Tom Blackwood'),
    ('Ardrossan Workshop', now() - interval '400 days',
     'Announced drill before the mezzanine was installed',
     74, 3, 'Tom Blackwood',
     'No issues at the time. Route has since changed.',
     'Drill to be repeated once the revised escape route is confirmed.',
     'Tom Blackwood')
) AS v(premises, held_at, scenario, seconds, participants, wardens, issues, actions, conducted_by)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Training and information to employees (regs 18, 20)
-- ---------------------------------------------------------------------------

INSERT INTO training_records (premises_id, person_id, training_type, delivered_on, delivered_by_id,
                              provider, content_summary, during_working_hours, next_due_on)
SELECT p.id,
       (SELECT id FROM people WHERE full_name = v.person),
       v.training_type, v.delivered_on,
       (SELECT id FROM people WHERE full_name = v.delivered_by),
       v.provider, v.content, TRUE, v.next_due
FROM (VALUES
    ('Riverside House', 'Callum Reid',   'fire_warden',        current_date - 200, NULL,         'Caledonian Fire Systems Ltd', 'Warden duties, sweep procedure, evacuation chair operation', current_date + 165),
    ('Riverside House', 'Aisha Khan',    'fire_warden',        current_date - 200, NULL,         'Caledonian Fire Systems Ltd', 'Warden duties, sweep procedure, roll call',                  current_date + 165),
    ('Riverside House', 'Callum Reid',   'extinguisher_use',   current_date - 200, NULL,         'Caledonian Fire Systems Ltd', 'Practical extinguisher use on a live burn rig',               current_date + 165),
    ('Riverside House', 'Aisha Khan',    'evacuation_aid',     current_date - 190, 'Callum Reid', NULL,                         'Evacuation chair operation and refuge communication',        current_date + 175),
    ('Riverside House', 'Priya Nair',    'refresher',          current_date - 400, 'Fiona Muir',  NULL,                         'Annual fire safety refresher',                                current_date - 35),
    ('Riverside House', 'Grace Lennox',  'induction',          current_date - 470, 'Fiona Muir',  NULL,                         'Fire safety induction including personal evacuation plan',    current_date - 105),
    ('Riverside House', 'Fiona Muir',    'refresher',          current_date - 120, NULL,         'Caledonian Fire Systems Ltd', 'Assessor refresher and legislative update',                   current_date + 245),
    ('Clyde Street Depot', 'Tom Blackwood', 'refresher',       current_date - 150, NULL,         'Caledonian Fire Systems Ltd', 'Annual refresher, hot work controls, LPG storage',            current_date + 215),
    ('Clyde Street Depot', 'Struan Bain',   'fire_warden',     current_date - 300, NULL,         'Caledonian Fire Systems Ltd', 'Warden duties and workshop shutdown procedure',               current_date + 65),
    ('Clyde Street Depot', 'Douglas Hay',   'induction',       current_date - 168, 'Tom Blackwood', NULL,                       'Fire safety induction, hot work permit, LPG cage rules',      current_date + 197),
    ('Clyde Street Depot', 'Douglas Hay',   'new_or_changed_risk', current_date - 60, 'Tom Blackwood', NULL,                    'Briefing on the new lidded solvent waste bins',               NULL),
    ('Clyde Street Depot', 'Struan Bain',   'extinguisher_use',current_date - 300, NULL,         'Caledonian Fire Systems Ltd', 'Practical extinguisher use, foam and dry powder',             current_date + 65),
    ('Ardrossan Workshop', 'Tom Blackwood', 'new_or_changed_risk', current_date - 44, 'Fiona Muir', NULL,                       'Briefing on the revised rear bay escape route',               NULL)
) AS v(premises, person, training_type, delivered_on, delivered_by, provider, content, next_due)
JOIN premises p ON p.name = v.premises;

INSERT INTO employee_information_records
    (premises_id, person_id, group_description, information_type, provided_on, method, provided_by_id, notes)
SELECT p.id,
       (SELECT id FROM people WHERE full_name = v.person),
       v.group_description, v.info_type, v.provided_on, v.method,
       (SELECT id FROM people WHERE full_name = v.provided_by),
       v.notes
FROM (VALUES
    ('Riverside House', NULL, 'All staff, floors 2-3', 'risks_identified',            current_date - 115, 'Team briefing and intranet notice', 'Fiona Muir',    'Summary of the 2026 assessment findings circulated'),
    ('Riverside House', NULL, 'All staff, floors 2-3', 'nominated_person_identities', current_date - 115, 'Intranet notice and floor noticeboards', 'Fiona Muir', 'Wardens and deputies named by floor'),
    ('Riverside House', NULL, 'All staff, floors 2-3', 'emergency_procedures',        current_date - 115, 'Fire action notices and induction pack', 'Callum Reid', 'Version 3 of the evacuation procedure'),
    ('Riverside House', 'Grace Lennox', NULL,          'emergency_procedures',        current_date - 460, 'One to one, PEEP agreed',           'Fiona Muir',     'Personal evacuation plan PEEP-RH-004 agreed and signed'),
    ('Clyde Street Depot', NULL, 'All depot staff',    'dangerous_substances',        current_date - 190, 'Toolbox talk',                      'Tom Blackwood',  'LPG, thinners and waste oil; cage and cabinet rules'),
    ('Clyde Street Depot', NULL, 'All depot staff',    'nominated_person_identities', current_date - 190, 'Noticeboard at the workshop entrance', 'Tom Blackwood', 'Depot Manager as incident controller, Struan Bain as warden'),
    ('Ardrossan Workshop', NULL, 'All workshop staff', 'risks_identified',            current_date - 44,  'Toolbox talk',                      'Tom Blackwood',  'Mezzanine escape route change and temporary arrangements')
) AS v(premises, person, group_description, info_type, provided_on, method, provided_by, notes)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Co-operation in shared premises (reg 21)
-- ---------------------------------------------------------------------------

INSERT INTO cooperation_records (premises_id, other_duty_holder, contact_details, arrangements,
                                 information_shared, recorded_on)
SELECT p.id, v.other, v.contact, v.arrangements, v.shared, v.recorded_on
FROM (VALUES
    ('Riverside House', 'Riverside Way Management Company Ltd (building owner)',
     'building.manager@example.com, 0141 496 0200',
     'Owner maintains the common stairs, the building-wide alarm and the lift. Tenants maintain their own '
     'demise. Quarterly fire safety liaison meeting; shared assembly point on Riverside Lane with a single '
     'incident controller nominated per evacuation.',
     'Our assessment findings affecting common parts, warden names, and the evacuation chair arrangement '
     'for the third floor refuge.',
     current_date - 110),
    ('Riverside House', 'Loch Analytics Ltd (fourth floor tenant)',
     'facilities@example.com',
     'Reciprocal notification of drills so neither tenant is surprised by an alarm. Agreed not to hold '
     'drills within the same fortnight.',
     'Drill calendar and warden contact list.',
     current_date - 105)
) AS v(premises, other, contact, arrangements, shared, recorded_on)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Health and safety policy (HSWA s.2(3))
-- ---------------------------------------------------------------------------

INSERT INTO health_safety_policies (premises_id, statement, version, effective_from) VALUES
    (NULL,
     'It is the policy of this organisation to provide and maintain safe and healthy working conditions, '
     'equipment and systems of work for all employees, and to provide the information, training and '
     'supervision needed to achieve that. Fire safety is managed under the Fire (Scotland) Act 2005 and '
     'the Fire Safety (Scotland) Regulations 2006. Overall responsibility rests with the Managing '
     'Director; day to day responsibility for fire safety rests with the Health and Safety Manager. '
     'This statement is reviewed annually and whenever circumstances change.',
     4, current_date - 250);

-- ---------------------------------------------------------------------------
-- Incidents (RIDDOR reg 12 where reportable)
-- ---------------------------------------------------------------------------

INSERT INTO incidents
    (premises_id, occurred_on, occurred_at_time, discovered_on, incident_type, location, description,
     persons_involved, injuries, cause, damage, fire_service_attended,
     riddor_reportable, riddor_reference, riddor_reported_on, riddor_particulars, actions_taken)
SELECT p.id, v.occurred_on, v.occurred_time, v.occurred_on, v.type, v.location, v.description,
       v.persons, v.injuries, v.cause, v.damage, v.attended,
       v.reportable, v.ref, v.reported_on, v.particulars, v.actions
FROM (VALUES
    ('Clyde Street Depot', current_date - 320, TIME '14:20', 'dangerous_occurrence', 'Workshop bay 2',
     'Flashback from an LPG torch ignited a rag on the bench. Extinguished with the bay 2 dry powder '
     'extinguisher within about thirty seconds. Workshop evacuated as a precaution.',
     'Struan Bain (operating the torch), Tom Blackwood (attended)',
     'None', 'Worn torch hose fitting allowing gas escape at the connection',
     'Scorching to the bench top and one damaged rag; no structural damage', TRUE,
     TRUE, 'RIDDOR-2025-118824', current_date - 318,
     'Dangerous occurrence under RIDDOR 2013 sch.2 pt.1 para 17 (accidental ignition of flammable gas). '
     'Particulars per sch.1 pt.2 submitted to HSE via the online form: date, time, location, description, '
     'person affected, and immediate action taken.',
     'All torch hoses and fittings inspected and two replaced. Pre-use check added to the hot work permit. '
     'Toolbox talk delivered to all workshop staff.'),

    ('Riverside House', current_date - 150, TIME '09:05', 'false_alarm', 'Second floor kitchen',
     'Alarm activated by toast in the kitchen toaster. Full evacuation carried out, building cleared in '
     'about three minutes. No fire.',
     'Approximately 36 staff evacuated', 'None',
     'Cooking fumes reaching the optical detector in the adjacent corridor',
     'None', FALSE,
     FALSE, NULL, NULL, NULL,
     'Detector head relocated 2m further from the kitchen doorway following discussion with the alarm '
     'contractor. Staff reminded not to leave the toaster unattended.'),

    ('Riverside House', current_date - 62, TIME '18:40', 'fire', 'Ground floor rear, Riverside Lane',
     'Refuse container fire in the rear lane, believed deliberate. Detected by a passer-by. Fire service '
     'attended and extinguished. No spread to the building, though the rear final exit door was heat '
     'affected.',
     'No staff present; reported by a member of the public', 'None',
     'Suspected arson; refuse containers were then stored against the building',
     'Smoke staining and minor heat damage to the rear final exit door', TRUE,
     FALSE, NULL, NULL, NULL,
     'Refuse containers relocated at least 6m from the building, which closed one of the assessment '
     'findings. Rear door inspected and repainted; intumescent seal confirmed intact.'),

    ('Clyde Street Depot', current_date - 25, TIME '11:15', 'near_miss', 'Workshop bay 1',
     'Solvent-soaked rags found warm in the open general waste bin at the end of the shift.',
     'Reported by Struan Bain', 'None',
     'Solvent-soaked rags placed in general waste rather than a lidded metal bin',
     'None', FALSE,
     FALSE, NULL, NULL, NULL,
     'Bin emptied immediately and contents removed from the building. Lidded metal bins ordered; this is '
     'tracked as an outstanding measure on the current assessment.')
) AS v(premises, occurred_on, occurred_time, type, location, description, persons, injuries, cause,
       damage, attended, reportable, ref, reported_on, particulars, actions)
JOIN premises p ON p.name = v.premises;

-- ---------------------------------------------------------------------------
-- Enforcement notices and visits
-- ---------------------------------------------------------------------------

INSERT INTO enforcement_notices
    (premises_id, notice_type, reference, authority, served_on, in_force, withdrawn_on,
     requirements, response, complied_on)
SELECT p.id, v.type, v.reference, v.authority, v.served_on, v.in_force, v.withdrawn_on,
       v.requirements, v.response, v.complied_on
FROM (VALUES
    ('Ardrossan Workshop', 'alterations', 'SFRS/AN/2026/0331', 'Scottish Fire and Rescue Service',
     current_date - 60, TRUE, NULL::date,
     'Notify the enforcing authority before making any further alteration to the premises, the processes '
     'carried on there, or the fire safety measures, following installation of the storage mezzanine.',
     'Acknowledged. Assessment revised and mezzanine works notified. Awaiting fire engineer report on the '
     'revised rear bay escape route.',
     NULL),
    ('Clyde Street Depot', 'enforcement', 'SFRS/EN/2024/0176', 'Scottish Fire and Rescue Service',
     current_date - 700, FALSE, NULL,
     'Provide a suitable external store for LPG cylinders and cease storage of cylinders within the '
     'workshop.',
     'External cage installed and cylinders relocated. Daily cage check added to the opening routine.',
     current_date - 640)
) AS v(premises, type, reference, authority, served_on, in_force, withdrawn_on, requirements, response, complied_on)
JOIN premises p ON p.name = v.premises;

INSERT INTO enforcement_visits (premises_id, authority, officer_name, visited_on, purpose,
                                documents_provided, findings)
SELECT p.id, v.authority, v.officer, v.visited_on, v.purpose, v.documents, v.findings
FROM (VALUES
    ('Ardrossan Workshop', 'Scottish Fire and Rescue Service', 'Station Manager J Sinclair',
     current_date - 62, 'Audit following notification of the mezzanine installation',
     'Fire risk assessment FRA-AW-2026-01, fire safety arrangements, extinguisher service records, '
     'drill record from the previous year',
     'Escape route from the rear bay compromised by the mezzanine; exit signage obscured. Alterations '
     'notice served. Records otherwise found to be in order.'),
    ('Clyde Street Depot', 'Scottish Fire and Rescue Service', 'Watch Commander A Docherty',
     current_date - 705, 'Routine audit',
     'Fire risk assessment, dangerous substances inventory, hot work permits, training records',
     'LPG cylinders stored internally contrary to the assessment. Enforcement notice served. Training '
     'and permit records found to be satisfactory.'),
    ('Riverside House', 'Scottish Fire and Rescue Service', 'Watch Commander A Docherty',
     current_date - 58, 'Post-incident visit following the refuse container fire',
     'Fire risk assessment FRA-RH-2026-01, incident record, alarm service records',
     'Satisfied with the response. Advised that refuse relocation should be recorded as a completed '
     'measure against the assessment, which was done. No formal action.')
) AS v(premises, authority, officer, visited_on, purpose, documents, findings)
JOIN premises p ON p.name = v.premises;
