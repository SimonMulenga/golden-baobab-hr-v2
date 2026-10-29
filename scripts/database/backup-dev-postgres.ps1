param(
  [string]$CredentialFile = (Join-Path $env:LOCALAPPDATA 'GoldenBaobab\database-credentials\development-session-pooler.pgpass'),
  [string]$BackupDirectory = (Join-Path $env:LOCALAPPDATA 'GoldenBaobab\database-backups'),
  [int]$TimeoutMinutes = 45
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$hostName = 'aws-0-eu-west-1.pooler.supabase.com'
$port = '5432'
$database = 'postgres'
$user = 'postgres.jssuaebiizjcoqmngxzk'
$clientDirectory = 'C:\Program Files\PostgreSQL\18\bin'
$psql = Join-Path $clientDirectory 'psql.exe'
$pgDump = Join-Path $clientDirectory 'pg_dump.exe'
$pgDumpAll = Join-Path $clientDirectory 'pg_dumpall.exe'
$pgRestore = Join-Path $clientDirectory 'pg_restore.exe'

function Quote-NativeArgument([string]$Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + $Value.Replace('"', '\"') + '"'
}

function Invoke-BoundedNative([string]$Executable, [string[]]$Arguments, [string]$StdoutPath, [string]$StderrPath, [int]$TimeoutSeconds, [string]$Description, [string]$ProgressPath = '') {
  $quoted = ($Arguments | ForEach-Object { Quote-NativeArgument $_ }) -join ' '
  $startInfo = [Diagnostics.ProcessStartInfo]::new()
  $startInfo.FileName = $Executable
  $startInfo.Arguments = $quoted
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
    throw "$Description process-start failure for ${Executable}: $($_.Exception.Message)"
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $timer = [Diagnostics.Stopwatch]::StartNew()
  $lastProgressAt = 0
  $timedOut = $false
  while (-not $process.WaitForExit(1000)) {
    if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
      $timedOut = $true
      try { $process.Kill() } catch { }
      if (-not $process.WaitForExit(5000)) {
        $process.Dispose()
        throw "$Description timed out after $TimeoutSeconds seconds and the process could not be confirmed stopped."
      }
      break
    }
    if ($ProgressPath -and ($timer.Elapsed.TotalSeconds - $lastProgressAt -ge 15)) {
      $progressBytes = if (Test-Path -LiteralPath $ProgressPath) { (Get-Item -LiteralPath $ProgressPath).Length } else { 0 }
      Write-Output "$Description running for $([int]$timer.Elapsed.TotalSeconds)s; output bytes=$progressBytes."
      $lastProgressAt = $timer.Elapsed.TotalSeconds
    }
  }
  if (-not $process.HasExited) {
    if (-not $process.WaitForExit(5000)) {
      $process.Dispose()
      throw "$Description process did not finish exiting after WaitForExit."
    }
  }
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $stdoutText = $stdoutTask.GetAwaiter().GetResult()
  $stderrText = $stderrTask.GetAwaiter().GetResult()
  $process.Dispose()
  [IO.File]::WriteAllText($StdoutPath, $stdoutText, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($StderrPath, $stderrText, [Text.UTF8Encoding]::new($false))
  if ($timedOut) { throw "$Description timed out after $TimeoutSeconds seconds; the process was terminated and confirmed exited. Logs: $StdoutPath and $StderrPath" }
  if ($null -eq $exitCode) { throw "$Description exited, but Windows did not provide an exit code. Logs: $StdoutPath and $StderrPath" }
  if ([int]$exitCode -ne 0) {
    $detail = (($stderrText -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -Last 8) -join ' '
    $detail = $detail -replace '(?i)postgres(?:ql)?://\S+', '[connection URI redacted]'
    $detail = $detail -replace '(?i)(password\s*=\s*)\S+', '$1[redacted]'
    if (-not $detail) { $detail = 'Process returned a nonzero exit code without stderr output.' }
    throw "$Description failed with exit code $exitCode. Sanitized detail: $detail"
  }
}

if ($TimeoutMinutes -lt 1 -or $TimeoutMinutes -gt 120) { throw 'TimeoutMinutes must be between 1 and 120.' }
if (-not (Test-Path -LiteralPath $CredentialFile -PathType Leaf)) {
  throw "Credential file is unavailable: $CredentialFile. Run setup-dev-pgpass.ps1 first; do not pass a password on the command line."
}
$credentialAcl = Get-Acl -LiteralPath $CredentialFile
if (-not $credentialAcl.AreAccessRulesProtected) { throw 'Credential file ACL inherits permissions; refusing to use an unprotected password file.' }
$allowedCredentialPrincipals = @([Security.Principal.WindowsIdentity]::GetCurrent().Name, 'NT AUTHORITY\SYSTEM')
$credentialRules = @($credentialAcl.Access | Where-Object { $_.AccessControlType -eq 'Allow' -and -not $_.IsInherited })
if (@($credentialRules | Where-Object { $_.IdentityReference.Value -notin $allowedCredentialPrincipals }).Count -gt 0 -or @($credentialRules | Where-Object { $_.FileSystemRights -notmatch 'FullControl' }).Count -gt 0) {
  throw 'Credential file ACL grants access beyond the expected current-user/SYSTEM full-control entries.'
}
foreach ($principal in $allowedCredentialPrincipals) {
  if (@($credentialRules | Where-Object { $_.IdentityReference.Value -eq $principal }).Count -eq 0) {
    throw 'Credential file ACL is missing an expected current-user or SYSTEM full-control entry.'
  }
}
$credentialLine = [IO.File]::ReadAllText($CredentialFile).TrimEnd("`r", "`n")
$credentialPattern = '^aws-0-eu-west-1\.pooler\.supabase\.com:5432:postgres:postgres\.jssuaebiizjcoqmngxzk:.+$'
if ($credentialLine -notmatch $credentialPattern) { throw 'Credential file does not match the configured development pooler target; refusing to connect.' }
foreach ($tool in @($psql, $pgDump, $pgDumpAll, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Required PostgreSQL client is missing: $tool" }
}

$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
New-Item -ItemType Directory -Path $BackupDirectory -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$backupAcl = Get-Acl -LiteralPath $BackupDirectory
$backupAcl.SetAccessRuleProtection($true, $false)
$backupAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
$backupAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$backupAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $BackupDirectory -AclObject $backupAcl
$archive = Join-Path $BackupDirectory "gbhr-dev-$runId.dump"
$rolesFile = Join-Path $BackupDirectory "gbhr-dev-$runId-roles.sql"
$listFile = Join-Path $BackupDirectory "gbhr-dev-$runId-archive-list.txt"
$manifestFile = Join-Path $BackupDirectory "gbhr-dev-$runId-manifest.json"
$preflightOut = Join-Path $BackupDirectory "gbhr-dev-$runId-preflight.out"
$preflightErr = Join-Path $BackupDirectory "gbhr-dev-$runId-preflight.err"
$dumpOut = Join-Path $BackupDirectory "gbhr-dev-$runId-dump.out"
$dumpErr = Join-Path $BackupDirectory "gbhr-dev-$runId-dump.err"
$rolesOut = Join-Path $BackupDirectory "gbhr-dev-$runId-roles.out"
$rolesErr = Join-Path $BackupDirectory "gbhr-dev-$runId-roles.err"
$verifyOut = Join-Path $BackupDirectory "gbhr-dev-$runId-verify.out"
$verifyErr = Join-Path $BackupDirectory "gbhr-dev-$runId-verify.err"

$oldPgEnv = @{}
foreach ($entry in Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }) { $oldPgEnv[$entry.Name] = $entry.Value }
try {
  foreach ($name in @($oldPgEnv.Keys)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $env:PGHOST = $hostName
  $env:PGPORT = $port
  $env:PGDATABASE = $database
  $env:PGUSER = $user
  $env:PGSSLMODE = 'require'
  $env:PGCONNECT_TIMEOUT = '8'
  $env:PGAPPNAME = 'gbhr-dev-backup-preflight'
  $env:PGPASSFILE = $CredentialFile

  Write-Output "Checking read-only connectivity to the configured development session pooler (timeout 8s)."
  $query = "select current_database() || '|' || current_setting('server_version_num') || '|' || current_user;"
  Invoke-BoundedNative $psql @('-X','-w','-v','ON_ERROR_STOP=1','-A','-t','-c',$query) $preflightOut $preflightErr 15 'PostgreSQL connection preflight'
  if (-not (Test-Path -LiteralPath $preflightOut -PathType Leaf)) { throw 'PostgreSQL connection preflight exited successfully but produced no stdout file.' }
  $connection = (Get-Content -LiteralPath $preflightOut -Raw).Trim()
  if (-not $connection) { throw 'PostgreSQL connection preflight produced empty stdout; refusing to dump.' }
  if ($connection -notmatch '^postgres\|(?<version>[0-9]+)\|postgres$') { throw 'Connection preflight returned an unexpected database or role; refusing to dump.' }
  $serverVersion = [int]$Matches.version
  $serverMajor = [int][Math]::Floor($serverVersion / 10000)
  $clientText = (& $pgDump --version 2>&1 | Out-String).Trim()
  if ($clientText -notmatch 'pg_dump \(PostgreSQL\) (?<version>[0-9]+)') { throw 'Could not determine the installed pg_dump major version.' }
  $clientMajor = [int]$Matches.version
  if ($clientMajor -lt $serverMajor) { throw "pg_dump major $clientMajor is older than server major $serverMajor; refusing an incompatible dump." }
  $serverVersionLabel = "$serverMajor.$($serverVersion % 10000)"
  Write-Output "Connected to PostgreSQL $serverVersionLabel using pg_dump $clientMajor. The client is compatible for this server major."

  $env:PGAPPNAME = 'gbhr-dev-native-backup'
  Write-Output "Starting custom-format database dump. Progress is written to $dumpErr; timeout is $TimeoutMinutes minutes."
  Invoke-BoundedNative $pgDump @('--no-password','--format=custom','--verbose','--file',$archive) $dumpOut $dumpErr ($TimeoutMinutes * 60) 'pg_dump' $archive
  if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or (Get-Item -LiteralPath $archive).Length -lt 1024) { throw 'Dump output is missing or implausibly small; archive verification failed.' }

  Write-Output 'Exporting role definitions without role passwords (separate globals file).'
  Invoke-BoundedNative $pgDumpAll @('--no-password','--roles-only','--no-role-passwords','--verbose') $rolesFile $rolesErr ($TimeoutMinutes * 60) 'pg_dumpall role export'
  if (-not (Test-Path -LiteralPath $rolesFile -PathType Leaf) -or (Get-Item -LiteralPath $rolesFile).Length -lt 10) { throw 'Role export output is missing or empty.' }

  Write-Output 'Listing the custom archive for structural verification.'
  Invoke-BoundedNative $pgRestore @('--list',$archive) $listFile $verifyErr 60 'pg_restore archive listing'
  $archiveEntries = @(Get-Content -LiteralPath $listFile | Where-Object { $_ -match '^\s*[0-9]+;' }).Count
  if ($archiveEntries -lt 1) { throw 'pg_restore --list returned no archive entries.' }
  $hash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
  $manifest = [ordered]@{
    project_ref = 'jssuaebiizjcoqmngxzk'
    database = $database
    pooler_mode = 'session'
    server_version = $serverVersionLabel
    pg_dump_version = $clientText
    created_at_utc = [DateTime]::UtcNow.ToString('o')
    archive_file = [IO.Path]::GetFileName($archive)
    archive_bytes = (Get-Item -LiteralPath $archive).Length
    archive_entries = $archiveEntries
    archive_sha256 = $hash
    roles_file = [IO.Path]::GetFileName($rolesFile)
    roles_file_sha256 = (Get-FileHash -LiteralPath $rolesFile -Algorithm SHA256).Hash
    roles_file_passwords = 'omitted'
    migration_history = 'Not included in this manifest; verified separately through Supabase CLI.'
  }
  [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
  Write-Output "BACKUP_VERIFIED archive=$archive bytes=$($manifest.archive_bytes) entries=$archiveEntries sha256=$hash"
  Write-Output "Roles are in $rolesFile (passwords omitted). Manifest: $manifestFile"
  Write-Output "Verbose logs: $dumpErr and $rolesErr. Review and protect this backup directory as sensitive HR/payroll data."
} finally {
  foreach ($name in @((Get-ChildItem Env: | Where-Object { $_.Name -like 'PG*' }).Name)) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  foreach ($name in $oldPgEnv.Keys) { [Environment]::SetEnvironmentVariable($name, $oldPgEnv[$name], 'Process') }
}
