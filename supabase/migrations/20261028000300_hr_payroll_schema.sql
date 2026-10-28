-- M3 schema checkpoint: tenant-bound HR and payroll records.
-- Schema only: all tables are revoked and RLS-enabled. No migration is applied
-- automatically by the application. Write workflows are added separately.

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  workplace_branch_id uuid not null,
  employee_number text not null,
  first_name text not null,
  middle_name text,
  last_name text not null,
  date_of_birth date not null,
  gender text check (gender is null or gender in ('FEMALE', 'MALE', 'NON_BINARY', 'UNDISCLOSED')),
  nationality text not null,
  job_title text not null,
  department text not null,
  employment_type text not null check (employment_type in ('PERMANENT', 'FIXED_TERM', 'PART_TIME', 'CASUAL', 'DAILY_RATED')),
  contract_type text not null,
  contract_start_date date not null,
  contract_end_date date,
  retirement_age integer not null default 65 check (retirement_age between 18 and 100),
  retirement_status text not null default 'NOT_RETIRED' check (retirement_status in ('NOT_RETIRED', 'RETIRED')),
  approval_status text not null default 'DRAFT' check (approval_status in ('DRAFT', 'SUBMITTED_FOR_HR_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, company_id, id),
  unique (portfolio_id, company_id, workplace_branch_id, id),
  unique (company_id, employee_number),
  foreign key (portfolio_id, company_id, workplace_branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict,
  check (contract_end_date is null or contract_end_date >= contract_start_date),
  check (approval_status <> 'SUBMITTED_FOR_HR_APPROVAL' or submitted_at is not null),
  check (approval_status not in ('APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION') or (reviewed_at is not null and reviewed_by is not null))
);
create index employees_tenant_branch_status_idx
  on public.employees(portfolio_id, company_id, workplace_branch_id, approval_status, last_name, id);

create table public.employee_private_details (
  employee_id uuid primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  identity_document_type text,
  identity_document_number text,
  residential_address text not null,
  phone text not null,
  email text,
  email_unavailable_reason text,
  emergency_contact_name text not null,
  emergency_contact_relationship text not null,
  emergency_contact_phone text not null,
  tpin text,
  napsa_number text,
  nhima_number text,
  payment_method text not null check (payment_method in ('BANK_TRANSFER', 'MOBILE_MONEY', 'CASH')),
  bank_name text,
  bank_account_name text,
  bank_account_number text,
  bank_branch_name text,
  mobile_money_provider text,
  mobile_money_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, employee_id)
    references public.employees(portfolio_id, company_id, id) on delete cascade,
  check ((email is not null) <> (email_unavailable_reason is not null)),
  check (payment_method <> 'BANK_TRANSFER' or (bank_name is not null and bank_account_name is not null and bank_account_number is not null)),
  check (payment_method <> 'MOBILE_MONEY' or (mobile_money_provider is not null and mobile_money_number is not null))
);

create table public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  workplace_branch_id uuid not null,
  employee_id uuid not null,
  effective_from date not null,
  effective_to date,
  salary_frequency text not null check (salary_frequency in ('MONTHLY', 'FORTNIGHTLY', 'WEEKLY', 'DAILY')),
  basic_pay numeric(14,2) not null check (basic_pay >= 0),
  housing_allowance numeric(14,2) not null default 0 check (housing_allowance >= 0),
  meal_allowance numeric(14,2) not null default 0 check (meal_allowance >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  other_allowances numeric(14,2) not null default 0 check (other_allowances >= 0),
  overtime_eligible boolean not null default false,
  allowance_tax_treatment jsonb not null default '{}',
  payment_method text not null check (payment_method in ('BANK_TRANSFER', 'MOBILE_MONEY', 'CASH')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, workplace_branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (effective_to is null or effective_to >= effective_from),
  check (jsonb_typeof(allowance_tax_treatment) = 'object')
);
create index employee_compensation_asof_idx
  on public.employee_compensation(portfolio_id, company_id, employee_id, effective_from desc, effective_to);

create table public.employee_approval_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('DRAFT_CREATED', 'SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED_FOR_CORRECTION', 'RESUBMITTED')),
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict
);
create index employee_approval_history_employee_idx
  on public.employee_approval_history(portfolio_id, company_id, branch_id, employee_id, occurred_at desc);

