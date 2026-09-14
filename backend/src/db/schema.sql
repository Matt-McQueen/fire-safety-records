-- Fire safety records — workplace premises in Scotland.
--
-- Legislative basis:
--   Fire (Scotland) Act 2005, Part 3 Chapter 1 (ss.53-56, sch.2)
--   Fire Safety (Scotland) Regulations 2006 (SSI 2006/456)
--   Health and Safety at Work etc. Act 1974 s.2(3)
--   Dangerous Substances and Explosive Atmospheres Regulations 2002
--   Reporting of Injuries, Diseases and Dangerous Occurrences Regulations 2013
--
-- The Regulatory Reform (Fire Safety) Order 2005, Fire Safety Act 2021 and
-- Fire Safety (England) Regulations 2022 do NOT extend to Scotland and are
-- deliberately not modelled here.
--
-- Only regs 8, 9 and 10(2) of SSI 2006/456, HSWA s.2(3) and RIDDOR reg 12
-- impose duties to *record*. Everything else here is evidential: the
-- underlying duty is statutory but keeping the record is the practical means
-- of demonstrating it, not an express requirement. Test and inspection
-- intervals are NOT set by legislation, so they are stored as configurable
-- data in check_schedules rather than hard-coded.

DROP TABLE IF EXISTS items;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

CREATE TABLE legal_basis (
    code                TEXT PRIMARY KEY,
    instrument          TEXT NOT NULL,
    provision           TEXT NOT NULL,
    duty                TEXT NOT NULL,
    is_recording_duty   BOOLEAN NOT NULL,
    applies_when        TEXT,
    source_url          TEXT
);

COMMENT ON TABLE legal_basis IS
    'Catalogue of the statutory duties this database holds records against. is_recording_duty distinguishes an express duty to record from a duty evidenced by records.';

CREATE TABLE schedule2_measures (
    code            TEXT PRIMARY KEY,
    description     TEXT NOT NULL
);

COMMENT ON TABLE schedule2_measures IS
    'Fire safety measures as defined by Fire (Scotland) Act 2005 sch.2 para 1, referenced by s.53(4). Wording is verbatim. Does not include process fire precautions (sch.2 para 2).';

-- ---------------------------------------------------------------------------
-- Premises and people
-- ---------------------------------------------------------------------------

CREATE TABLE premises (
    id                      SERIAL PRIMARY KEY,
    name                    TEXT NOT NULL,
    address_line1           TEXT,
    address_line2           TEXT,
    town                    TEXT,
    postcode                TEXT,
    duty_holder_name        TEXT,
    duty_holder_role        TEXT,
    employee_count          INTEGER,
    requires_licence        BOOLEAN NOT NULL DEFAULT FALSE,
    licence_details         TEXT,
    enforcing_authority     TEXT NOT NULL DEFAULT 'Scottish Fire and Rescue Service',
    is_multi_occupancy      BOOLEAN NOT NULL DEFAULT FALSE,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN premises.duty_holder_name IS
    'Employer, or other person with control of the premises: Fire (Scotland) Act 2005 ss.53-54.';
COMMENT ON COLUMN premises.employee_count IS
    'Drives the recording trigger in SSI 2006/456 regs 9 and 10(2): recording is required where 5 or more employees are employed.';
COMMENT ON COLUMN premises.enforcing_authority IS
    'Per Fire (Scotland) Act 2005 s.61. SFRS is the default for a workplace; HSE for construction sites and ships under construction or repair.';

CREATE TABLE people (
    id              SERIAL PRIMARY KEY,
    full_name       TEXT NOT NULL,
    job_title       TEXT,
    email           TEXT,
    phone           TEXT,
    is_employee     BOOLEAN NOT NULL DEFAULT TRUE,
    started_on      DATE,
    ended_on        DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE people IS
    'Employees and other named individuals referenced by training, role and at-risk records. Contains personal data subject to UK GDPR.';

CREATE TABLE safety_roles (
    id                      SERIAL PRIMARY KEY,
    premises_id             INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES people(id) ON DELETE RESTRICT,
    role                    TEXT NOT NULL CHECK (role IN (
                                'nominated_firefighting',
                                'competent_assistance',
                                'fire_warden',
                                'duty_holder',
                                'assessor')),
    appointed_on            DATE,
    ended_on                DATE,
    competence_evidence     TEXT,
    legal_basis_code        TEXT REFERENCES legal_basis(code),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE safety_roles IS
    'Appointments under SSI 2006/456 reg 12(3) (competent persons to implement fire-fighting measures) and reg 17 (safety assistance). Identities of nominated persons must be given to employees under reg 18.';

-- ---------------------------------------------------------------------------
-- Fire risk assessment — SSI 2006/456 regs 3, 8, 9
-- ---------------------------------------------------------------------------

CREATE TABLE fire_risk_assessments (
    id                              SERIAL PRIMARY KEY,
    premises_id                     INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    reference                       TEXT,
    assessment_type                 TEXT NOT NULL DEFAULT 'initial' CHECK (assessment_type IN (
                                        'initial', 'review', 'revision_after_change')),
    supersedes_id                   INTEGER REFERENCES fire_risk_assessments(id) ON DELETE SET NULL,
    carried_out_on                  DATE NOT NULL,
    carried_out_by_id               INTEGER REFERENCES people(id) ON DELETE SET NULL,
    assessor_external               TEXT,
    assessor_competence             TEXT,
    recorded_on                     DATE,
    next_review_due                 DATE,
    covers_young_persons            BOOLEAN NOT NULL DEFAULT FALSE,
    covers_dangerous_substances     BOOLEAN NOT NULL DEFAULT FALSE,
    status                          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                                        'draft', 'current', 'superseded')),
    summary                         TEXT,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fire_risk_assessments IS
    'Fire safety risk assessment required by Fire (Scotland) Act 2005 s.53(2)(a) / s.54(2)(a) and SSI 2006/456 reg 2. Reg 8 requires the significant findings to be recorded as soon as practicable after an assessment is carried out OR reviewed, so each review is a new row chained via supersedes_id rather than an edit in place.';
COMMENT ON COLUMN fire_risk_assessments.next_review_due IS
    'Review is required by SSI 2006/456 reg 3, but no review interval is prescribed by legislation. Any date here reflects local policy or guidance, not a statutory period.';
COMMENT ON COLUMN fire_risk_assessments.covers_young_persons IS
    'SSI 2006/456 regs 4-5 require particular regard to young persons; recorded via regs 8-9.';

CREATE TABLE fra_significant_findings (
    id                          SERIAL PRIMARY KEY,
    fire_risk_assessment_id     INTEGER NOT NULL REFERENCES fire_risk_assessments(id) ON DELETE CASCADE,
    finding                     TEXT NOT NULL,
    location                    TEXT,
    ignition_source             TEXT,
    fuel_source                 TEXT,
    persons_affected            TEXT,
    risk_rating                 TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fra_significant_findings IS
    'The "significant findings of the assessment" that SSI 2006/456 reg 9(a) requires to be recorded.';
COMMENT ON COLUMN fra_significant_findings.risk_rating IS
    'Free text. No rating scale is prescribed by Scottish fire safety legislation.';

CREATE TABLE fra_measures (
    id                          SERIAL PRIMARY KEY,
    finding_id                  INTEGER NOT NULL REFERENCES fra_significant_findings(id) ON DELETE CASCADE,
    schedule2_measure_code      TEXT REFERENCES schedule2_measures(code),
    description                 TEXT NOT NULL,
    status                      TEXT NOT NULL CHECK (status IN ('taken', 'planned')),
    responsible_person_id       INTEGER REFERENCES people(id) ON DELETE SET NULL,
    target_date                 DATE,
    completed_on                DATE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fra_measures IS
    'Measures recorded under SSI 2006/456 reg 9(a): "the measures which have been or will be taken". The status column preserves that statutory distinction between measures already taken and those planned.';

CREATE TABLE fra_persons_at_risk (
    id                          SERIAL PRIMARY KEY,
    fire_risk_assessment_id     INTEGER NOT NULL REFERENCES fire_risk_assessments(id) ON DELETE CASCADE,
    person_id                   INTEGER REFERENCES people(id) ON DELETE SET NULL,
    group_description           TEXT,
    category                    TEXT CHECK (category IN (
                                    'disabled', 'mobility_impaired', 'sensory_impaired',
                                    'young_person', 'lone_worker', 'visitor', 'contractor',
                                    'sleeping_occupant', 'expectant_mother', 'other')),
    why_at_risk                 TEXT,
    measures                    TEXT,
    peep_in_place               BOOLEAN NOT NULL DEFAULT FALSE,
    peep_reference              TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (person_id IS NOT NULL OR group_description IS NOT NULL)
);

COMMENT ON TABLE fra_persons_at_risk IS
    'Any relevant person or group identified as especially at risk from fire: SSI 2006/456 reg 9(b). May name an individual or describe a group. Where category indicates disability this is special category personal data under UK GDPR Art.9.';
COMMENT ON COLUMN fra_persons_at_risk.peep_in_place IS
    'Personal emergency evacuation plans are guidance and good practice, not a statutory requirement for workplaces in Great Britain.';

-- ---------------------------------------------------------------------------
-- Fire safety arrangements — SSI 2006/456 reg 10
-- ---------------------------------------------------------------------------

CREATE TABLE fire_safety_arrangements (
    id                          SERIAL PRIMARY KEY,
    premises_id                 INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    schedule2_measure_code      TEXT NOT NULL REFERENCES schedule2_measures(code),
    planning                    TEXT,
    organisation                TEXT,
    control                     TEXT,
    monitoring                  TEXT,
    review                      TEXT,
    responsible_person_id       INTEGER REFERENCES people(id) ON DELETE SET NULL,
    effective_from              DATE,
    superseded_by_id            INTEGER REFERENCES fire_safety_arrangements(id) ON DELETE SET NULL,
    recorded_on                 DATE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fire_safety_arrangements IS
    'Arrangements for the effective planning, organisation, control, monitoring and review of the fire safety measures, required by SSI 2006/456 reg 10(1) and recorded under reg 10(2). The five columns mirror the five aspects named in reg 10(1).';

-- ---------------------------------------------------------------------------
-- Dangerous substances — SSI 2006/456 regs 6-7 and sch.; DSEAR 2002
-- ---------------------------------------------------------------------------

CREATE TABLE dangerous_substances (
    id                              SERIAL PRIMARY KEY,
    premises_id                     INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    fire_risk_assessment_id         INTEGER REFERENCES fire_risk_assessments(id) ON DELETE SET NULL,
    name                            TEXT NOT NULL,
    quantity                        TEXT,
    location                        TEXT,
    hazardous_properties            TEXT,
    supplier_safety_data_ref        TEXT,
    ignition_sources                TEXT,
    explosive_atmosphere_likely     BOOLEAN NOT NULL DEFAULT FALSE,
    explosive_atmosphere_notes      TEXT,
    hazardous_area_classification   TEXT,
    area_marked                     BOOLEAN NOT NULL DEFAULT FALSE,
    assessed_on                     DATE,
    assessed_by_id                  INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE dangerous_substances IS
    'Dangerous substances present and their assessment: SSI 2006/456 regs 6-7 and the schedule (matters to be considered), and DSEAR 2002 reg 5, whose reg 5(4) imposes its own recording duty where 5 or more employees are employed.';
COMMENT ON COLUMN dangerous_substances.hazardous_area_classification IS
    'Zone classification and marking of hazardous places under DSEAR 2002 reg 7.';

-- ---------------------------------------------------------------------------
-- Equipment, escape routes and checks
-- Duties: SSI 2006/456 regs 12, 13, 16. Records are evidential.
-- ---------------------------------------------------------------------------

CREATE TABLE check_schedules (
    id                  SERIAL PRIMARY KEY,
    premises_id         INTEGER REFERENCES premises(id) ON DELETE CASCADE,
    applies_to          TEXT NOT NULL,
    check_type          TEXT NOT NULL,
    interval_days       INTEGER NOT NULL CHECK (interval_days > 0),
    recommended_by      TEXT,
    is_statutory        BOOLEAN NOT NULL DEFAULT FALSE,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE check_schedules IS
    'Configurable inspection and test intervals. No Scottish fire safety instrument prescribes any test, drill or inspection frequency, so every interval here derives from guidance or British Standard practice. recommended_by records that provenance and is_statutory should stay false unless a genuine statutory period is identified.';
COMMENT ON COLUMN check_schedules.premises_id IS
    'NULL means an organisation-wide default applying to all premises.';
COMMENT ON COLUMN check_schedules.applies_to IS
    'Target of the schedule, e.g. equipment_type:extinguisher, escape_route, fire_drill, training:refresher.';

CREATE TABLE equipment (
    id                          SERIAL PRIMARY KEY,
    premises_id                 INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    equipment_type              TEXT NOT NULL CHECK (equipment_type IN (
                                    'extinguisher', 'fire_blanket', 'hose_reel', 'sprinkler',
                                    'alarm_panel', 'call_point', 'detector', 'sounder',
                                    'emergency_lighting', 'fire_door', 'signage',
                                    'smoke_control', 'dry_riser', 'other')),
    schedule2_measure_code      TEXT REFERENCES schedule2_measures(code),
    identifier                  TEXT,
    location                    TEXT NOT NULL,
    make                        TEXT,
    model                       TEXT,
    serial_number               TEXT,
    installed_on                DATE,
    standard_reference          TEXT,
    in_service                  BOOLEAN NOT NULL DEFAULT TRUE,
    removed_on                  DATE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE equipment IS
    'Fire-fighting equipment, detection and warning systems, emergency lighting, doors and signage. Underlying duties: SSI 2006/456 reg 12 (means of fighting fire, detection and warning), reg 13(2)(g)-(h) (signs and emergency lighting) and reg 16 (suitable system of maintenance, kept in efficient working order).';
COMMENT ON COLUMN equipment.standard_reference IS
    'Applicable British Standard, e.g. BS 5839-1 for alarms, BS 5266-1 for emergency lighting. Standards are not law.';

CREATE TABLE equipment_checks (
    id                      SERIAL PRIMARY KEY,
    equipment_id            INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
    check_schedule_id       INTEGER REFERENCES check_schedules(id) ON DELETE SET NULL,
    check_type              TEXT NOT NULL,
    performed_on            DATE NOT NULL,
    performed_by_id         INTEGER REFERENCES people(id) ON DELETE SET NULL,
    performed_by_external   TEXT,
    outcome                 TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'pass_with_defects')),
    defects_found           TEXT,
    remedial_action         TEXT,
    remedied_on             DATE,
    next_due_on             DATE,
    certificate_reference   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE equipment_checks IS
    'Evidence of the maintenance system required by SSI 2006/456 reg 16. Reg 16 requires equipment to be maintained and in efficient working order but does not expressly require records to be kept.';

CREATE TABLE escape_routes (
    id                          SERIAL PRIMARY KEY,
    premises_id                 INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    name                        TEXT NOT NULL,
    description                 TEXT,
    final_exit                  TEXT,
    capacity                    INTEGER,
    travel_distance_m           NUMERIC(6,2),
    has_emergency_lighting      BOOLEAN NOT NULL DEFAULT FALSE,
    signage_notes               TEXT,
    in_service                  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE escape_routes IS
    'Emergency routes and exits under SSI 2006/456 reg 13, including the reg 13(2)(g) signing and reg 13(2)(h) emergency lighting requirements.';

CREATE TABLE escape_route_checks (
    id                      SERIAL PRIMARY KEY,
    escape_route_id         INTEGER NOT NULL REFERENCES escape_routes(id) ON DELETE CASCADE,
    check_schedule_id       INTEGER REFERENCES check_schedules(id) ON DELETE SET NULL,
    performed_on            DATE NOT NULL,
    performed_by_id         INTEGER REFERENCES people(id) ON DELETE SET NULL,
    obstructions_found      TEXT,
    outcome                 TEXT NOT NULL CHECK (outcome IN ('pass', 'fail', 'pass_with_defects')),
    remedial_action         TEXT,
    remedied_on             DATE,
    next_due_on             DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Emergency procedures, drills, training and information
-- Duties: SSI 2006/456 regs 14, 18, 20, 21
-- ---------------------------------------------------------------------------

CREATE TABLE emergency_procedures (
    id                  SERIAL PRIMARY KEY,
    premises_id         INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    procedure           TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    effective_from      DATE,
    superseded_by_id    INTEGER REFERENCES emergency_procedures(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE emergency_procedures IS
    'Procedures for action in the event of fire: SSI 2006/456 reg 14.';

CREATE TABLE fire_drills (
    id                          SERIAL PRIMARY KEY,
    premises_id                 INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    held_at                     TIMESTAMPTZ NOT NULL,
    scenario                    TEXT,
    evacuation_time_seconds     INTEGER,
    persons_participating       INTEGER,
    wardens_present             TEXT,
    issues_identified           TEXT,
    actions_taken               TEXT,
    conducted_by_id             INTEGER REFERENCES people(id) ON DELETE SET NULL,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE fire_drills IS
    'Evacuation drills evidencing the reg 14 emergency procedures and reg 20 training duties. Drill frequency is not set by legislation; Scottish Government guidance suggests at least annually, more often where circumstances warrant.';

CREATE TABLE training_records (
    id                      SERIAL PRIMARY KEY,
    premises_id             INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    person_id               INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    training_type           TEXT NOT NULL CHECK (training_type IN (
                                'induction', 'new_or_changed_risk', 'refresher',
                                'fire_warden', 'extinguisher_use', 'evacuation_aid', 'other')),
    delivered_on            DATE NOT NULL,
    delivered_by_id         INTEGER REFERENCES people(id) ON DELETE SET NULL,
    provider                TEXT,
    content_summary         TEXT,
    during_working_hours    BOOLEAN,
    next_due_on             DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE training_records IS
    'Fire safety training under SSI 2006/456 reg 20: on first employment, on new or changed risks, and repeated periodically when appropriate.';
COMMENT ON COLUMN training_records.during_working_hours IS
    'Reg 20 requires training to take place during working hours.';

CREATE TABLE employee_information_records (
    id                  SERIAL PRIMARY KEY,
    premises_id         INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    person_id           INTEGER REFERENCES people(id) ON DELETE SET NULL,
    group_description   TEXT,
    information_type    TEXT NOT NULL CHECK (information_type IN (
                            'risks_identified', 'preventive_measures',
                            'nominated_person_identities', 'dangerous_substances',
                            'emergency_procedures', 'other')),
    provided_on         DATE NOT NULL,
    method              TEXT,
    provided_by_id      INTEGER REFERENCES people(id) ON DELETE SET NULL,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (person_id IS NOT NULL OR group_description IS NOT NULL)
);

COMMENT ON TABLE employee_information_records IS
    'Information provided to employees under SSI 2006/456 reg 18, including the identities of persons nominated under reg 12(3).';

CREATE TABLE cooperation_records (
    id                      SERIAL PRIMARY KEY,
    premises_id             INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    other_duty_holder       TEXT NOT NULL,
    contact_details         TEXT,
    arrangements            TEXT,
    information_shared      TEXT,
    recorded_on             DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE cooperation_records IS
    'Co-operation and co-ordination with other duty holders in shared or multi-occupancy premises: SSI 2006/456 reg 21.';

-- ---------------------------------------------------------------------------
-- Health and safety policy — HSWA 1974 s.2(3)
-- ---------------------------------------------------------------------------

CREATE TABLE health_safety_policies (
    id                  SERIAL PRIMARY KEY,
    premises_id         INTEGER REFERENCES premises(id) ON DELETE CASCADE,
    statement           TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    effective_from      DATE,
    superseded_by_id    INTEGER REFERENCES health_safety_policies(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE health_safety_policies IS
    'Written statement of general policy on health and safety, required by Health and Safety at Work etc. Act 1974 s.2(3) where 5 or more employees are employed. NULL premises_id means an organisation-wide policy.';

-- ---------------------------------------------------------------------------
-- Incidents — RIDDOR 2013 reg 12 (the one hard statutory retention period)
-- ---------------------------------------------------------------------------

CREATE TABLE incidents (
    id                      SERIAL PRIMARY KEY,
    premises_id             INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    occurred_on             DATE NOT NULL,
    occurred_at_time        TIME,
    discovered_on           DATE,
    incident_type           TEXT NOT NULL CHECK (incident_type IN (
                                'fire', 'explosion', 'dangerous_occurrence',
                                'false_alarm', 'near_miss', 'injury', 'other')),
    location                TEXT,
    description             TEXT NOT NULL,
    persons_involved        TEXT,
    injuries                TEXT,
    cause                   TEXT,
    damage                  TEXT,
    fire_service_attended   BOOLEAN NOT NULL DEFAULT FALSE,
    riddor_reportable       BOOLEAN NOT NULL DEFAULT FALSE,
    riddor_reference        TEXT,
    riddor_reported_on      DATE,
    riddor_particulars      TEXT,
    actions_taken           TEXT,
    retain_until            DATE GENERATED ALWAYS AS (occurred_on + 1096) STORED,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE incidents IS
    'Fires, explosions and related events. Where reportable under RIDDOR 2013, reg 12 requires the particulars in sch.1 Pt.2 to be recorded and kept for at least three years.';
COMMENT ON COLUMN incidents.retain_until IS
    'Earliest date the record may be disposed of: three years from the incident per RIDDOR 2013 reg 12(3). This is the only retention period found in legislation; the three-year figure in Scottish Government guidance for other fire safety records is guidance, not law.';

-- ---------------------------------------------------------------------------
-- Enforcement — Fire (Scotland) Act 2005 ss.61-65
-- ---------------------------------------------------------------------------

CREATE TABLE enforcement_notices (
    id              SERIAL PRIMARY KEY,
    premises_id     INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    notice_type     TEXT NOT NULL CHECK (notice_type IN (
                        'alterations', 'enforcement', 'prohibition', 'other')),
    reference       TEXT,
    authority       TEXT,
    served_on       DATE NOT NULL,
    in_force        BOOLEAN NOT NULL DEFAULT TRUE,
    withdrawn_on    DATE,
    requirements    TEXT,
    response        TEXT,
    complied_on     DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE enforcement_notices IS
    'Notices served by the enforcing authority. An alterations notice in force is itself a trigger for the recording duties in SSI 2006/456 regs 9 and 10(2), via Fire (Scotland) Act 2005 s.65(6).';

CREATE TABLE enforcement_visits (
    id                      SERIAL PRIMARY KEY,
    premises_id             INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    authority               TEXT,
    officer_name            TEXT,
    visited_on              DATE NOT NULL,
    purpose                 TEXT,
    documents_provided      TEXT,
    findings                TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE enforcement_visits IS
    'Audits and inspections. Fire (Scotland) Act 2005 s.62(2) empowers officers to require, inspect, copy and remove documents and records relating to the Part 3 Chapter 1 duties.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX ON fire_risk_assessments (premises_id, status);
CREATE INDEX ON fra_significant_findings (fire_risk_assessment_id);
CREATE INDEX ON fra_measures (finding_id, status);
CREATE INDEX ON fra_persons_at_risk (fire_risk_assessment_id);
CREATE INDEX ON fire_safety_arrangements (premises_id, schedule2_measure_code);
CREATE INDEX ON dangerous_substances (premises_id);
CREATE INDEX ON equipment (premises_id, equipment_type) WHERE in_service;
CREATE INDEX ON equipment_checks (equipment_id, performed_on DESC);
CREATE INDEX ON equipment_checks (next_due_on) WHERE next_due_on IS NOT NULL;
CREATE INDEX ON escape_route_checks (escape_route_id, performed_on DESC);
CREATE INDEX ON fire_drills (premises_id, held_at DESC);
CREATE INDEX ON training_records (person_id, delivered_on DESC);
CREATE INDEX ON training_records (next_due_on) WHERE next_due_on IS NOT NULL;
CREATE INDEX ON safety_roles (premises_id, role) WHERE ended_on IS NULL;

-- One person cannot hold the same role at the same premises twice over
-- while both appointments are active; that is duplication, not a second
-- appointment. Enforced here as well as in application rules, so it holds
-- even if a row is inserted outside the API.
CREATE UNIQUE INDEX ON safety_roles (premises_id, person_id, role) WHERE ended_on IS NULL;
CREATE INDEX ON incidents (premises_id, occurred_on DESC);
CREATE INDEX ON enforcement_notices (premises_id) WHERE in_force;

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

CREATE VIEW premises_recording_duty AS
SELECT
    p.id AS premises_id,
    p.name,
    p.employee_count,
    (p.employee_count >= 5)         AS trigger_five_or_more_employees,
    p.requires_licence              AS trigger_licensed_premises,
    EXISTS (
        SELECT 1 FROM enforcement_notices n
        WHERE n.premises_id = p.id
          AND n.notice_type = 'alterations'
          AND n.in_force
    )                               AS trigger_alterations_notice,
    (
        COALESCE(p.employee_count, 0) >= 5
        OR p.requires_licence
        OR EXISTS (
            SELECT 1 FROM enforcement_notices n
            WHERE n.premises_id = p.id
              AND n.notice_type = 'alterations'
              AND n.in_force
        )
    )                               AS recording_duty_applies
FROM premises p;

COMMENT ON VIEW premises_recording_duty IS
    'Whether the duties to record in SSI 2006/456 regs 9 and 10(2) are engaged for each premises, and which of the three statutory triggers applies. Note the duty to carry out an assessment applies regardless; only the duty to record it is conditional.';

CREATE VIEW current_fire_risk_assessments AS
SELECT
    fra.*,
    p.name AS premises_name
FROM fire_risk_assessments fra
JOIN premises p ON p.id = fra.premises_id
WHERE fra.status = 'current';

-- ---------------------------------------------------------------------------
-- Row level security
--
-- These tables hold personal data, including special category data where a
-- person is recorded as at risk by reason of disability. The Supabase project
-- exposes new tables through its Data API, so RLS is enabled on every table
-- with no policies: that denies all access via the anon and authenticated
-- keys. The backend connects as the table owner over Postgres directly and is
-- unaffected. Add explicit policies only if the Data API is ever needed.
-- ---------------------------------------------------------------------------

ALTER TABLE legal_basis                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule2_measures              ENABLE ROW LEVEL SECURITY;
ALTER TABLE premises                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE people                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_roles                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_risk_assessments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fra_significant_findings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fra_measures                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fra_persons_at_risk             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_safety_arrangements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dangerous_substances            ENABLE ROW LEVEL SECURITY;
ALTER TABLE check_schedules                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment_checks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE escape_routes                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE escape_route_checks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_procedures            ENABLE ROW LEVEL SECURITY;
ALTER TABLE fire_drills                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_records                ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_information_records    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cooperation_records             ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_safety_policies          ENABLE ROW LEVEL SECURITY;
ALTER TABLE incidents                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement_notices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE enforcement_visits              ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Seed: statutory reference data
-- ---------------------------------------------------------------------------

INSERT INTO schedule2_measures (code, description) VALUES
    ('a', 'measures to reduce the risk of fire in relevant premises and the risk of the spread of fire there'),
    ('b', 'measures in relation to the means of escape from relevant premises'),
    ('c', 'measures for securing that means of escape can be safely and effectively used'),
    ('d', 'measures in relation to means of fighting fires in relevant premises'),
    ('e', 'measures in relation to detecting fires and giving warning of fire or suspected fire'),
    ('f', 'measures in relation to the arrangements for action in the event of fire, including instruction and training of employees and mitigation of the effects of fire'),
    ('g', 'such other measures as may be prescribed by the Scottish Ministers by regulations');

INSERT INTO legal_basis (code, instrument, provision, duty, is_recording_duty, applies_when, source_url) VALUES
    ('FSA2005_s53', 'Fire (Scotland) Act 2005', 's.53', 'Employer duty to carry out a fire safety risk assessment and take the fire safety measures in schedule 2', FALSE, 'All employers in relevant premises', 'https://www.legislation.gov.uk/asp/2005/5/part/3'),
    ('FSA2005_s54', 'Fire (Scotland) Act 2005', 's.54', 'Duties of any person having control of relevant premises', FALSE, 'Persons with control to any extent', 'https://www.legislation.gov.uk/asp/2005/5/part/3'),
    ('FSA2005_s62', 'Fire (Scotland) Act 2005', 's.62(2)', 'Enforcement officers may require, inspect, copy and remove records relating to the Part 3 Chapter 1 duties', FALSE, 'On demand by the enforcing authority', 'https://www.legislation.gov.uk/asp/2005/5/section/62'),
    ('FSSR2006_r3', 'Fire Safety (Scotland) Regulations 2006', 'reg 3', 'Duty to review the risk assessment', FALSE, 'Where circumstances change; no interval prescribed', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r8', 'Fire Safety (Scotland) Regulations 2006', 'reg 8', 'Duty to record as soon as practicable after an assessment is carried out or reviewed', TRUE, '5+ employees, or licensed/registered premises, or an alterations notice in force', 'https://www.legislation.gov.uk/ssi/2006/456/regulation/8/made'),
    ('FSSR2006_r9a', 'Fire Safety (Scotland) Regulations 2006', 'reg 9(a)', 'Record the significant findings, including the measures which have been or will be taken', TRUE, 'As for reg 8', 'https://www.legislation.gov.uk/ssi/2006/456/regulation/8/made'),
    ('FSSR2006_r9b', 'Fire Safety (Scotland) Regulations 2006', 'reg 9(b)', 'Record any relevant person or group identified as especially at risk from fire', TRUE, 'As for reg 8', 'https://www.legislation.gov.uk/ssi/2006/456/regulation/8/made'),
    ('FSSR2006_r10', 'Fire Safety (Scotland) Regulations 2006', 'reg 10', 'Arrangements for the effective planning, organisation, control, monitoring and review of the fire safety measures, and duty to record them', TRUE, 'Recording per reg 10(2): as for reg 8', 'https://www.legislation.gov.uk/ssi/2006/456/regulation/10/made'),
    ('FSSR2006_r12', 'Fire Safety (Scotland) Regulations 2006', 'reg 12', 'Means of fighting fire, and detection and warning; reg 12(3) nomination of competent persons', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r13', 'Fire Safety (Scotland) Regulations 2006', 'reg 13', 'Emergency routes and exits, including signage (13(2)(g)) and emergency lighting (13(2)(h))', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r14', 'Fire Safety (Scotland) Regulations 2006', 'reg 14', 'Procedures for action in the event of fire', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r16', 'Fire Safety (Scotland) Regulations 2006', 'reg 16', 'Premises and equipment subject to a suitable system of maintenance and kept in efficient working order', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r17', 'Fire Safety (Scotland) Regulations 2006', 'reg 17', 'Appointment of competent persons to assist with safety measures', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r18', 'Fire Safety (Scotland) Regulations 2006', 'reg 18', 'Information to employees, including identities of nominated persons', FALSE, 'All relevant premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r20', 'Fire Safety (Scotland) Regulations 2006', 'reg 20', 'Fire safety training on first employment, on new or changed risks, during working hours, repeated periodically when appropriate', FALSE, 'All employees', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('FSSR2006_r21', 'Fire Safety (Scotland) Regulations 2006', 'reg 21', 'Co-operation and co-ordination between duty holders in shared premises', FALSE, 'Multi-occupancy premises', 'https://www.legislation.gov.uk/ssi/2006/456/contents/made'),
    ('HSWA1974_s2_3', 'Health and Safety at Work etc. Act 1974', 's.2(3)', 'Written statement of general policy on health and safety', TRUE, '5 or more employees', 'https://www.legislation.gov.uk/ukpga/1974/37/section/2'),
    ('DSEAR2002_r5', 'Dangerous Substances and Explosive Atmospheres Regulations 2002', 'reg 5', 'Risk assessment for dangerous substances; reg 5(4) requires it to be recorded', TRUE, 'reg 5(4): 5 or more employees', 'https://www.legislation.gov.uk/uksi/2002/2776/regulation/5'),
    ('DSEAR2002_r7', 'Dangerous Substances and Explosive Atmospheres Regulations 2002', 'reg 7', 'Classification and marking of hazardous places', FALSE, 'Where explosive atmospheres may occur', 'https://www.legislation.gov.uk/uksi/2002/2776'),
    ('RIDDOR2013_r12', 'Reporting of Injuries, Diseases and Dangerous Occurrences Regulations 2013', 'reg 12', 'Record the sch.1 Pt.2 particulars of reportable incidents and keep them for at least three years', TRUE, 'Reportable incidents, including fire and explosion dangerous occurrences', 'https://www.legislation.gov.uk/uksi/2013/1471/regulation/12');
