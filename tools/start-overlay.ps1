param([switch]$Check)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$exe=Join-Path $root ('desktop\dist\builds\'+$version+'\win-unpacked\Torchlight Overlay.exe')
if (!(Test-Path -LiteralPath $exe)) { throw 'Build the application with Build-Standalone.cmd or download the Portable EXE from Releases.' }
if ($Check) { Write-Output ('Ready: '+$exe);exit 0 }
Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden
