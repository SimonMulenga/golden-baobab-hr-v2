param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [int]$Port = 55432
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Disposable, loopback-only application-schema validation. This does not connect
# to Supabase and cannot validate Supabase-managed Auth, Storage, Vault, or RLS
# behavior under real JWT claims.
$archive = [IO.Path]::GetFullPath($ArchivePath)
$backupDirectory = Split-Path -Parent $archive
$archiveStem = [IO.Path]::GetFileNameWithoutExtension($archive)
$rolesDump = Join-Path $backupDirectory "$archiveStem-roles.sql"
$manifestPath = Join-Path $backupDirectory "$archiveStem-manifest.json"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migration035 = Join-Path $repoRoot 'supabase\migrations\20261029003500_department_activation_workflow.sql'
$migration036 = Join-Path $repoRoot 'supabase\migrations\20261029003600_controlled_employee_import_updates.sql'
$migration037 = Join-Path $repoRoot 'supabase\migrations\20261029003700_approved_attendance_correction_workflow.sql'
$migration038 = Join-Path $repoRoot 'supabase\migrations\20261029003800_audited_employee_compensation_changes.sql'
$migration039 = Join-Path $repoRoot 'supabase\migrations\20261030003900_branch_manager_employee_change_permissions.sql'
$migration040 = Join-Path $repoRoot 'supabase\migrations\20261030004000_branch_calendar_and_scheduled_day_proration.sql'
$migration041 = Join-Path $repoRoot 'supabase\migrations\20261030004100_company_payroll_reviewer_and_calendar_permission.sql'
$migration042 = Join-Path $repoRoot 'supabase\migrations\20261030004200_simplified_branch_payroll_and_inputs.sql'
$migration043 = Join-Path $repoRoot 'supabase\migrations\20261030004300_retire_calendar_rpcs_and_restrict_internal_trigger.sql'
$migration044 = Join-Path $repoRoot 'supabase\migrations\20261030004400_honor_editable_attendance_schedule.sql'
$migration045 = Join-Path $repoRoot 'supabase\migrations\20261030004500_simplify_attendance_and_leave_approvals.sql'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$workRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'GoldenBaobab\migration-validation') "local-pg18-$runId"
$dataDirectory = Join-Path $workRoot 'data'
$targetDatabase = 'gbhr_migration_validation'
$marker = '.golden-baobab-disposable-cluster'
$clusterCreated = $false
$clusterStarted = $false
$oldPgEnv = @{}

