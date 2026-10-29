-- Pure calculation verification against the deployed trusted PostgreSQL
-- arithmetic helper. Read-only except for transaction-local assertions.
begin;

do $$
declare
  v_configuration jsonb;
  v_result jsonb;
begin
  select configuration into strict v_configuration
  from public.payroll_calculation_rule_versions
  where jurisdiction = 'ZM' and version = 'ZM-2026-CLIENT-APPROVED-V1'
    and client_approval_status = 'APPROVED_FOR_DEVELOPMENT'
    and regulatory_verification_status = 'UNVERIFIED';

  v_result := app_private.payroll_calculate_client_policy_amounts(15092, 4527.60, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'gross_earnings')::numeric <> 19619.60
    or (v_result->>'paye_taxable_income')::numeric <> 19619.60
    or (v_result->>'paye')::numeric <> 4885.25
    or (v_result->>'napsa_employee')::numeric <> 980.98
    or (v_result->>'napsa_employer')::numeric <> 980.98
    or (v_result->>'nhima_employee')::numeric <> 150.92
    or (v_result->>'nhima_employer')::numeric <> 150.92
    or (v_result->>'net_pay')::numeric <> 13602.45
    or (v_result->>'total_employer_cost')::numeric <> 20751.50 then
    raise exception 'K19,619.60 client-approved worked example mismatch: %', v_result;
  end if;

  -- Progressive PAYE boundary cases (nearest cent above a threshold may round
  -- to the same tax cent; the following cent must cross the rounded result).
  v_result := app_private.payroll_calculate_client_policy_amounts(5100, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 0 then raise exception 'PAYE at K5,100 must be zero.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(5100.01, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 0 then raise exception 'PAYE at K5,100.01 should round to K0.00.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(5500, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 80 then raise exception 'PAYE at K5,500 mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(6500, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 280 then raise exception 'PAYE at K6,500 mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(7100, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 400 then raise exception 'PAYE at K7,100 mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(7100.02, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 400.01 then raise exception 'PAYE above K7,100 band mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(9200, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 1030 then raise exception 'PAYE at K9,200 mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(9200.02, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 1030.01 then raise exception 'PAYE above K9,200 band mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(12500, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 2251 then raise exception 'PAYE at K12,500 mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(25000, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'paye')::numeric <> 6876 then raise exception 'PAYE at K25,000 mismatch.'; end if;

  v_result := app_private.payroll_calculate_client_policy_amounts(30000, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1500 or (v_result->>'napsa_employer')::numeric <> 1500 then
    raise exception 'K30,000 NAPSA contribution mismatch.';
  end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(37235.80, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1861.79 then raise exception 'NAPSA just below the ceiling threshold mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(37235.99, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1861.80 then raise exception 'NAPSA one cent below the threshold mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(37236.00, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1861.80 then raise exception 'NAPSA at ceiling threshold mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(37236.01, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1861.80 then raise exception 'NAPSA one cent above the threshold mismatch.'; end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(50000, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'napsa_employee')::numeric <> 1861.80 or (v_result->>'napsa_employer')::numeric <> 1861.80 then
    raise exception 'K50,000 NAPSA cap mismatch.';
  end if;

  -- Non-taxable allowances stay in gross, not the PAYE base. NHIMA uses basic
  -- salary, while NAPSA uses gross earnings.
  v_result := app_private.payroll_calculate_client_policy_amounts(5000, 0, 1000, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'gross_earnings')::numeric <> 6000
    or (v_result->>'paye_taxable_income')::numeric <> 5000
    or (v_result->>'paye')::numeric <> 0
    or (v_result->>'napsa_employee')::numeric <> 300
    or (v_result->>'nhima_employee')::numeric <> 50 then
    raise exception 'Non-taxable earnings bases mismatch: %', v_result;
  end if;

  -- Taxable overtime/bonus add to the PAYE base; deductions affect net only.
  v_result := app_private.payroll_calculate_client_policy_amounts(5100, 0, 0, 100, 100, 200, 200, 1000, v_configuration);
  if (v_result->>'gross_earnings')::numeric <> 5400
    or (v_result->>'paye_taxable_income')::numeric <> 5400
    or (v_result->>'paye')::numeric <> 60
    or (v_result->>'net_pay')::numeric <> 4019 then
    raise exception 'Taxable overtime/bonus or deduction example mismatch: %', v_result;
  end if;

  -- PostgreSQL NUMERIC round is half away from zero for the persisted cents.
  v_result := app_private.payroll_calculate_client_policy_amounts(0.50, 0, 0, 0, 0, 0, 0, 0, v_configuration);
  if (v_result->>'nhima_employee')::numeric <> 0.01 then raise exception 'Positive half-cent rounding mismatch.'; end if;
  if round(0.005::numeric, 2) <> 0.01 or round((-0.005)::numeric, 2) <> -0.01 then
    raise exception 'PostgreSQL NUMERIC half-away-from-zero rounding mismatch.';
  end if;
  v_result := app_private.payroll_calculate_client_policy_amounts(100, 0, 0, 0, 0, 0, 0, 200, v_configuration);
  if v_result->'net_pay' <> 'null'::jsonb or (v_result->>'net_pay_blocked')::boolean is distinct from true then
    raise exception 'Negative net pay must be blocked, not persisted as a negative salary.';
  end if;
end;
$$;

rollback;
