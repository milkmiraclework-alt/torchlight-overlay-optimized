param([Parameter(Mandatory=$true)][string]$Plan)
$ErrorActionPreference = 'Stop'
$p = Get-Content -LiteralPath $Plan -Raw -Encoding UTF8 | ConvertFrom-Json
$hostExited = $false
$launched = $false
function Verified([string]$File) {
  if (!(Test-Path -LiteralPath $File -PathType Leaf)) { return $false }
  return (Get-Item -LiteralPath $File).Length -eq $p.size -and (Get-FileHash -LiteralPath $File -Algorithm SHA256).Hash.ToLowerInvariant() -eq $p.sha256
}
function Retry([scriptblock]$Action) {
  for ($attempt=0; $attempt -lt 100; $attempt++) {
    try { & $Action; return } catch { if ($attempt -eq 99) { throw }; Start-Sleep -Milliseconds 200 }
  }
}
function StartUpdate([string]$File,[string]$Arguments='') {
  # ProcessStartInfo keeps brackets and Unicode literal, including the working
  # directory; Start-Process resolves wildcard paths on older PowerShell.
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $File
  $start.WorkingDirectory = [IO.Path]::GetDirectoryName($File)
  $start.Arguments = $Arguments
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $child = [Diagnostics.Process]::Start($start)
  if (!$child) { throw 'Could not start the update.' }
  $child.Dispose()
}
try {
  if ($p.mode -notin @('portable','setup') -or $p.sha256 -notmatch '^[a-f0-9]{64}$' -or $p.id -notmatch '^[a-f0-9-]{36}$' -or [IO.Path]::GetExtension($p.source) -ne '.exe' -or !(Verified $p.source)) { throw 'Invalid update plan or file.' }
  $cache = [IO.Path]::GetFullPath((Split-Path -Parent $Plan))
  foreach ($item in @($p.source,$p.helper,$p.ready,$p.outcome,$p.cancel)) {
    if ([IO.Path]::GetFullPath((Split-Path -Parent $item)) -ne $cache) { throw 'Update file escaped its cache.' }
  }
  if ($p.mode -eq 'portable') {
    $target = [IO.Path]::GetFullPath($p.target)
    if ($target -ne $p.target -or [IO.Path]::GetExtension($target) -ne '.exe' -or $p.stage -ne ($target+'.update-'+$p.id+'.exe') -or $p.backup -ne ($target+'.update-'+$p.id+'.bak') -or !(Verified $p.stage)) { throw 'Invalid portable update paths.' }
  }
  # Pin the actual process handle before telling the host it can exit.
  $hostProcess = Get-Process -Id $p.pid -ErrorAction Stop
  $null = $hostProcess.Handle
  [IO.File]::WriteAllText($p.ready,'ready')
  if (!$hostProcess.WaitForExit(90000)) { throw 'The overlay did not exit; no files were replaced.' }
  if (Test-Path -LiteralPath $p.cancel) { exit 0 }
  $hostExited = $true
  if (!(Verified $p.source)) { throw 'Update changed while waiting.' }
  if ($p.mode -eq 'setup') {
    StartUpdate $p.source '/S --updated --force-run'
    $launched = $true
  } else {
    if (!(Verified $p.stage)) { throw 'Portable update changed while waiting.' }
    Retry { Move-Item -LiteralPath $p.target -Destination $p.backup -ErrorAction Stop }
    try {
      Move-Item -LiteralPath $p.stage -Destination $p.target -ErrorAction Stop
      if (!(Verified $p.target)) { throw 'Portable replacement verification failed.' }
      StartUpdate $p.target
      $launched = $true
    } catch {
      # Every path was checked above and is in the explicitly named EXE folder.
      if (Test-Path -LiteralPath $p.target) { Remove-Item -LiteralPath $p.target -Force }
      Move-Item -LiteralPath $p.backup -Destination $p.target -ErrorAction Stop
      StartUpdate $p.target
      $launched = $true
      throw
    }
  }
  @{ok=$true;version=$p.version} | ConvertTo-Json -Compress | Set-Content -LiteralPath $p.outcome -Encoding UTF8
} catch {
  if ($p.mode -eq 'portable' -and $hostExited -and !$launched -and (Test-Path -LiteralPath $p.target -PathType Leaf)) {
    try { StartUpdate $p.target } catch {}
  }
  @{ok=$false;error=$_.Exception.Message;where=$_.ScriptStackTrace} | ConvertTo-Json -Compress | Set-Content -LiteralPath $p.outcome -Encoding UTF8
  exit 1
}