function Quote-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-BoundedNative(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$Name,
  [int]$TimeoutSeconds,
  [string]$LogStem
) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Process.Start returned false.' }
  } catch {
    $process.Dispose()
    throw "$Name process-start failure: $($_.Exception.Message)"
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while (-not $process.WaitForExit(1000)) {
    if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
      try { $process.Kill() } catch { }
      if (-not $process.WaitForExit(5000)) {
        $process.Dispose()
        throw "$Name timed out and termination could not be confirmed."
      }
      [IO.File]::WriteAllText("$LogStem.out", $stdoutTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
      [IO.File]::WriteAllText("$LogStem.err", $stderrTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
      $process.Dispose()
      throw "$Name timed out after $TimeoutSeconds seconds; logs are in the private validation directory."
    }
  }
  if (-not $process.HasExited -and -not $process.WaitForExit(5000)) {
    $process.Dispose()
    throw "$Name did not reach an exited state."
  }
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()
  $process.Dispose()
  [IO.File]::WriteAllText("$LogStem.out", $stdout, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText("$LogStem.err", $stderr, [Text.UTF8Encoding]::new($false))
  if ($null -eq $exitCode) { throw "$Name exited but returned no exit code." }
  if ([int]$exitCode -ne 0) {
    $detail = (($stderr -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 5) -join ' '
    $detail = $detail -replace '(?i)postgres(?:ql)?://\S+', '[connection URI redacted]'
    if (-not $detail) { $detail = 'nonzero exit with empty stderr' }
    throw "$Name failed with exit code $exitCode. Sanitized detail: $detail"
  }
  return $stdout
}

function Invoke-BoundedUnredirectedNative(
  [string]$Executable,
  [string[]]$Arguments,
  [string]$Name,
  [int]$TimeoutSeconds
) {
  # pg_ctl start launches a background PostgreSQL child. Redirected pipes can
  # remain open in that child after pg_ctl exits, blocking ReadToEnd forever.
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $false
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Process.Start returned false.' }
  } catch {
    $process.Dispose()
    throw "$Name process-start failure: $($_.Exception.Message)"
  }
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    try { $process.Kill() } catch { }
    if (-not $process.WaitForExit(5000)) { $process.Dispose(); throw "$Name timed out and termination could not be confirmed." }
    $process.Dispose()
    throw "$Name timed out after $TimeoutSeconds seconds."
  }
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $process.Dispose()
  if ($null -eq $exitCode) { throw "$Name exited but returned no exit code." }
  if ([int]$exitCode -ne 0) { throw "$Name failed with exit code $exitCode." }
}

foreach ($tool in @($initdb, $pgCtl, $psql, $createdb, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required installed PostgreSQL 18 tool is unavailable: $tool" }
}
foreach ($migration in @($migration041, $migration042)) {
  if (-not (Test-Path -LiteralPath $migration -PathType Leaf)) { throw "Required migration is missing: $migration" }
}
if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or
    -not (Test-Path -LiteralPath $rolesDump -PathType Leaf) -or
    -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw 'Archive, separate role export, or manifest is missing.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.project_ref -ne 'jssuaebiizjcoqmngxzk' -or
    $manifest.server_version -ne '17.11' -or
    $manifest.roles_file_passwords -ne 'omitted') {
  throw 'Archive manifest does not match the expected development source and password-free role export.'
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $manifest.archive_sha256 -or
    (Get-Item -LiteralPath $archive).Length -ne $manifest.archive_bytes) {
  throw 'Archive hash or size does not match its verified manifest.'
}
if (Test-Path -LiteralPath $workRoot) { throw 'Unique validation path already exists; refusing to reuse it.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "Loopback validation port $Port is occupied; refusing to connect to an unidentified service."
}

New-Item -ItemType Directory -Path $workRoot | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$acl = Get-Acl -LiteralPath $workRoot
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
$acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $workRoot -AclObject $acl

$processEnvironment = [Environment]::GetEnvironmentVariables('Process')
foreach ($name in $processEnvironment.Keys) {
  if ([string]$name -like 'PG*') { $oldPgEnv[[string]$name] = [string]$processEnvironment[$name] }
}
try {
  foreach ($name in @($oldPgEnv.Keys)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  Invoke-BoundedNative $pgRestore @('--list', $archive) 'archive-list' 30 (Join-Path $workRoot 'archive-list') | Out-Null
  $toc = Get-Content -LiteralPath (Join-Path $workRoot 'archive-list.out')
  $entryCount = @($toc | Where-Object { $_ -match '^\s*[0-9]+;' }).Count
  if ($entryCount -ne [int]$manifest.archive_entries -or $entryCount -lt 1) { throw 'Archive TOC entry count differs from the verified manifest.' }

  # initdb completes catalog initialization slowly on the user's HDD; direct
  # output avoids inherited redirected handles while retaining a hard timeout.
  Invoke-BoundedUnredirectedNative $initdb @('-D', $dataDirectory, '-U', 'postgres', '--encoding=UTF8', '--no-locale', '--auth-local=trust', '--auth-host=trust') 'initdb' 300
  if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION')) -or
      (Get-Content -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -Raw).Trim() -ne '18') {
    throw 'A fresh PostgreSQL 18 cluster was not initialized at the unique target path.'
  }
  [IO.File]::WriteAllText((Join-Path $dataDirectory $marker), $runId, [Text.UTF8Encoding]::new($false))
  $clusterCreated = $true

  $env:PGHOST = '127.0.0.1'; $env:PGPORT = [string]$Port; $env:PGUSER = 'postgres'; $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'disable'; $env:PGCONNECT_TIMEOUT = '5'; $env:PGAPPNAME = 'gbhr-local-migration-validation'
  Invoke-BoundedUnredirectedNative $pgCtl @('-D', $dataDirectory, '-o', "-h 127.0.0.1 -p $Port", '-l', (Join-Path $workRoot 'postgres-server.log'), '-w', 'start') 'pg_ctl-start' 30
  $clusterStarted = $true
  $identityQuery = "select current_database()||'|'||current_user||'|'||inet_server_addr()||'|'||current_setting('port')||'|'||current_setting('server_version_num');"
  $identityResult = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',$identityQuery) 'target-identity' 10 (Join-Path $workRoot 'target-identity')).Trim()
  if ($identityResult -notmatch "^postgres\|postgres\|127\.0\.0\.1(?:/32)?\|$Port\|180[0-9]{3}$") {
    throw 'Restore target identity did not match the fresh local PostgreSQL 18 loopback cluster.'
  }
  $databaseList = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select datname from pg_database where datallowconn and not datistemplate order by datname;") 'database-list' 10 (Join-Path $workRoot 'database-list')).Trim()
  if ($databaseList -ne 'postgres') { throw 'Fresh cluster contains an unexpected connectable database.' }

  Invoke-BoundedNative $createdb @('-w', $targetDatabase) 'create-validation-database' 10 (Join-Path $workRoot 'create-validation-database') | Out-Null
  $env:PGDATABASE = $targetDatabase
  $emptyCount = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema');") 'target-empty-check' 10 (Join-Path $workRoot 'target-empty-check')).Trim()
  if ($emptyCount -ne '0') { throw 'Restore database was not empty before restore.' }
  Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-c','CREATE SCHEMA app_private; CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA supabase_migrations;') 'create-schema-containers' 10 (Join-Path $workRoot 'create-schema-containers') | Out-Null

  $roleSql = Get-Content -LiteralPath $rolesDump -Raw
  $roleMatches = [regex]::Matches($roleSql, '(?im)^\s*CREATE ROLE\s+"?(?<name>[A-Za-z0-9_-]+)"?\s*;')
  $roleNames = @($roleMatches | ForEach-Object { $_.Groups['name'].Value } | Sort-Object -Unique | Where-Object { $_ -ne 'postgres' -and $_ -notmatch '^pg_' })
  if ($roleNames -notcontains 'authenticated' -or $roleNames -notcontains 'anon') { throw 'Role export lacks expected Supabase client role definitions.' }
  $roleStatements = foreach ($roleName in $roleNames) {
    $quotedRole = '"' + $roleName.Replace('"', '""') + '"'
    "DO `$gb`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$roleName') THEN EXECUTE 'CREATE ROLE $quotedRole NOLOGIN'; END IF; END `$gb`$;"
  }
  $roleFile = Join-Path $workRoot 'placeholder-roles.sql'
  [IO.File]::WriteAllText($roleFile, ($roleStatements -join "`n"), [Text.UTF8Encoding]::new($false))
  $env:PGDATABASE = 'postgres'
  Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$roleFile) 'create-placeholder-roles' 20 (Join-Path $workRoot 'create-placeholder-roles') | Out-Null
  $env:PGDATABASE = $targetDatabase

  $tocText = Get-Content -LiteralPath (Join-Path $workRoot 'archive-list.out')
  $tocText = ($tocText | ForEach-Object {
    if ($_ -match 'EXTENSION - supabase_vault\s*$' -or $_ -match 'COMMENT - EXTENSION supabase_vault\s*$') { '; ' + $_ } else { $_ }
  }) -join "`n"
  $tocPath = Join-Path $workRoot 'restore.toc'
  [IO.File]::WriteAllText($tocPath, $tocText, [Text.UTF8Encoding]::new($false))
  Invoke-BoundedNative $pgRestore @('--exit-on-error','--single-transaction','--no-owner','--dbname',$targetDatabase,'--use-list',$tocPath,'--schema=public','--schema=app_private','--schema=auth','--schema=extensions','--schema=supabase_migrations',$archive) 'application-schema-restore' 180 (Join-Path $workRoot 'application-schema-restore') | Out-Null

  $baselineSql = @"
select 'history|'||count(*)||'|'||coalesce(min(version),'')||'|'||coalesce(max(version),'') from supabase_migrations.schema_migrations;
select 'companies|'||count(*) from public.companies;
select 'branches|'||count(*) from public.branches;
select 'employees|'||count(*) from public.employees;
select 'audit|'||count(*) from public.audit_logs;
select 'policies|'||count(*) from pg_policies where schemaname='public';
select 'rls|'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
"@
  $baselinePath = Join-Path $workRoot 'baseline.sql'
  [IO.File]::WriteAllText($baselinePath, $baselineSql, [Text.UTF8Encoding]::new($false))
  $baselineOutput = Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$baselinePath) 'baseline-checks' 20 (Join-Path $workRoot 'baseline-checks')
  if ($baselineOutput -notmatch 'history\|(?<count>40|41|43|44)\|20261028000100\|(?<last>20261030004000|20261030004100|20261030004300|20261030004400)') { throw 'Archive migration history does not match a supported baseline through 040, 041, 043 or 044.' }
  $baselineHistoryCount = [int]$Matches.count
  $baselineHistoryLast = $Matches.last
  $baselineRows = @{}
  foreach ($line in ($baselineOutput -split "`r?`n")) { if ($line -match '^(?<key>companies|branches|employees|audit|policies|rls)\|(?<value>\d+)$') { $baselineRows[$Matches.key] = $Matches.value } }
  if ($baselineRows.Count -ne 6) { throw 'Could not establish complete table/policy/RLS baselines.' }

  $check035 = "select (to_regprocedure('public.department_activate(uuid)') is not null)::text||'|'||has_function_privilege('authenticated','public.department_activate(uuid)','EXECUTE')::text;"
  $result035 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',$check035) 'check-035' 10 (Join-Path $workRoot 'check-035')).Trim()
  if ($result035 -ne 'true|true') { throw 'Migration 035 function or authenticated execute grant is missing.' }
  $anonymous035 = @"
