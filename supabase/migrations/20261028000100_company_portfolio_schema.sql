-- M1 schema checkpoint: company-first tenant foundation.
-- This file defines tables and constraints only. RLS is enabled immediately
-- and has no policies until the separately reviewed next migration.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  constraint profiles_display_name_length check (display_name is null or char_length(display_name) <= 160)
);

create table public.client_portfolios (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint client_portfolios_name_not_blank check (char_length(btrim(name)) between 1 and 200)
);

create table public.portfolio_memberships (
  portfolio_id uuid not null references public.client_portfolios (id) on delete restrict,
  user_id uuid not null references public.profiles (id) on delete restrict,
  role text not null check (role in ('PORTFOLIO_ADMIN', 'OVERALL_HR_MANAGER', 'BRANCH_MANAGER', 'PAYROLL_PROCESSOR')),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (portfolio_id, user_id, role)
);

create index portfolio_memberships_user_active_idx
  on public.portfolio_memberships (user_id, portfolio_id, role)
  where revoked_at is null;

create table public.platform_administrators (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.client_portfolios (id) on delete restrict,
  name text not null,
  registration_number text not null,
  tpin text not null,
  industry text not null,
  business_email text not null,
  phone text not null,
  province text not null,
  town text not null,
  physical_address text not null,
  contact_person text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'PENDING')),
  created_at timestamptz not null default now(),
  constraint companies_portfolio_id_id_key unique (portfolio_id, id),
  constraint companies_portfolio_registration_key unique (portfolio_id, registration_number),
  constraint companies_name_not_blank check (char_length(btrim(name)) between 1 and 240)
);

create index companies_portfolio_name_idx on public.companies (portfolio_id, name, id);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  name text not null,
  code text not null,
  province text not null,
  town text not null,
  physical_address text not null,
  manager_name text,
  contact_phone text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE', 'PENDING')),
  created_at timestamptz not null default now(),
  constraint branches_company_tenant_fk
    foreign key (portfolio_id, company_id)
    references public.companies (portfolio_id, id) on delete restrict,
  constraint branches_portfolio_company_id_key unique (portfolio_id, company_id, id),
  constraint branches_company_code_key unique (company_id, code),
  constraint branches_name_not_blank check (char_length(btrim(name)) between 1 and 200)
);

create index branches_tenant_company_name_idx
  on public.branches (portfolio_id, company_id, name, id);

create table public.branch_assignments (
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('BRANCH_MANAGER', 'PAYROLL_PROCESSOR')),
  assigned_by uuid references public.profiles (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (portfolio_id, branch_id, user_id, role),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches (portfolio_id, company_id, id) on delete restrict,
  foreign key (portfolio_id, user_id, role)
    references public.portfolio_memberships (portfolio_id, user_id, role) on delete restrict
);

create index branch_assignments_user_active_idx
  on public.branch_assignments (user_id, portfolio_id, company_id, branch_id, role)
  where revoked_at is null;

-- Fail closed before policies are installed in the next migration.
alter table public.profiles enable row level security;
alter table public.client_portfolios enable row level security;
alter table public.portfolio_memberships enable row level security;
alter table public.platform_administrators enable row level security;
alter table public.companies enable row level security;
alter table public.branches enable row level security;
alter table public.branch_assignments enable row level security;

revoke all on table public.profiles, public.client_portfolios, public.portfolio_memberships,
  public.platform_administrators, public.companies, public.branches, public.branch_assignments
  from public, anon, authenticated;

comment on table public.client_portfolios is 'Internal customer/account boundary; companies remain the highest business entity exposed in product UI.';
comment on table public.platform_administrators is 'Explicit platform-wide grants. No client role or user metadata can create these grants.';
comment on table public.branch_assignments is 'Explicit branch-scoped roles. A portfolio role alone does not grant branch-manager/payroll-processor access.';

