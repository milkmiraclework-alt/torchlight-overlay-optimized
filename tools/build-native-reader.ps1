param()
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
Push-Location $root
try {
 & rustc tools/scan-kernels.rs --edition=2021 --crate-type cdylib -C opt-level=3 -C panic=abort -C link-self-contained=yes -C strip=symbols -o desktop/native/tartarus-reader.dll
 if ($LASTEXITCODE -ne 0) {throw 'Native reader compilation failed.'}
 $importLibrary=Join-Path $root 'desktop/native/libtartarus-reader.dll.a'
 if (Test-Path -LiteralPath $importLibrary) {Remove-Item -LiteralPath $importLibrary}
 & node tools/native-reader-manifest.js --write
 if ($LASTEXITCODE -ne 0) {throw 'Native reader manifest failed.'}
} finally {Pop-Location}
