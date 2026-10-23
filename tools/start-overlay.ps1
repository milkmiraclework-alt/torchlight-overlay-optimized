param([switch]$Check)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$version=(Get-Content -LiteralPath (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$portable=Join-Path $root ('desktop\dist\builds\'+$version+'\Torchlight-Overlay-Portable-'+$version+'-x64.exe')
$exe=if(Test-Path -LiteralPath $portable){$portable}else{Join-Path $root ('desktop\dist\builds\'+$version+'\win-unpacked\Torchlight Overlay.exe')}
if (!(Test-Path -LiteralPath $exe)) { throw 'Build the application with Build-Standalone.cmd or download the Portable EXE from Releases.' }
if ($Check) { Write-Output ('Ready: '+$exe);exit 0 }
Start-Process -FilePath $exe -WorkingDirectory $root -WindowStyle Hidden