do `$gb`$ begin
  begin
    perform public.department_activate('00000000-0000-0000-0000-000000000000'::uuid);
    raise exception 'anonymous department activation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end `$gb`$;
"@
  $anon035Path = Join-Path $workRoot 'anonymous-035.sql'
  [IO.File]::WriteAllText($anon035Path, $anonymous035, [Text.UTF8Encoding]::new($false))
  Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$anon035Path) 'anonymous-035-denial' 10 (Join-Path $workRoot 'anonymous-035-denial') | Out-Null

  $check036 = @"
select (exists(select 1 from information_schema.columns where table_schema='public' and table_name='employee_import_jobs' and column_name='updated_rows'))::text
||'|'||(exists(select 1 from pg_constraint where conrelid='public.employee_import_jobs'::regclass and conname like '%updated_rows%'))::text
||'|'||(to_regprocedure('public.employee_import_atomic(uuid,uuid,uuid,text,jsonb)') is not null)::text
||'|'||has_function_privilege('authenticated','public.employee_import_atomic(uuid,uuid,uuid,text,jsonb)','EXECUTE')::text
||'|'||(to_regprocedure('public.employee_import_supports_draft_updates(uuid,uuid,uuid)') is not null)::text;
select 'anonymous_capability|'||public.employee_import_supports_draft_updates('00000000-0000-0000-0000-000000000001'::uuid,'00000000-0000-0000-0000-000000000002'::uuid,'00000000-0000-0000-0000-000000000003'::uuid)::text;
"@
  $check036Path = Join-Path $workRoot 'check-036.sql'
  [IO.File]::WriteAllText($check036Path, $check036, [Text.UTF8Encoding]::new($false))
  $result036 = Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check036Path) 'check-036' 15 (Join-Path $workRoot 'check-036')
  $result036 = $result036 -replace "`r", ''
  if ($result036 -notmatch '(?m)^true\|true\|true\|true\|true$' -or $result036 -notmatch '(?m)^anonymous_capability\|false$') {
    throw 'Migration 036 column/check/RPC/grant or anonymous-denial verification failed.'
  }

  $baselineExtraSql = @"