create table public.attendance_periods (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'LOCKED')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (portfolio_id, company_id, branch_id, id),
  unique (portfolio_id, company_id, branch_id, period_start, period_end),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict,
  check (period_end >= period_start)
);

create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  attendance_period_id uuid not null,
  employee_id uuid not null,
  scheduled_working_days numeric(6,2) not null check (scheduled_working_days >= 0),
  actual_days_worked numeric(6,2) not null check (actual_days_worked >= 0),
  paid_leave_days numeric(6,2) not null default 0 check (paid_leave_days >= 0),
  unpaid_leave_days numeric(6,2) not null default 0 check (unpaid_leave_days >= 0),
  other_payable_absence_days numeric(6,2) not null default 0 check (other_payable_absence_days >= 0),
  contract_type text not null,
  created_at timestamptz not null default now(),
  unique (attendance_period_id, employee_id),
  foreign key (portfolio_id, company_id, branch_id, attendance_period_id)
    references public.attendance_periods(portfolio_id, company_id, branch_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (actual_days_worked + paid_leave_days + unpaid_leave_days + other_payable_absence_days <= scheduled_working_days)
);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  leave_type text not null,
  pay_classification text not null check (pay_classification in ('PAID', 'UNPAID')),
  start_date date not null,
  end_date date not null,
  leave_days numeric(6,2) not null check (leave_days > 0),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELED')),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (end_date >= start_date),
  check ((status in ('APPROVED', 'REJECTED')) = (reviewed_at is not null))
);
create index leave_requests_tenant_period_idx
  on public.leave_requests(portfolio_id, company_id, branch_id, status, start_date, end_date);

create table public.employee_deductions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  deduction_type text not null check (deduction_type in ('EMPLOYEE_LOAN', 'SALARY_ADVANCE', 'MEDICAL_ADVANCE', 'EDUCATIONAL_ADVANCE', 'OTHER_ADVANCE', 'OTHER_AUTHORIZED')),
  principal_amount numeric(14,2) not null check (principal_amount > 0),
  repayment_method text not null check (repayment_method in ('ONE_TIME', 'FIXED_RECURRING', 'EQUAL_INSTALLMENTS', 'MANUAL_SCHEDULE')),
  requested_installments integer,
  fixed_installment_amount numeric(14,2),
  start_period date not null,
  installment_frequency text not null default 'MONTHLY' check (installment_frequency in ('WEEKLY', 'FORTNIGHTLY', 'MONTHLY')),
  amount_deducted numeric(14,2) not null default 0 check (amount_deducted >= 0 and amount_deducted <= principal_amount),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'PAUSED', 'CANCELED')),
  initiated_by uuid not null references public.profiles(id) on delete restrict,
  idempotency_key text not null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  reason text not null,
  consent_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, company_id, branch_id, id),
  unique (portfolio_id, company_id, branch_id, employee_id, id),
  unique (initiated_by, idempotency_key),
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (requested_installments is null or requested_installments > 0),
  check (fixed_installment_amount is null or fixed_installment_amount > 0),
  check (repayment_method <> 'EQUAL_INSTALLMENTS' or requested_installments is not null),
  check (repayment_method <> 'FIXED_RECURRING' or fixed_installment_amount is not null),
  check ((status in ('APPROVED', 'ACTIVE', 'COMPLETED', 'PAUSED')) = (approved_at is not null and approved_by is not null))
);
create index employee_deductions_due_idx
  on public.employee_deductions(portfolio_id, company_id, branch_id, status, start_period, employee_id);

create table public.deduction_approval_history (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  deduction_id uuid not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('SUBMITTED', 'APPROVED', 'REJECTED', 'PAUSED', 'RESUMED', 'SETTLED', 'REVERSED')),
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, deduction_id)
    references public.employee_deductions(portfolio_id, company_id, branch_id, id) on delete restrict
);
create index deduction_approval_history_lookup_idx
  on public.deduction_approval_history(portfolio_id, company_id, branch_id, deduction_id, occurred_at desc);

