param([switch]$SkipInstall,[switch]$UnpackedOnly)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$node=Get-Command node -ErrorAction SilentlyContinue
$nodeExe=if ($node) {$node.Source} else {Join-Path (Split-Path -Parent $root) 'sandbox\runtime\node.exe'}
$npm=Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
$env:PATH=(Split-Path -Parent $nodeExe)+';'+$env:PATH
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
$version=(Get-Content -LiteralPath (Join-Path $root 'desktop\package.json') -Raw | ConvertFrom-Json).version
$out=Join-Path $root ('desktop\dist\builds\'+$version)
Push-Location (Join-Path $root 'desktop')
try {
 if (!$SkipInstall) {& $npm ci --no-audit --no-fund;if ($LASTEXITCODE -ne 0) {throw 'npm ci failed.'}}
 & $nodeExe (Join-Path $PSScriptRoot 'stage-overlay.js');if ($LASTEXITCODE -ne 0){throw 'Staging failed.'}
 $args=@('--win','--x64','--publish=never',('-c.directories.output='+$out));if ($UnpackedOnly){$args+='--dir'}
 & $nodeExe (Join-Path $root 'desktop\node_modules\electron-builder\cli.js') @args
 if ($LASTEXITCODE -ne 0){throw 'Packaging failed.'}
 $verify=@('--dist',$out);if ($UnpackedOnly){$verify+='--unpacked-only'}
 & $nodeExe (Join-Path $PSScriptRoot 'standalone-manifest.js') @verify
 if ($LASTEXITCODE -ne 0){throw 'Packaged verification failed.'}
} finally {Pop-Location}