select 'compensation|'||count(*) from public.employee_compensation;
select 'attendance_periods|'||count(*) from public.attendance_periods;
select 'payroll_periods|'||count(*) from public.payroll_periods;
select 'payroll_runs|'||count(*) from public.payroll_runs;
select 'audit_fingerprint|'||md5(coalesce(string_agg(to_jsonb(a)::text, E'\\n' order by a.id),'')) from public.audit_logs a;
select 'rls_disabled|'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
select 'policy_count|'||count(*) from pg_policies where schemaname='public';
"@
  $baselineExtraPath = Join-Path $workRoot 'baseline-extra.sql'
  [IO.File]::WriteAllText($baselineExtraPath, $baselineExtraSql, [Text.UTF8Encoding]::new($false))
  $baselineExtra = Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$baselineExtraPath) 'baseline-extra' 20 (Join-Path $workRoot 'baseline-extra')
  $baselineRows = @{}
  foreach ($line in ($baselineOutput -split "`r?`n")) { if ($line -match '^(?<key>companies|branches|employees|audit|policies|rls)\|(?<value>\d+)$') { $baselineRows[$Matches.key] = $Matches.value } }
  foreach ($line in ($baselineExtra -split "`r?`n")) { if ($line -match '^(?<key>compensation|attendance_periods|payroll_periods|payroll_runs|audit_fingerprint|rls_disabled|policy_count)\|(?<value>.+)$') { $baselineRows[$Matches.key] = $Matches.value } }
  if ($baselineRows.Count -ne 13) { throw 'Could not establish complete migration preservation baselines.' }

  if ($baselineHistoryLast -eq '20261030004000') {
    Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration041) 'migration-041' 90 (Join-Path $workRoot 'migration-041') | Out-Null
    Write-Output 'MIGRATION_SQL_APPLIED_LOCALLY version=041'
  } else {
    Write-Output 'MIGRATION_SQL_ALREADY_PRESENT_IN_ARCHIVE version=041'
  }

  $newObjectsSql = @"
