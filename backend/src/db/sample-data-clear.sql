-- Removes the sample data inserted by sample-data.sql, and nothing else.
--
-- Deletion is scoped to the exact fictional premises and people names the
-- sample uses, so real records are untouched. Deleting a premises cascades
-- to its assessments, equipment, checks, drills, training, incidents and
-- notices. People are removed afterwards, once the safety_roles rows that
-- reference them (ON DELETE RESTRICT) have gone with their premises.

DELETE FROM premises WHERE name IN (
    'Riverside House',
    'Clyde Street Depot',
    'Ardrossan Workshop',
    'Oban Store',
    'Mull Outstation'
);

DELETE FROM people WHERE full_name IN (
    'Fiona Muir',
    'Callum Reid',
    'Aisha Khan',
    'Tom Blackwood',
    'Grace Lennox',
    'Struan Bain',
    'Priya Nair',
    'Douglas Hay'
);

-- Organisation-wide check schedules have no premises to cascade from, so
-- they are identified by this marker in the notes column.
DELETE FROM check_schedules
WHERE premises_id IS NULL
  AND notes LIKE '[sample data]%';
