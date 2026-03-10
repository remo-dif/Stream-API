-- ============================================================
-- AI SaaS Database Schema
-- Run this against your Supabase project SQL editor.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Tenants
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          VARCHAR(255) NOT NULL,
  plan          VARCHAR(50)  NOT NULL DEFAULT 'starter',
  token_quota   BIGINT       NOT NULL DEFAULT 1000000,
  tokens_used   BIGINT       NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  settings      JSONB        DEFAULT '{}',
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- user_profiles
--
-- Application-level user data linked to Supabase auth.users.
-- DO NOT store passwords here — authentication is handled by Supabase Auth.
-- The id is the same UUID as auth.users.id (foreign key across schemas).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id          UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id   UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       VARCHAR(320) NOT NULL,
  role        VARCHAR(50)  NOT NULL DEFAULT 'user',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  metadata    JSONB        DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant ON user_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_email  ON user_profiles(email);

-- ============================================================
-- Conversations
-- ============================================================
CREATE TABLE IF NOT EXISTS conversations (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID         NOT NULL REFERENCES auth.users(id)  ON DELETE CASCADE,
  tenant_id   UUID         NOT NULL REFERENCES tenants(id)     ON DELETE CASCADE,
  title       VARCHAR(500),
  model       VARCHAR(100) DEFAULT 'claude-3-5-sonnet-20241022',
  is_archived BOOLEAN      DEFAULT false,
  metadata    JSONB        DEFAULT '{}',
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_user    ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant  ON conversations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);

-- ============================================================
-- Messages
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT        NOT NULL,
  tokens           INTEGER,
  metadata         JSONB       DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created      ON messages(created_at);

-- ============================================================
-- Usage Logs
-- ============================================================
CREATE TABLE IF NOT EXISTS usage_logs (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  UUID        REFERENCES conversations(id) ON DELETE SET NULL,
  model            VARCHAR(100) NOT NULL,
  input_tokens     INTEGER     NOT NULL DEFAULT 0,
  output_tokens    INTEGER     NOT NULL DEFAULT 0,
  total_tokens     INTEGER     NOT NULL DEFAULT 0,
  latency_ms       INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant ON usage_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_user   ON usage_logs(user_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_date   ON usage_logs(created_at DESC);

-- ============================================================
-- Async Jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS async_jobs (
  id           VARCHAR(255) PRIMARY KEY,
  user_id      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_type     VARCHAR(100) NOT NULL,
  status       VARCHAR(50)  NOT NULL DEFAULT 'queued',
  result       JSONB,
  error        TEXT,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_tenant ON async_jobs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON async_jobs(status);

-- ============================================================
-- Functions
-- ============================================================

-- Atomically increment a tenant's tokens_used counter.
-- Called by AIService.logUsage() after every AI completion.
CREATE OR REPLACE FUNCTION increment_tenant_tokens(
  p_tenant_id UUID,
  p_tokens    INTEGER
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE tenants
  SET    tokens_used = tokens_used + p_tokens,
         updated_at  = NOW()
  WHERE  id = p_tenant_id;
$$;

-- Aggregate usage stats for a tenant over a time window.
-- Called by UsageService.getDashboard() — avoids loading all rows into Node.
CREATE OR REPLACE FUNCTION get_usage_summary(
  p_tenant_id UUID,
  p_since     TIMESTAMPTZ
)
RETURNS TABLE (
  total_tokens  BIGINT,
  input_tokens  BIGINT,
  output_tokens BIGINT,
  request_count BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    COALESCE(SUM(total_tokens),  0)::BIGINT AS total_tokens,
    COALESCE(SUM(input_tokens),  0)::BIGINT AS input_tokens,
    COALESCE(SUM(output_tokens), 0)::BIGINT AS output_tokens,
    COUNT(*)                                ::BIGINT AS request_count
  FROM  usage_logs
  WHERE tenant_id  = p_tenant_id
    AND created_at >= p_since;
$$;

-- ============================================================
-- Row Level Security (RLS)
-- Enable RLS on all public tables. Use admin client (service role)
-- in the backend to bypass RLS for cross-tenant admin operations.
-- ============================================================
ALTER TABLE tenants       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE async_jobs     ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "users_read_own_profile"
  ON user_profiles FOR SELECT
  USING (auth.uid() = id);

-- Users can read conversations in their tenant
CREATE POLICY "users_read_own_conversations"
  ON conversations FOR SELECT
  USING (auth.uid() = user_id);

-- Users can read messages in their own conversations
CREATE POLICY "users_read_own_messages"
  ON messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = messages.conversation_id
        AND c.user_id = auth.uid()
    )
  );

-- ============================================================
-- Seed data (idempotent)
-- ============================================================
INSERT INTO tenants (id, name, plan, token_quota)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org', 'enterprise', 10000000)
ON CONFLICT DO NOTHING;
