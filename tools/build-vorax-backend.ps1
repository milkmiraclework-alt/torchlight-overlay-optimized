param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$portable = Join-Path (Split-Path -Parent $root) 'sandbox\rust-tools'
if (!(Get-Command cargo -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $portable 'cargo\bin\cargo.exe'))) {
  $env:CARGO_HOME = Join-Path $portable 'cargo'
  $env:RUSTUP_HOME = Join-Path $portable 'rustup'
  $env:PATH = (Join-Path $portable 'cargo\bin') + ';' + (Join-Path $portable 'w64devkit\bin') + ';' + $env:PATH
  $env:RUSTFLAGS = '-C link-self-contained=yes'
}
& cargo test --manifest-path (Join-Path $root 'vorax\Cargo.toml') --release --locked -p vorax --test parity --test smart
if ($LASTEXITCODE -ne 0) { throw 'Vorax rules/Smart parity failed.' }
& cargo test --manifest-path (Join-Path $root 'vorax\Cargo.toml') --release --locked -p vorax-scan --lib --test parity --test round --test faint_label
if ($LASTEXITCODE -ne 0) { throw 'Vorax recognition checks failed.' }
& cargo build --manifest-path (Join-Path $root 'vorax\Cargo.toml') --release --locked -p vorax-overlay
if ($LASTEXITCODE -ne 0) { throw 'Vorax backend build failed.' }
$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'vorax\target' }
$dest = Join-Path $root 'desktop\native'
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -LiteralPath (Join-Path $target 'release\vorax-overlay.exe') -Destination (Join-Path $dest 'vorax-backend.exe')
$node = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($node) { $node.Source } else { Join-Path (Split-Path -Parent $root) 'sandbox\runtime\node.exe' }
& $nodeExe (Join-Path $PSScriptRoot 'vorax-manifest.js') --write
if ($LASTEXITCODE -ne 0) { throw 'Vorax source manifest failed.' }
