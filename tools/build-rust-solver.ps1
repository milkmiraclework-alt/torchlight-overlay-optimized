param([switch]$Native)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$portable = Join-Path $workspace 'sandbox\rust-tools'
$command = Get-Command cargo -ErrorAction SilentlyContinue
if ($command) { $cargo = $command.Source }
elseif (Test-Path -LiteralPath (Join-Path $portable 'cargo\bin\cargo.exe')) {
  $env:RUSTUP_HOME = Join-Path $portable 'rustup'
  $env:CARGO_HOME = Join-Path $portable 'cargo'
  $cargo = Join-Path $portable 'cargo\bin\cargo.exe'
} else { throw 'Install Rust and the wasm32-unknown-unknown target to rebuild the solver.' }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodeExe = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $workspace 'sandbox\runtime\node.exe' }
& $nodeExe (Join-Path $PSScriptRoot 'generate-rust-data.js')
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the shared strategy data.' }
$manifest = Join-Path $workspace 'native\tartarus\Cargo.toml'
$previousFlags = $env:RUSTFLAGS
try {
  $env:RUSTFLAGS = '-C link-arg=--max-memory=134217728'
  & $cargo build --manifest-path $manifest --locked --release --target wasm32-unknown-unknown --lib
  if ($LASTEXITCODE -ne 0) { throw 'Rust solver build failed. Run rustup target add wasm32-unknown-unknown if the target is missing.' }
  Copy-Item -LiteralPath (Join-Path $workspace 'native\tartarus\target\wasm32-unknown-unknown\release\tartarus_core.wasm') -Destination (Join-Path $workspace 'js\solver-core.wasm')
  if ($Native) {
    $env:RUSTFLAGS = $previousFlags
    if (Test-Path -LiteralPath (Join-Path $portable 'w64devkit\bin')) {
      $env:PATH = (Join-Path $portable 'w64devkit\bin') + ';' + $env:PATH
      $env:RUSTFLAGS = '-C link-self-contained=yes'
    }
    & $cargo build --manifest-path $manifest --locked --release
    if ($LASTEXITCODE -ne 0) { throw 'Native solver diagnostic build failed.' }
  }
  & $nodeExe (Join-Path $PSScriptRoot 'rust-solver-manifest.js') --write
  if ($LASTEXITCODE -ne 0) { throw 'Rust solver fingerprint generation failed.' }
} finally { $env:RUSTFLAGS = $previousFlags }