select (exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_periods' and column_name='submitted_by'))::text
||'|'||(exists(select 1 from information_schema.columns where table_schema='public' and table_name='attendance_periods' and column_name='correction_opened_by'))::text
||'|'||(to_regprocedure('public.attendance_request_approved_correction(uuid,text)') is not null)::text
||'|'||(to_regclass('public.employee_change_requests') is not null)::text
||'|'||(to_regprocedure('public.employee_change_request_create(uuid,jsonb,jsonb,text)') is not null)::text
||'|'||(to_regprocedure('public.employee_change_request_review(uuid,text,text)') is not null)::text
||'|'||(to_regclass('public.branch_work_calendars') is not null)::text
||'|'||(to_regprocedure('public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)') is not null)::text
||'|'||(to_regprocedure('app_private.payroll_employee_proration(uuid,date,date,date[])') is not null)::text;
select 'privileges|'||has_function_privilege('authenticated','public.employee_change_request_create(uuid,jsonb,jsonb,text)','EXECUTE')
||'|'||has_function_privilege('anon','public.employee_change_request_create(uuid,jsonb,jsonb,text)','EXECUTE')
||'|'||has_function_privilege('authenticated','public.employee_change_request_review(uuid,text,text)','EXECUTE')
||'|'||has_function_privilege('anon','public.employee_change_request_review(uuid,text,text)','EXECUTE')
||'|'||has_function_privilege('authenticated','public.attendance_request_approved_correction(uuid,text)','EXECUTE')
||'|'||has_function_privilege('anon','public.attendance_request_approved_correction(uuid,text)','EXECUTE')
||'|'||has_function_privilege('authenticated','public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)','EXECUTE')
||'|'||has_function_privilege('anon','public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)','EXECUTE');
"@
  $newObjectsPath = Join-Path $workRoot 'new-object-checks.sql'
  [IO.File]::WriteAllText($newObjectsPath, $newObjectsSql, [Text.UTF8Encoding]::new($false))
  $newObjectsResult = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$newObjectsPath) 'new-object-checks' 20 (Join-Path $workRoot 'new-object-checks')) -replace "`r", ''
  $calendarRpcAvailable = $baselineHistoryLast -in @('20261030004000','20261030004100')
  $expectedNewObjectPrivileges = if ($calendarRpcAvailable) { '(?m)^privileges\|true\|false\|true\|false\|true\|false\|true\|false$' } else { '(?m)^privileges\|true\|false\|true\|false\|true\|false\|false\|false$' }
  if ($newObjectsResult -notmatch '(?m)^true\|true\|true\|true\|true\|true\|true\|true\|true$' -or
      $newObjectsResult -notmatch $expectedNewObjectPrivileges) {
    throw 'Migration object, RPC grant, or anonymous-denial verification failed.'
  }

  $check041 = @"
select (to_regprocedure('public.assign_company_payroll_reviewer(uuid,uuid,uuid)') is not null)::text
||'|'||(to_regprocedure('public.revoke_company_payroll_reviewer(uuid,uuid,uuid,text)') is not null)::text
||'|'||(to_regprocedure('public.company_payroll_reviewer_members(uuid,uuid)') is not null)::text
||'|'||has_function_privilege('authenticated','public.assign_company_payroll_reviewer(uuid,uuid,uuid)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.assign_company_payroll_reviewer(uuid,uuid,uuid)','EXECUTE')::text
||'|'||(position('COMPANY_PAYROLL_REVIEWER' in pg_get_functiondef('app_private.has_permission(text,uuid,uuid,uuid)'::regprocedure)) > 0)::text
||'|'||(position('branch.calendar.manage' in pg_get_functiondef('app_private.has_permission(text,uuid,uuid,uuid)'::regprocedure)) > 0)::text
||'|'||(position('branch.edit' in pg_get_functiondef('public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)'::regprocedure)) = 0)::text;
"@
  $check041Path = Join-Path $workRoot 'check-041.sql'
  [IO.File]::WriteAllText($check041Path, $check041, [Text.UTF8Encoding]::new($false))
  $result041 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check041Path) 'check-041' 15 (Join-Path $workRoot 'check-041')).Trim()
  if ($result041 -ne 'true|true|true|true|false|true|true|true') { throw 'Migration 041 reviewer/calendar RPC, grant, or permission verification failed.' }

  $rollbackWorkflowStatus = 'skipped-existing-043-calendar-RPCs-retired'
  if ($baselineHistoryLast -in @('20261030004000','20261030004100')) {
    $workflowPath = Join-Path $repoRoot 'supabase\tests\pending-migration-037-040-workflows.sql'
    $workflowOutput = Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$workflowPath) 'rollback-workflow-037-041' 90 (Join-Path $workRoot 'rollback-workflow-037-041')
    if ($workflowOutput -match '(?m)^FAIL$' -or $workflowOutput -notmatch 'PASS migration 037-041 synthetic workflow assertions passed') {
      throw 'Rollback-only synthetic migration 037-041 workflow assertions reported a failure.'
    }
    $rollbackWorkflowStatus = '037-041-passed'
  } else {
    Write-Output 'ROLLBACK_WORKFLOW_SKIPPED base already contains migration 043; calendar RPCs are intentionally retired.'
  }

  if ($baselineHistoryLast -in @('20261030004000','20261030004100')) {
    Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration042) 'migration-042' 90 (Join-Path $workRoot 'migration-042') | Out-Null
    Write-Output 'MIGRATION_SQL_APPLIED_LOCALLY version=042'
  } else { Write-Output 'MIGRATION_SQL_ALREADY_PRESENT_IN_ARCHIVE version=042' }

  $check042 = @"
