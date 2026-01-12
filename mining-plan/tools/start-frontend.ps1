param(
  [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'

$frontendDir = Join-Path $PSScriptRoot '..\frontend' | Resolve-Path

try {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($null -ne $listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
  }
} catch {
  # ignore
}

Set-Location $frontendDir

npm.cmd run dev -- --host 0.0.0.0 --port $Port --strictPort
