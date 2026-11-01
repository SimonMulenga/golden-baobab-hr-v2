param(
  [Parameter(Mandatory = $true)]
  [string]$ArchivePath,
  [string]$ExpectedLatestMigration = '20261031004800',
  [int]$ExpectedMigrationCount = 48,
  [switch]$ValidateMigration050,
  [int]$Port = 55432
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# One-off, disposable local cluster. Never points at the linked Supabase project.
$archive = [IO.Path]::GetFullPath($ArchivePath)
$backupRoot = Split-Path -Parent $archive
$archiveStem = [IO.Path]::GetFileNameWithoutExtension($archive)
$rolesDump = Join-Path $backupRoot "$archiveStem-roles.sql"
$manifestPath = Join-Path $backupRoot "$archiveStem-manifest.json"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$migration050 = Join-Path $repoRoot 'supabase\migrations\20261101005000_employee_review_and_user_assignment_lifecycle.sql'
$workflowTest050 = Join-Path $repoRoot 'supabase\tests\rls\hr_payroll_workflows.test.sql'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$workRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'GoldenBaobab\restore-validation') "local-pg18-$runId"
$dataDirectory = Join-Path $workRoot 'data'
$port = $Port
$targetDatabase = 'gbhr_restore_validation'
$bin = 'C:\Program Files\PostgreSQL\18\bin'
$initdb = Join-Path $bin 'initdb.exe'
$pgCtl = Join-Path $bin 'pg_ctl.exe'
$psql = Join-Path $bin 'psql.exe'
$createdb = Join-Path $bin 'createdb.exe'
$pgRestore = Join-Path $bin 'pg_restore.exe'
$marker = '.golden-baobab-disposable-cluster'
$clusterStarted = $false
$clusterCreated = $false
$restoreSucceeded = $false
$oldPgEnv = @{}