select (to_regprocedure('public.payroll_preview_inputs(uuid,uuid,date,date)') is not null)::text
||'|'||(to_regprocedure('public.payroll_preview_inputs_legacy(uuid,uuid,date,date)') is not null)::text
||'|'||(to_regprocedure('public.payroll_create_draft(uuid,uuid,date,date,text,text)') is not null)::text
||'|'||(to_regprocedure('app_private.normalize_new_earning_history()') is not null)::text
||'|'||(exists(select 1 from pg_trigger where tgrelid='public.payroll_earning_input_history'::regclass and tgname='payroll_earning_history_recorded_action' and not tgisinternal))::text
||'|'||(exists(select 1 from information_schema.columns where table_schema='public' and table_name='payroll_earning_inputs' and column_name='status' and column_default like '%RECORDED%'))::text
||'|'||(exists(select 1 from pg_constraint where conrelid='public.payroll_earning_inputs'::regclass and conname='payroll_earning_inputs_status_check' and pg_get_constraintdef(oid) like '%RECORDED%'))::text
||'|'||has_function_privilege('authenticated','public.payroll_preview_inputs(uuid,uuid,date,date)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.payroll_preview_inputs(uuid,uuid,date,date)','EXECUTE')::text;
"@
  $check042Path = Join-Path $workRoot 'check-042.sql'
  [IO.File]::WriteAllText($check042Path, $check042, [Text.UTF8Encoding]::new($false))
  $result042 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check042Path) 'check-042' 15 (Join-Path $workRoot 'check-042')).Trim()
  if ($result042 -ne 'true|true|true|true|true|true|true|true|false') { throw 'Migration 042 objects, earning status, or RPC grants failed verification.' }
  $permissionDefinition = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select pg_get_functiondef('app_private.has_permission(text,uuid,uuid,uuid)'::regprocedure);") 'permission-definition-042' 10 (Join-Path $workRoot 'permission-definition-042'))
  if ($permissionDefinition -notmatch "\('BRANCH_MANAGER', 'payroll\.prepare'\)" -or
      $permissionDefinition -notmatch "\('BRANCH_MANAGER', 'payroll\.submit'\)" -or
      $permissionDefinition -match "\('BRANCH_MANAGER', 'payroll\.(approve|finalize)'\)") {
    throw 'Migration 042 branch payroll permission boundary failed verification.'
  }

  if ($baselineHistoryLast -in @('20261030004000','20261030004100')) {
    Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration043) 'migration-043' 60 (Join-Path $workRoot 'migration-043') | Out-Null
    Write-Output 'MIGRATION_SQL_APPLIED_LOCALLY version=043'
  } else { Write-Output 'MIGRATION_SQL_ALREADY_PRESENT_IN_ARCHIVE version=043' }

  $check043 = @"
