-- Authentication, authorisation and audit tables.
--
-- Run this after schema.sql. It is additive: it creates nothing that
-- schema.sql already defines, and drops nothing.
--
-- The API is the only route to the data. It connects to Postgres as the table
-- owner, so row level security (enabled with no policies in schema.sql) does
-- not restrict it; access control is enforced in the API instead, using the
-- tables below. See src/auth/ and src/http/authorise.js.
--
-- Personal data note: users.email and users.full_name are personal data, and
-- linking a user to a person via users.person_id joins the account to the
-- fire safety record. Passwords are never stored, only scrypt hashes.

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id                      SERIAL PRIMARY KEY,
    email                   TEXT NOT NULL,
    password_hash           TEXT NOT NULL,
    full_name               TEXT NOT NULL,
    role                    TEXT NOT NULL CHECK (role IN (
                                'admin', 'manager', 'assessor', 'viewer')),
    person_id               INTEGER REFERENCES people(id) ON DELETE SET NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
    locked_until            TIMESTAMPTZ,
    last_login_at           TIMESTAMPTZ,
    password_changed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE users IS
    'API accounts. Authentication is required for every endpoint except /api/health and /api/auth/login.';
COMMENT ON COLUMN users.role IS
    'Global role. admin: everything, including user administration and all premises. manager: full record management on assigned premises. assessor: may create and amend records on assigned premises but not delete them. viewer: read only.';
COMMENT ON COLUMN users.person_id IS
    'Optional link to the person in the fire safety record, so an account can be tied to a named duty holder or fire warden.';
COMMENT ON COLUMN users.locked_until IS
    'Set by the login handler after repeated failures. Cleared on a successful login.';
COMMENT ON COLUMN users.password_changed_at IS
    'Access tokens issued before this instant are rejected, so a password change logs every session out.';

-- Case-insensitive uniqueness without requiring the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- ---------------------------------------------------------------------------
-- Premises scoping
--
-- Non-admin users see only the premises listed here. An admin ignores this
-- table entirely. A manager, assessor or viewer with no rows here can read
-- nothing, which is the safe default for a newly created account.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_premises (
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    premises_id     INTEGER NOT NULL REFERENCES premises(id) ON DELETE CASCADE,
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    granted_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    PRIMARY KEY (user_id, premises_id)
);

COMMENT ON TABLE user_premises IS
    'Which premises each non-admin account may access. Enforced on every read and write, including nested records reached through a parent row.';

-- ---------------------------------------------------------------------------
-- Refresh tokens
--
-- The access token is a short-lived JWT held in memory by the client. The
-- refresh token is opaque, sent only in an httpOnly cookie, stored here as a
-- SHA-256 hash, and rotated on every use. Reuse of an already-rotated token
-- indicates theft, so the whole family is revoked.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      TEXT NOT NULL UNIQUE,
    family_id       UUID NOT NULL,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT,
    replaced_by_id  INTEGER REFERENCES refresh_tokens(id) ON DELETE SET NULL,
    user_agent      TEXT,
    ip_address      TEXT
);

COMMENT ON TABLE refresh_tokens IS
    'One row per issued refresh token, stored as a SHA-256 hash so the database never holds a usable token.';
COMMENT ON COLUMN refresh_tokens.family_id IS
    'Groups the chain of tokens descending from one login, so a detected reuse can revoke the whole chain.';

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
    ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS refresh_tokens_family_idx
    ON refresh_tokens (family_id);

-- ---------------------------------------------------------------------------
-- Audit log
--
-- Every write, every authentication event and every refused request is
-- recorded. Fire safety records are evidence, so who changed what and when is
-- part of the record.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_email      TEXT,
    action          TEXT NOT NULL,
    resource        TEXT,
    resource_id     TEXT,
    premises_id     INTEGER,
    outcome         TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
    request_id      TEXT,
    ip_address      TEXT,
    detail          JSONB
);

COMMENT ON TABLE audit_log IS
    'Append-only record of authentication events, refused requests and every create, update and delete. user_email is denormalised so the trail survives deletion of the account.';
COMMENT ON COLUMN audit_log.detail IS
    'Changed fields and other context. Never contains passwords, tokens or full row contents.';

CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_resource_idx ON audit_log (resource, resource_id);
CREATE INDEX IF NOT EXISTS audit_log_premises_idx ON audit_log (premises_id, occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Row level security, as in schema.sql: enabled with no policies, so the
-- Supabase Data API cannot reach these tables with the anon or authenticated
-- key. The API's own connection is the table owner and is unaffected.
-- ---------------------------------------------------------------------------

ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_premises   ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;