function Quote-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-LocalProcess([string]$Executable, [string[]]$Arguments, [string]$Name, [int]$TimeoutSeconds, [string]$LogStem, [switch]$NoRedirect) {
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = (($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' ')
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = -not $NoRedirect
  $startInfo.RedirectStandardOutput = -not $NoRedirect
  $startInfo.RedirectStandardError = -not $NoRedirect
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $startInfo
  try {
    if (-not $process.Start()) { throw 'Process.Start returned false.' }
  } catch {
    $process.Dispose()
    throw "$Name process-start failure: $($_.Exception.Message)"
  }
  $stdoutTask = if ($NoRedirect) { $null } else { $process.StandardOutput.ReadToEndAsync() }
  $stderrTask = if ($NoRedirect) { $null } else { $process.StandardError.ReadToEndAsync() }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  while (-not $process.WaitForExit(1000)) {
    if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
      try { $process.Kill() } catch { }
      if (-not $process.WaitForExit(5000)) { $process.Dispose(); throw "$Name timeout; process termination could not be confirmed." }
      if (-not $NoRedirect) {
        [IO.File]::WriteAllText("$LogStem.out", $stdoutTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
        [IO.File]::WriteAllText("$LogStem.err", $stderrTask.GetAwaiter().GetResult(), [Text.UTF8Encoding]::new($false))
      }
      $process.Dispose()
      throw "$Name timed out after $TimeoutSeconds seconds; process stopped. Logs: $LogStem.out and $LogStem.err"
    }
  }
  if (-not $process.HasExited -and -not $process.WaitForExit(5000)) { $process.Dispose(); throw "$Name failed to reach an exited state." }
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $stdout = if ($NoRedirect) { '' } else { $stdoutTask.GetAwaiter().GetResult() }
  $stderr = if ($NoRedirect) { '' } else { $stderrTask.GetAwaiter().GetResult() }
  $process.Dispose()
  if (-not $NoRedirect) {
    [IO.File]::WriteAllText("$LogStem.out", $stdout, [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText("$LogStem.err", $stderr, [Text.UTF8Encoding]::new($false))
  }
  if ($null -eq $exitCode) { throw "$Name exited but Windows supplied no exit code. Logs: $LogStem.out and $LogStem.err" }
  if ([int]$exitCode -ne 0) {
    $detail = (($stderr -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 8) -join ' '
    $detail = $detail -replace '(?i)postgres(?:ql)?://\S+', '[connection URI redacted]'
    if (-not $detail) { $detail = 'nonzero exit with empty stderr' }
    throw "$Name failed with exit code $exitCode. Detail: $detail. Logs: $LogStem.out and $LogStem.err"
  }
  return $stdout
}

if (Test-Path -LiteralPath $workRoot) { throw "Isolated restore work path already exists; refusing to reuse it: $workRoot" }
if (Test-Path -LiteralPath $dataDirectory) { throw 'Target data directory already exists; refusing to initialize or overwrite it.' }
if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or -not (Test-Path -LiteralPath $rolesDump -PathType Leaf) -or -not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Verified development archive, role export, or manifest is missing.' }
foreach ($tool in @($initdb,$pgCtl,$psql,$createdb,$pgRestore)) { if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required installed PostgreSQL 18 tool is unavailable: $tool" } }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$actualHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
if ($actualHash -ne $manifest.archive_sha256 -or (Get-Item -LiteralPath $archive).Length -ne $manifest.archive_bytes) { throw 'Archive checksum or size does not match its verified manifest.' }
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Loopback restore port $port is already occupied; refusing to connect to an unidentified service." }

New-Item -ItemType Directory -Path $workRoot | Out-Null
$who = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$acl = Get-Acl -LiteralPath $workRoot
$acl.SetAccessRuleProtection($true, $false)
$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
$acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($who, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $workRoot -AclObject $acl
$cipher = Join-Path $env:SystemRoot 'System32\cipher.exe'
if (-not (Test-Path -LiteralPath $cipher -PathType Leaf)) { throw 'Windows EFS utility is unavailable; refusing an unencrypted restore workspace.' }
& $cipher /e $workRoot | Out-Null
if ($LASTEXITCODE -ne 0 -or -not ((Get-Item -LiteralPath $workRoot).Attributes -band [IO.FileAttributes]::Encrypted)) {
  throw 'Could not enable EFS on the isolated restore workspace.'
}

foreach ($entry in Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }) { $oldPgEnv[$entry.Name] = $entry.Value }
try {
  foreach ($name in @($oldPgEnv.Keys)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $initOut = Join-Path $workRoot 'initdb'
  Invoke-LocalProcess $initdb @('-D',$dataDirectory,'-U','postgres','--encoding=UTF8','--no-locale','--auth-local=trust','--auth-host=trust') 'initdb' 60 $initOut | Out-Null
  if (-not (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION'))) { throw 'initdb returned success but did not create the expected PostgreSQL cluster marker.' }
  if ((Get-Content -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -Raw).Trim() -ne '18') { throw 'Fresh target cluster version is not PostgreSQL 18.' }
  [IO.File]::WriteAllText((Join-Path $dataDirectory $marker), $runId, [Text.UTF8Encoding]::new($false))
  $clusterCreated = $true

  $env:PGHOST = '127.0.0.1'; $env:PGPORT = [string]$port; $env:PGUSER = 'postgres'; $env:PGDATABASE = 'postgres'
  $env:PGSSLMODE = 'disable'; $env:PGCONNECT_TIMEOUT = '5'; $env:PGAPPNAME = 'gbhr-isolated-restore-validation'
  $serverLog = Join-Path $workRoot 'postgres-server.log'
  Invoke-LocalProcess $pgCtl @('-D',$dataDirectory,'-o',"-h 127.0.0.1 -p $port",'-l',$serverLog,'-w','start') 'pg_ctl start' 30 (Join-Path $workRoot 'start') -NoRedirect | Out-Null
  $clusterStarted = $true

  $identityQuery = "select current_database()||'|'||current_user||'|'||coalesce(inet_server_addr()::text,'local')||'|'||current_setting('port')||'|'||current_setting('server_version_num');"
  $identity = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',$identityQuery) 'local target identity check' 10 (Join-Path $workRoot 'identity')).Trim()
  if ($identity -notmatch "^postgres\|postgres\|127\.0\.0\.1(?:/32)?\|$port\|180[0-9]{3}$") { throw 'Fresh target identity did not match local loopback PostgreSQL 18; restore stopped.' }
  $databaseList = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select datname from pg_database where datallowconn and not datistemplate order by datname;") 'fresh cluster database check' 10 (Join-Path $workRoot 'databases')).Trim()
  if ($databaseList -ne 'postgres') { throw 'Fresh isolated cluster contains an unexpected connectable database; restore stopped.' }

  Invoke-LocalProcess $createdb @('-w',$targetDatabase) 'create isolated restore database' 10 (Join-Path $workRoot 'createdb') | Out-Null
  $env:PGDATABASE = $targetDatabase
  $emptyCount = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema');") 'target emptiness check' 10 (Join-Path $workRoot 'empty')).Trim()
  if ($emptyCount -ne '0') { throw 'Restore database was not empty before restore; refusing to continue.' }

  # Supabase's managed schemas are provisioned by its platform and are not
  # recreated from this archive's schema TOC entries by pg_restore filtering.
  Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-c',
    'CREATE SCHEMA app_private; CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA storage; CREATE SCHEMA supabase_migrations;') 'create isolated schema containers' 10 (Join-Path $workRoot 'schemas') | Out-Null

  $roleSql = Get-Content -LiteralPath $rolesDump -Raw
  $roleMatches = [regex]::Matches($roleSql, '(?im)^\s*CREATE ROLE\s+"?(?<name>[A-Za-z0-9_-]+)"?\s*;')
  $roleNames = @($roleMatches | ForEach-Object { $_.Groups['name'].Value } | Sort-Object -Unique | Where-Object { $_ -ne 'postgres' -and $_ -notmatch '^pg_' })
  $roleStatements = foreach ($roleName in $roleNames) {
    $quotedRole = '"' + $roleName.Replace('"', '""') + '"'
    "DO `$gb`$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$roleName') THEN EXECUTE 'CREATE ROLE $quotedRole NOLOGIN'; END IF; END `$gb`$;"
  }
  $roleFile = Join-Path $workRoot 'placeholder-roles.sql'
  [IO.File]::WriteAllText($roleFile, ($roleStatements -join "`n"), [Text.UTF8Encoding]::new($false))
  $env:PGDATABASE = 'postgres'
  Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$roleFile) 'create isolated placeholder roles' 20 (Join-Path $workRoot 'roles') | Out-Null
  $env:PGDATABASE = $targetDatabase

  # Supabase-specific managed schemas and Vault are excluded. The local PostgreSQL
  # install has no supabase_vault extension; this validates the application schemas only.
  $toc = Invoke-LocalProcess $pgRestore @('--list',$archive) 'read archive restore list' 20 (Join-Path $workRoot 'toc')
  $toc = ($toc -split "`r?`n" | ForEach-Object {
    if ($_ -match 'EXTENSION - supabase_vault\s*$' -or $_ -match 'COMMENT - EXTENSION supabase_vault\s*$') { '; ' + $_ } else { $_ }
  }) -join "`n"
  $tocPath = Join-Path $workRoot 'restore.toc'
  [IO.File]::WriteAllText($tocPath, $toc, [Text.UTF8Encoding]::new($false))
  $restoreArgs = @('--exit-on-error','--single-transaction','--no-owner','--dbname',$targetDatabase,'--use-list',$tocPath,
    '--schema=public','--schema=app_private','--schema=auth','--schema=extensions','--schema=storage','--schema=supabase_migrations',$archive)
  Invoke-LocalProcess $pgRestore $restoreArgs 'application-schema partial restore' 180 (Join-Path $workRoot 'restore') | Out-Null
  $restoreSucceeded = $true

  if ($ValidateMigration050) {
    foreach ($path in @($migration050, $workflowTest050)) {
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Migration 050 isolated-validation input is missing: $path" }
    }
    $collisionQuery = @"
select 'fixture_id_collisions|' ||
  (select count(*) from auth.users where id in ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000007')) +
  (select count(*) from public.profiles where id in ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000000007')) +
  (select count(*) from public.client_portfolios where id in ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')) +
  (select count(*) from public.companies where id in ('20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003')) +
  (select count(*) from public.branches where id in ('30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004')) +
  (select count(*) from public.employees where id in ('40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000003')) +
  (select count(*) from public.employee_deductions where id = '50000000-0000-0000-0000-000000000001') +
  (select count(*) from public.payroll_periods where id = '60000000-0000-0000-0000-000000000001') +
  (select count(*) from public.payroll_runs where id = '70000000-0000-0000-0000-000000000001');
"@
    $collision = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',$collisionQuery) 'migration 050 fixture collision check' 10 (Join-Path $workRoot 'm050-fixture-collisions')).Trim()
    if ($collision -ne 'fixture_id_collisions|0') { throw 'Synthetic migration 050 test identifiers collide with restored records; rollback test stopped.' }
    Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-1','-f',$migration050) 'migration 050 isolated application' 60 (Join-Path $workRoot 'm050-apply') | Out-Null
    $localPgtapShimSql = @'
create extension if not exists pgcrypto with schema extensions;
create or replace function extensions.plan(integer) returns text language plpgsql as $function$
begin
  perform set_config('gbhr_test.expected', $1::text, true);
  perform set_config('gbhr_test.assertions', '0', true);
  return '1..' || $1::text;
end
$function$;
create or replace function extensions.is(anycompatible, anycompatible, text) returns text language plpgsql as $function$
declare n integer;
begin
  n := coalesce(nullif(current_setting('gbhr_test.assertions', true), '')::integer, 0) + 1;
  if $1 is distinct from $2 then raise exception using errcode='P0001', message=format('assertion %s failed: %s', n, $3); end if;
  perform set_config('gbhr_test.assertions', n::text, true);
  return format('ok %s - %s', n, $3);
end
$function$;
create or replace function extensions.ok(boolean, text) returns text language plpgsql as $function$
declare n integer;
begin
  n := coalesce(nullif(current_setting('gbhr_test.assertions', true), '')::integer, 0) + 1;
  if $1 is not true then raise exception using errcode='P0001', message=format('assertion %s failed: %s', n, $2); end if;
  perform set_config('gbhr_test.assertions', n::text, true);
  return format('ok %s - %s', n, $2);
end
$function$;
create or replace function extensions.throws_ok(text, text, text) returns text language plpgsql as $function$
declare actual_state text; n integer;
begin
  begin
    execute $1;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
  end;
  n := coalesce(nullif(current_setting('gbhr_test.assertions', true), '')::integer, 0) + 1;
  if actual_state is distinct from $2 then raise exception using errcode='P0001', message=format('assertion %s expected SQLSTATE %s, got %s: %s', n, $2, coalesce(actual_state,'none'), $3); end if;
  perform set_config('gbhr_test.assertions', n::text, true);
  return format('ok %s - %s', n, $3);
end
$function$;
create or replace function extensions.finish() returns table(result text) language plpgsql as $function$
declare expected integer; actual integer;
begin
  expected := current_setting('gbhr_test.expected')::integer;
  actual := current_setting('gbhr_test.assertions')::integer;
  if actual <> expected then raise exception 'test plan expected % assertions, observed %', expected, actual; end if;
  result := '1..' || expected::text;
  return next;
end
$function$;
grant usage on schema extensions to public;
grant execute on all functions in schema extensions to public;
'@
    $localPgtapShimPath = Join-Path $workRoot 'local-pgtap-shim.sql'
    [IO.File]::WriteAllText($localPgtapShimPath, $localPgtapShimSql, [Text.UTF8Encoding]::new($false))
    Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$localPgtapShimPath) 'install local pgTAP-compatible assertion shim' 10 (Join-Path $workRoot 'm050-pgtap-shim') | Out-Null
    $workflowOutput = Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-f',$workflowTest050) 'migration 050 rollback authorization tests' 120 (Join-Path $workRoot 'm050-workflows')
    if ($workflowOutput -match '(?m)^not ok\s' -or $workflowOutput -match 'Looks like you failed') { throw "Migration 050 authorization regression tests failed; see $workRoot\m050-workflows.out" }
    if ($workflowOutput -notmatch '(?m)^\s*1\.\.90\s*$') { throw "Migration 050 authorization regression test plan was not completed; see $workRoot\m050-workflows.out" }
    Write-Output 'ISOLATED_M050_VALIDATED migration 050 applied to the restored local copy; rollback authorization tests passed.'
  }

  $validationSql = @"
select 'target|'||current_database()||'|'||current_user||'|'||inet_server_addr()||'|'||current_setting('server_version_num');
select 'tables_public|'||count(*) from pg_tables where schemaname='public';
select 'constraints_public|'||count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public';
select 'functions_app|'||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private');
select 'policies_public|'||count(*) from pg_policies where schemaname='public';
select 'rls_enabled_public|'||count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity;
select 'table_grants_public|'||count(*) from information_schema.role_table_grants where table_schema='public';
select 'employees|'||count(*) from public.employees;
select 'payroll_runs|'||count(*) from public.payroll_runs;
select 'payroll_items|'||count(*) from public.payroll_run_items;
select 'leave_requests|'||count(*) from public.leave_requests;
select 'attendance_periods|'||count(*) from public.attendance_periods;
select 'attendance_entries|'||count(*) from public.attendance_entries;
select 'compensation|'||count(*) from public.employee_compensation;
select 'audit_logs|'||count(*) from public.audit_logs;
select 'companies|'||count(*) from public.companies;
select 'branches|'||count(*) from public.branches;
select 'auth_users|'||count(*) from auth.users;
select 'storage_buckets|'||count(*) from storage.buckets;
select 'storage_objects|'||count(*) from storage.objects;
select 'migration_history|'||count(*)||'|'||coalesce(min(version),'')||'|'||coalesce(max(version),'') from supabase_migrations.schema_migrations;
select 'extensions|'||coalesce(string_agg(extname,',' order by extname),'') from pg_extension where extname in ('pgcrypto','pg_stat_statements','uuid-ossp','supabase_vault');
"@
  $validationFile = Join-Path $workRoot 'validation.sql'
  [IO.File]::WriteAllText($validationFile, $validationSql, [Text.UTF8Encoding]::new($false))
  Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$validationFile) 'post-restore structural checks' 30 (Join-Path $workRoot 'validation') | Out-Null
  $validation = Get-Content -LiteralPath (Join-Path $workRoot 'validation.out')
  $migrationExpected = "^migration_history\|$ExpectedMigrationCount\|20261028000100\|$ExpectedLatestMigration$"
  if (-not ($validation -match '^tables_public\|[1-9][0-9]*$') -or -not ($validation -match '^constraints_public\|[1-9][0-9]*$') -or -not ($validation -match '^functions_app\|[1-9][0-9]*$') -or -not ($validation -match $migrationExpected)) {
    throw "Restored application objects or migration history did not meet expectations. See $workRoot\validation.out"
  }
  Write-Output "PARTIAL_RESTORE_VERIFIED target=local-loopback-postgresql-18 database=$targetDatabase migrations=$ExpectedMigrationCount latest=$ExpectedLatestMigration; details=$workRoot\validation.out"
  Write-Output 'Supabase Auth and Storage schemas/metadata were restored, but platform-managed Auth/Storage behavior, Vault secrets, role passwords, Storage object bytes, and project settings were not validated by this partial local restore.'
} finally {
  foreach ($name in @((Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }).Name)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  foreach ($name in $oldPgEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldPgEnv[$name], 'Process') }
  if ($clusterStarted) {
    try {
      Invoke-LocalProcess $pgCtl @('-D',$dataDirectory,'-m','fast','-w','-t','90','stop') 'pg_ctl stop' 100 (Join-Path $workRoot 'stop') | Out-Null
      $clusterStarted = $false
    } catch { Write-Warning 'Isolated restore cluster did not stop cleanly; its data directory was preserved.' }
  }
  if ($clusterCreated -and -not $clusterStarted) {
    $resolvedTarget = [IO.Path]::GetFullPath($dataDirectory)
    $expectedRoot = [IO.Path]::GetFullPath($workRoot + [IO.Path]::DirectorySeparatorChar)
    $markerPath = Join-Path $dataDirectory $marker
    $markerMatches = (Test-Path -LiteralPath $markerPath) -and ((Get-Content -LiteralPath $markerPath -Raw).Trim() -eq $runId)
    $versionMatches = (Test-Path -LiteralPath (Join-Path $dataDirectory 'PG_VERSION')) -and ((Get-Content -LiteralPath (Join-Path $dataDirectory 'PG_VERSION') -Raw).Trim() -eq '18')
    $inExpectedRoot = $resolvedTarget.StartsWith($expectedRoot, [StringComparison]::OrdinalIgnoreCase)
    $servicePath = 'C:\Program Files\PostgreSQL\18\data'
    $isExistingServicePath = [string]::Equals($resolvedTarget, [IO.Path]::GetFullPath($servicePath), [StringComparison]::OrdinalIgnoreCase)
    if ($inExpectedRoot -and $markerMatches -and $versionMatches -and -not $isExistingServicePath) {
      Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
      Write-Output 'Verified temporary PostgreSQL cluster stopped and removed; validation logs retained in the per-run work directory.'
    } else {
      Write-Warning 'Temporary cluster identity checks failed; the data directory was preserved for manual review.'
    }
  }
}