create table public.deduction_installments (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  deduction_id uuid not null,
  sequence_number integer not null check (sequence_number > 0),
  due_period date not null,
  scheduled_amount numeric(14,2) not null check (scheduled_amount > 0),
  created_at timestamptz not null default now(),
  unique (deduction_id, sequence_number),
  unique (deduction_id, due_period),
  unique (portfolio_id, company_id, branch_id, deduction_id, id),
  unique (portfolio_id, company_id, branch_id, employee_id, deduction_id, id),
  foreign key (portfolio_id, company_id, branch_id, employee_id, deduction_id)
    references public.employee_deductions(portfolio_id, company_id, branch_id, employee_id, id) on delete restrict
);
create index deduction_installments_due_idx
  on public.deduction_installments(portfolio_id, company_id, branch_id, due_period, deduction_id);

create table public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  period_start date not null,
  period_end date not null,
  frequency text not null check (frequency in ('MONTHLY', 'FORTNIGHTLY', 'WEEKLY')),
  created_at timestamptz not null default now(),
  unique (portfolio_id, company_id, branch_id, id),
  foreign key (portfolio_id, company_id, branch_id)
    references public.branches(portfolio_id, company_id, id) on delete restrict,
  check (period_end >= period_start)
);
create index payroll_periods_lookup_idx
  on public.payroll_periods(portfolio_id, company_id, branch_id, period_start desc);

create table public.statutory_rule_versions (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null default 'ZM',
  rule_code text not null,
  version text not null,
  effective_from date not null,
  effective_to date,
  rule_data jsonb not null,
  verified_by uuid references public.profiles(id) on delete restrict,
  verified_at timestamptz,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (jurisdiction, rule_code, version),
  check (effective_to is null or effective_to >= effective_from),
  check (jsonb_typeof(rule_data) = 'object'),
  check (not active or (verified_by is not null and verified_at is not null))
);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_period_id uuid not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'CALCULATED', 'SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'APPROVED', 'FINALIZED', 'CANCELED', 'REVERSED')),
  version integer not null default 1 check (version > 0),
  calculations jsonb not null default '{}',
  created_by uuid not null references public.profiles(id) on delete restrict,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  approved_version integer,
  finalized_at timestamptz,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (portfolio_id, company_id, branch_id, payroll_period_id),
  unique (created_by, idempotency_key),
  unique (portfolio_id, company_id, branch_id, id),
  foreign key (portfolio_id, company_id, branch_id, payroll_period_id)
    references public.payroll_periods(portfolio_id, company_id, branch_id, id) on delete restrict,
  check (status not in ('SUBMITTED_FOR_APPROVAL', 'UNDER_REVIEW', 'RETURNED_FOR_CORRECTION', 'REJECTED', 'APPROVED', 'FINALIZED', 'REVERSED') or submitted_at is not null),
  check (status not in ('APPROVED', 'FINALIZED', 'REVERSED') or (approved_version is not null and reviewed_by is not null and reviewed_at is not null)),
  check (status not in ('FINALIZED', 'REVERSED') or finalized_at is not null),
  check (jsonb_typeof(calculations) = 'object')
);

create table public.payroll_run_statutory_rules (
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  statutory_rule_version_id uuid not null references public.statutory_rule_versions(id) on delete restrict,
  primary key (payroll_run_id, statutory_rule_version_id),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict
);

create table public.payroll_run_items (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  employee_id uuid not null,
  version integer not null check (version > 0),
  basic_pay numeric(14,2) not null check (basic_pay >= 0),
  housing_allowance numeric(14,2) not null default 0 check (housing_allowance >= 0),
  meal_allowance numeric(14,2) not null default 0 check (meal_allowance >= 0),
  transport_allowance numeric(14,2) not null default 0 check (transport_allowance >= 0),
  other_allowances numeric(14,2) not null default 0 check (other_allowances >= 0),
  overtime numeric(14,2) not null default 0 check (overtime >= 0),
  gross_pay numeric(14,2) not null check (gross_pay >= 0),
  statutory_deductions jsonb not null default '{}',
  voluntary_deductions numeric(14,2) not null default 0 check (voluntary_deductions >= 0),
  net_pay numeric(14,2) not null check (net_pay >= 0),
  calculation_breakdown jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (payroll_run_id, employee_id, version),
  unique (portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, employee_id)
    references public.employees(portfolio_id, company_id, workplace_branch_id, id) on delete restrict,
  check (gross_pay = basic_pay + housing_allowance + meal_allowance + transport_allowance + other_allowances + overtime),
  check (jsonb_typeof(statutory_deductions) = 'object' and jsonb_typeof(calculation_breakdown) = 'object')
);