select has_function_privilege('authenticated','public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.branch_work_calendar_request(uuid,uuid,date,date,date[],text)','EXECUTE')::text
||'|'||has_function_privilege('authenticated','public.branch_work_calendar_review(uuid,text,text)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.branch_work_calendar_review(uuid,text,text)','EXECUTE')::text
||'|'||has_function_privilege('authenticated','public.branch_work_calendar_capabilities(uuid,uuid)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.branch_work_calendar_capabilities(uuid,uuid)','EXECUTE')::text
||'|'||has_function_privilege('authenticated','app_private.normalize_new_earning_history()','EXECUTE')::text
||'|'||has_function_privilege('anon','app_private.normalize_new_earning_history()','EXECUTE')::text
||'|'||(to_regclass('public.branch_work_calendars') is not null)::text
||'|'||(exists(select 1 from pg_trigger where tgrelid='public.payroll_earning_input_history'::regclass and tgname='payroll_earning_history_recorded_action' and not tgisinternal and tgfoid='app_private.normalize_new_earning_history()'::regprocedure))::text;
"@
  $check043Path = Join-Path $workRoot 'check-043.sql'
  [IO.File]::WriteAllText($check043Path, $check043, [Text.UTF8Encoding]::new($false))
  $result043 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check043Path) 'check-043' 15 (Join-Path $workRoot 'check-043')).Trim()
  if ($result043 -ne 'false|false|false|false|false|false|false|false|true|true') {
    throw 'Migration 043 did not revoke client RPC/helper execution while preserving historical calendar data and the earning trigger.'
  }

  if ($baselineHistoryLast -ne '20261030004400') {
    Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration044) 'migration-044' 60 (Join-Path $workRoot 'migration-044') | Out-Null
    Write-Output 'MIGRATION_SQL_APPLIED_LOCALLY version=044'
  } else { Write-Output 'MIGRATION_SQL_ALREADY_PRESENT_IN_ARCHIVE version=044' }

  Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration045) 'migration-045' 90 (Join-Path $workRoot 'migration-045') | Out-Null
  $check045 = @"
select has_function_privilege('authenticated','public.attendance_submit_period(uuid)','EXECUTE')::text
||'|'||has_function_privilege('authenticated','public.attendance_review_period(uuid,text,text)','EXECUTE')::text
||'|'||has_function_privilege('authenticated','public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text)','EXECUTE')::text
||'|'||(position('APPROVED' in pg_get_functiondef('public.leave_create_request_calculated(uuid,uuid,uuid,uuid,uuid,date,date,text,text)'::regprocedure))>0)::text
||'|'||(position('Only cancellation' in pg_get_functiondef('public.leave_request_transition(uuid,text,text)'::regprocedure))>0)::text;
"@
  $check045Path = Join-Path $workRoot 'check-045.sql'
  [IO.File]::WriteAllText($check045Path, $check045, [Text.UTF8Encoding]::new($false))
  $result045 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check045Path) 'check-045' 15 (Join-Path $workRoot 'check-045')).Trim()
  if ($result045 -ne 'false|true|true|true|true') { throw 'Migration 045 attendance/leave simplification grants or RPC behavior did not verify.' }
  $check044 = @"
select (position('ATTENDANCE_SCHEDULE_MISMATCH' in pg_get_functiondef('public.payroll_preview_inputs(uuid,uuid,date,date)'::regprocedure)) = 0)::text
||'|'||has_function_privilege('authenticated','public.payroll_preview_inputs(uuid,uuid,date,date)','EXECUTE')::text
||'|'||has_function_privilege('anon','public.payroll_preview_inputs(uuid,uuid,date,date)','EXECUTE')::text;
"@
  $check044Path = Join-Path $workRoot 'check-044.sql'
  [IO.File]::WriteAllText($check044Path, $check044, [Text.UTF8Encoding]::new($false))
  $result044 = (Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$check044Path) 'check-044' 15 (Join-Path $workRoot 'check-044')).Trim()
  if ($result044 -ne 'true|true|false') { throw 'Migration 044 schedule override or payroll-preview grant verification failed.' }

  $afterSql = @"
