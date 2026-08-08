-- Authorization codes for the mcp-server OAuth shim (see supabase/functions/
-- mcp-server/oauth.ts). This is not a real second credential — /token just
-- exchanges a redeemed code for the same static MCP_API_KEY — so this table
-- only needs to survive the few minutes between /authorize and /token across
-- what are likely different Edge Function cold starts (no in-memory option).
-- service_role only, same pattern as internal_heartbeat (schema.sql:153-166,
-- 767-771, 815-816).

create table public.mcp_oauth_codes (
  code text primary key,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.mcp_oauth_codes enable row level security;

create policy mcp_oauth_codes_service_role_only on public.mcp_oauth_codes
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.mcp_oauth_codes from anon, authenticated;
grant select, insert, update on public.mcp_oauth_codes to service_role;
