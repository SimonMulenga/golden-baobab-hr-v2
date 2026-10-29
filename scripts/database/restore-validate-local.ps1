Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# One-off, disposable local cluster. Never points at the linked Supabase project.
$backupRoot = Join-Path $env:LOCALAPPDATA 'GoldenBaobab\database-backups'
$archive = Join-Path $backupRoot 'gbhr-dev-20261029-133528.dump'
$rolesDump = Join-Path $backupRoot 'gbhr-dev-20261029-133528-roles.sql'
$manifestPath = Join-Path $backupRoot 'gbhr-dev-20261029-133528-manifest.json'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$workRoot = Join-Path (Join-Path $env:LOCALAPPDATA 'GoldenBaobab\restore-validation') "local-pg18-$runId"
$dataDirectory = Join-Path $workRoot 'data'
$port = 55432
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
  if ($identity -notmatch '^postgres\|postgres\|127\.0\.0\.1(?:/32)?\|55432\|180[0-9]{3}$') { throw 'Fresh target identity did not match local loopback PostgreSQL 18; restore stopped.' }
  $databaseList = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select datname from pg_database where datallowconn and not datistemplate order by datname;") 'fresh cluster database check' 10 (Join-Path $workRoot 'databases')).Trim()
  if ($databaseList -ne 'postgres') { throw 'Fresh isolated cluster contains an unexpected connectable database; restore stopped.' }

  Invoke-LocalProcess $createdb @('-w',$targetDatabase) 'create isolated restore database' 10 (Join-Path $workRoot 'createdb') | Out-Null
  $env:PGDATABASE = $targetDatabase
  $emptyCount = (Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',"select count(*) from pg_tables where schemaname not in ('pg_catalog','information_schema');") 'target emptiness check' 10 (Join-Path $workRoot 'empty')).Trim()
  if ($emptyCount -ne '0') { throw 'Restore database was not empty before restore; refusing to continue.' }

  # Supabase's managed schemas are provisioned by its platform and are not
  # recreated from this archive's schema TOC entries by pg_restore filtering.
  Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-c',
    'CREATE SCHEMA app_private; CREATE SCHEMA auth; CREATE SCHEMA extensions; CREATE SCHEMA supabase_migrations;') 'create isolated schema containers' 10 (Join-Path $workRoot 'schemas') | Out-Null

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
    '--schema=public','--schema=app_private','--schema=auth','--schema=extensions','--schema=supabase_migrations',$archive)
  Invoke-LocalProcess $pgRestore $restoreArgs 'application-schema partial restore' 180 (Join-Path $workRoot 'restore') | Out-Null
  $restoreSucceeded = $true

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
select 'migration_history|'||count(*)||'|'||coalesce(min(version),'')||'|'||coalesce(max(version),'') from supabase_migrations.schema_migrations;
select 'extensions|'||coalesce(string_agg(extname,',' order by extname),'') from pg_extension where extname in ('pgcrypto','pg_stat_statements','uuid-ossp','supabase_vault');
"@
  $validationFile = Join-Path $workRoot 'validation.sql'
  [IO.File]::WriteAllText($validationFile, $validationSql, [Text.UTF8Encoding]::new($false))
  Invoke-LocalProcess $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-f',$validationFile) 'post-restore structural checks' 30 (Join-Path $workRoot 'validation') | Out-Null
  $validation = Get-Content -LiteralPath (Join-Path $workRoot 'validation.out')
  if (-not ($validation -match '^tables_public\|[1-9][0-9]*$') -or -not ($validation -match '^constraints_public\|[1-9][0-9]*$') -or -not ($validation -match '^functions_app\|[1-9][0-9]*$') -or -not ($validation -match '^migration_history\|[1-9][0-9]*\|20261028000100\|20261028002700$')) {
    throw "Restored application objects or migration history did not meet expectations. See $workRoot\validation.out"
  }
  Write-Output "PARTIAL_RESTORE_VERIFIED target=local-loopback-postgresql-18 database=$targetDatabase; details=$workRoot\validation.out"
  Write-Output 'Supabase-managed schemas, Vault, platform role passwords, Storage object bytes, and project settings were not validated by this partial local restore.'
} finally {
  foreach ($name in @((Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }).Name)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  foreach ($name in $oldPgEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldPgEnv[$name], 'Process') }
  if ($clusterStarted) {
    try {
      Invoke-LocalProcess $pgCtl @('-D',$dataDirectory,'-m','fast','-w','stop') 'pg_ctl stop' 30 (Join-Path $workRoot 'stop') | Out-Null
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