select 'companies|'||count(*) from public.companies;
select 'branches|'||count(*) from public.branches;
select 'employees|'||count(*) from public.employees;
select 'audit|'||count(*) from public.audit_logs;
select 'compensation|'||count(*) from public.employee_compensation;
select 'attendance_periods|'||count(*) from public.attendance_periods;
select 'payroll_periods|'||count(*) from public.payroll_periods;
select 'payroll_runs|'||count(*) from public.payroll_runs;
select 'audit_fingerprint|'||md5(coalesce(string_agg(to_jsonb(a)::text, E'\\n' order by a.id),'')) from public.audit_logs a;
select 'rls_disabled|'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
select 'rls_enabled|'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
select 'policy_count|'||count(*) from pg_policies where schemaname='public';
select 'history|'||count(*) from supabase_migrations.schema_migrations;
"@
  $afterPath = Join-Path $workRoot 'after.sql'
  [IO.File]::WriteAllText($afterPath, $afterSql, [Text.UTF8Encoding]::new($false))
  $afterOutput = Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$afterPath) 'after-checks' 15 (Join-Path $workRoot 'after-checks')
  $afterRows = @{}
  foreach ($line in ($afterOutput -split "`r?`n")) { if ($line -match '^(?<key>companies|branches|employees|audit|compensation|attendance_periods|payroll_periods|payroll_runs|audit_fingerprint|rls_disabled|rls_enabled|policy_count|history)\|(?<value>.+)$') { $afterRows[$Matches.key] = $Matches.value } }
  foreach ($key in @('companies','branches','employees','audit','compensation','attendance_periods','payroll_periods','payroll_runs','audit_fingerprint','rls_disabled')) {
    if ($afterRows[$key] -ne $baselineRows[$key]) { throw "Migration preservation invariant changed: $key differs." }
  }
  if ([int]$afterRows['rls_enabled'] -ne [int]$baselineRows['rls']) { throw 'Migration 041 changed the number of RLS-enabled public tables.' }
  if ([int]$afterRows['policy_count'] -ne [int]$baselineRows['policy_count']) { throw 'Migration 041 unexpectedly changed the public policy count.' }
  if ([int]$afterRows['history'] -ne $baselineHistoryCount) { throw 'Local raw SQL validation unexpectedly changed the restored migration history.' }

  Write-Output "LOCAL_MIGRATION_VALIDATION_PASSED source=development archive=$archive server=PostgreSQL18 migrations=042-045 history_before_after_count=$baselineHistoryCount history_last=$baselineHistoryLast company_employee_compensation_attendance_payroll_rows_unchanged=true audit_history_fingerprint_unchanged=true prior_rls_preserved=true rollback_workflows=$rollbackWorkflowStatus migration045_runtime_fixture_tests=not_run logs=$workRoot"
  Write-Output 'This validates migration SQL and structural preservation on an isolated local PostgreSQL database; Supabase-managed and signed Auth HTTP behavior remains to be tested.'
} finally {
  foreach ($name in @('PGHOST','PGPORT','PGUSER','PGDATABASE','PGSSLMODE','PGCONNECT_TIMEOUT','PGAPPNAME')) {
    if (-not $oldPgEnv.ContainsKey($name)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  }
  foreach ($name in $oldPgEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldPgEnv[$name], 'Process') }
  if ($clusterCreated -and -not $clusterStarted -and (Test-Path -LiteralPath (Join-Path $dataDirectory $marker))) {
    # Recover safely if pg_ctl started the marked cluster but its bounded wait failed.
    $status = [Diagnostics.Process]::new()
    $status.StartInfo.FileName = $pgCtl
    $status.StartInfo.Arguments = (Quote-NativeArgument '-D') + ' ' + (Quote-NativeArgument $dataDirectory) + ' status'
    $status.StartInfo.UseShellExecute = $false
    try {
      if ($status.Start() -and $status.WaitForExit(5000) -and $status.ExitCode -eq 0) {
        $clusterStarted = $true
      }
    } catch { }
    $status.Dispose()
  }
  if ($clusterStarted) {
    try {
      Invoke-BoundedUnredirectedNative $pgCtl @('-D',$dataDirectory,'-m','fast','-w','stop') 'pg_ctl-stop' 120
      $clusterStarted = $false
    } catch { Write-Warning 'Validation cluster did not stop cleanly; its marked data directory was preserved.' }
  }
  if ($clusterCreated -and -not $clusterStarted) {
    $resolvedTarget = [IO.Path]::GetFullPath($dataDirectory)
    $expectedRoot = [IO.Path]::GetFullPath($workRoot + [IO.Path]::DirectorySeparatorChar)
    $markerPath = Join-Path $dataDirectory $marker
    $markerMatches = (Test-Path -LiteralPath $markerPath) -and ((Get-Content -LiteralPath $markerPath -Raw).Trim() -eq $runId)
    $versionMatches = (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION')) -and ((Get-Content -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -Raw).Trim() -eq '18')
    if ($resolvedTarget.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase) -and $markerMatches -and $versionMatches) {
      Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
      Write-Output 'Verified temporary PostgreSQL cluster stopped and removed; private validation logs retained.'
    } else {
      Write-Warning 'Cluster identity checks failed; preserving the data directory for review.'
    }
  }
}
