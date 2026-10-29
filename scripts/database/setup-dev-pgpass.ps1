Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$hostName = 'aws-0-eu-west-1.pooler.supabase.com'
$port = '5432'
$database = 'postgres'
$user = 'postgres.jssuaebiizjcoqmngxzk'
$root = Join-Path $env:LOCALAPPDATA 'GoldenBaobab\database-credentials'
$credentialFile = Join-Path $root 'development-session-pooler.pgpass'

if (Test-Path -LiteralPath $credentialFile) {
  throw "Credential file already exists at $credentialFile. It was not overwritten. Use the backup script's -CredentialFile parameter if you maintain the file elsewhere."
}

New-Item -ItemType Directory -Path $root -Force | Out-Null
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$systemSid = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$directoryAcl = Get-Acl -LiteralPath $root
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
$directoryAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
$directoryAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $root -AclObject $directoryAcl

$securePassword = Read-Host 'Enter the existing development database password (input is hidden)' -AsSecureString
if ($securePassword.Length -eq 0) { throw 'No password entered; no credential file was written.' }
$bstr = [IntPtr]::Zero
$password = $null
$temporaryFile = "$credentialFile.$([guid]::NewGuid().ToString('N')).tmp"
try {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $escapedPassword = $password.Replace('\', '\\').Replace(':', '\:')
  $line = "$hostName`:$port`:$database`:$user`:$escapedPassword"
  [IO.File]::WriteAllText($temporaryFile, $line, [Text.UTF8Encoding]::new($false))
  $fileAcl = Get-Acl -LiteralPath $temporaryFile
  $fileAcl.SetAccessRuleProtection($true, $false)
  $fileAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
  $fileAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'Allow'))
  $fileAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new($systemSid, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $temporaryFile -AclObject $fileAcl
  Move-Item -LiteralPath $temporaryFile -Destination $credentialFile
  Write-Output "Credential file created with current-user and SYSTEM access only: $credentialFile"
  Write-Output 'The password was not displayed, logged, or placed in a command argument.'
} finally {
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  if (Test-Path -LiteralPath $temporaryFile) { Remove-Item -LiteralPath $temporaryFile -Force }
  if ($null -ne $password) { $password = $null }
  $securePassword.Dispose()
}
