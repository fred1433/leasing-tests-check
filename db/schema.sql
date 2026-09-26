-- Synthetic leasing demonstrator. Every row carries run_id so a test run can
-- find and remove exactly its own data, even after a failure halfway through.
CREATE TABLE IF NOT EXISTS app_clock (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  frozen_at timestamptz
);
INSERT INTO app_clock (id, frozen_at) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS units (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  label text NOT NULL,
  address text NOT NULL,
  tenant_name text NOT NULL,
  tenant_email text NOT NULL,
  tenant_phone text NOT NULL,
  -- Section 26(3) prerequisite: a notice of termination given, or an agreement to terminate.
  termination_basis text CHECK (termination_basis IN ('tenant_notice', 'landlord_notice', 'agreement')),
  lease_end date,
  -- Rule 3.1: email is a service method only with the tenant's written consent.
  email_service_consent boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS showings (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  unit_id bigint NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  prospect_name text NOT NULL,
  prospect_email text NOT NULL,
  agent_email text NOT NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 30,
  status text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled')),
  version int NOT NULL DEFAULT 1,
  created_by text NOT NULL
);
-- One key per rendered booking form: a repeated submission of the same form books nothing new.
ALTER TABLE showings ADD COLUMN IF NOT EXISTS request_key text;
CREATE UNIQUE INDEX IF NOT EXISTS showings_request_key ON showings (request_key);

CREATE TABLE IF NOT EXISTS notification_jobs (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  showing_id bigint NOT NULL REFERENCES showings(id) ON DELETE CASCADE,
  showing_version int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tenant_sms', 'tenant_email', 'calendar_event')),
  payload jsonb NOT NULL,
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'sent', 'superseded', 'blocked', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 4,
  last_error text,
  locked_at timestamptz,
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS notification_jobs_due ON notification_jobs (status, run_at);

-- What the application attempted to hand to a provider, rendered in full.
-- It proves the attempt and its content, never delivery or lawful service.
CREATE TABLE IF NOT EXISTS outbound_captures (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  job_id bigint UNIQUE,
  channel text NOT NULL,
  recipients text[] NOT NULL,
  payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

-- Refusals at the sending boundary, kept as evidence.
CREATE TABLE IF NOT EXISTS outbound_refusals (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL,
  job_id bigint,
  channel text NOT NULL,
  reason text NOT NULL,
  refused_at timestamptz NOT NULL DEFAULT now()
);

-- Test-only fault injection: the capture transport fails N times for a job kind.
CREATE TABLE IF NOT EXISTS transport_faults (
  run_id text NOT NULL,
  kind text NOT NULL,
  remaining int NOT NULL,
  PRIMARY KEY (run_id, kind)
);