create table public.payroll_item_deductions (
  payroll_run_id uuid not null,
  employee_id uuid not null,
  version integer not null,
  deduction_id uuid not null,
  installment_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  primary key (payroll_run_id, employee_id, version, installment_id),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version)
    references public.payroll_run_items(portfolio_id, company_id, branch_id, payroll_run_id, employee_id, version) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, employee_id, deduction_id, installment_id)
    references public.deduction_installments(portfolio_id, company_id, branch_id, employee_id, deduction_id, id) on delete restrict
);

create table public.deduction_transactions (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  employee_id uuid not null,
  deduction_id uuid not null,
  installment_id uuid not null,
  payroll_run_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  transaction_type text not null check (transaction_type in ('PAYROLL_REPAYMENT', 'EARLY_SETTLEMENT', 'ADJUSTMENT', 'REVERSAL')),
  idempotency_key text not null unique,
  posted_by uuid not null references public.profiles(id) on delete restrict,
  posted_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, employee_id, deduction_id, installment_id)
    references public.deduction_installments(portfolio_id, company_id, branch_id, employee_id, deduction_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict,
  unique (installment_id, payroll_run_id, transaction_type)
);
create index deduction_transactions_deduction_idx
  on public.deduction_transactions(portfolio_id, company_id, branch_id, deduction_id, posted_at desc);
create unique index deduction_payroll_installment_posted_once_idx
  on public.deduction_transactions(installment_id)
  where transaction_type = 'PAYROLL_REPAYMENT';

create table public.payroll_approvals (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null,
  payroll_run_id uuid not null,
  payroll_version integer not null,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('SUBMITTED', 'REVIEW_STARTED', 'RETURNED', 'REJECTED', 'APPROVED', 'FINALIZED', 'REVERSED')),
  reason text,
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id, company_id, branch_id, payroll_run_id)
    references public.payroll_runs(portfolio_id, company_id, branch_id, id) on delete restrict
);
create index payroll_approvals_run_history_idx
  on public.payroll_approvals(portfolio_id, company_id, branch_id, payroll_run_id, occurred_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  portfolio_id uuid not null,
  company_id uuid,
  branch_id uuid,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null,
  module text not null,
  record_id text not null,
  details jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  foreign key (portfolio_id) references public.client_portfolios(id) on delete restrict,
  foreign key (portfolio_id, company_id) references public.companies(portfolio_id, id) on delete restrict,
  foreign key (portfolio_id, company_id, branch_id) references public.branches(portfolio_id, company_id, id) on delete restrict,
  check (branch_id is null or company_id is not null),
  check (jsonb_typeof(details) = 'object')
);
create index audit_logs_tenant_time_idx
  on public.audit_logs(portfolio_id, company_id, branch_id, occurred_at desc, id);

alter table public.employees enable row level security;
alter table public.employee_private_details enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.employee_approval_history enable row level security;
alter table public.attendance_periods enable row level security;
alter table public.attendance_entries enable row level security;
alter table public.leave_requests enable row level security;
alter table public.employee_deductions enable row level security;
alter table public.deduction_approval_history enable row level security;
alter table public.deduction_installments enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.statutory_rule_versions enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_run_statutory_rules enable row level security;
alter table public.payroll_run_items enable row level security;
alter table public.payroll_item_deductions enable row level security;
alter table public.deduction_transactions enable row level security;
alter table public.payroll_approvals enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.employees, public.employee_private_details, public.employee_compensation,
  public.employee_approval_history, public.attendance_periods, public.attendance_entries,
  public.leave_requests, public.employee_deductions, public.deduction_approval_history, public.deduction_installments,
  public.payroll_periods, public.statutory_rule_versions, public.payroll_runs,
  public.payroll_run_statutory_rules, public.payroll_run_items, public.payroll_item_deductions, public.deduction_transactions,
  public.payroll_approvals, public.audit_logs from public, anon, authenticated;

comment on table public.employee_private_details is 'Restricted personal identifiers, contact and payment data; separate table for narrower access.';
comment on table public.employee_compensation is 'Effective-dated compensation. Statutory treatment is per allowance and must be verified before production payroll.';
comment on table public.deduction_transactions is 'Append-only ledger. Finalization RPC is the only intended payment-posting path.';
comment on table public.statutory_rule_versions is 'Inactive/unverified rules cannot support production payroll finalization.';

