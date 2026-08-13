Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory "..\.."))
$exporter = Join-Path $scriptDirectory "export-public.ps1"
$shell = if (Test-Path -LiteralPath (Join-Path $PSHOME "pwsh.exe")) {
  Join-Path $PSHOME "pwsh.exe"
} else {
  Join-Path $PSHOME "powershell.exe"
}
$tempParent = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd([char[]]"\/")
$tempRoot = Join-Path $tempParent ("bunbite-public-export-test-{0}-{1}" -f $PID, [Guid]::NewGuid().ToString("N"))

function Invoke-Exporter {
  param(
    [Parameter(Mandatory = $true)][string]$Target,
    [Parameter(Mandatory = $true)][string]$Destination,
    [switch]$AllowNonEmpty
  )

  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $exporter, "-Target", $Target, "-Destination", $Destination)
  if ($AllowNonEmpty) {
    $arguments += "-AllowNonEmptyDestination"
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & $shell @arguments 2>&1 | ForEach-Object { Write-Verbose $_ }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
  return $exitCode
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )
  if (-not $Condition) {
    throw $Message
  }
}

function Assert-Manifest {
  param([Parameter(Mandatory = $true)][string]$Destination)

  $manifestPath = Join-Path $Destination "SHA256SUMS.txt"
  foreach ($line in @(Get-Content -LiteralPath $manifestPath)) {
    Assert-True ($line -match "^([a-f0-9]{64})  (.+)$") "invalid manifest line: $line"
    $expectedHash = $Matches[1]
    $relativePath = $Matches[2].Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $filePath = [System.IO.Path]::GetFullPath((Join-Path $Destination $relativePath))
    Assert-True ($filePath.StartsWith($Destination, [System.StringComparison]::OrdinalIgnoreCase)) "manifest path escapes destination"
    Assert-True (Test-Path -LiteralPath $filePath -PathType Leaf) "manifest file is missing: $relativePath"
    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-True ($actualHash -eq $expectedHash) "manifest hash mismatch: $relativePath"
  }
}

try {
  New-Item -ItemType Directory -Path $tempRoot | Out-Null

  foreach ($target in @("web", "extension")) {
    $destination = Join-Path $tempRoot $target
    $exitCode = Invoke-Exporter -Target $target -Destination $destination
    Assert-True ($exitCode -eq 0) "$target export failed"
    Assert-True (Test-Path -LiteralPath (Join-Path $destination "PUBLIC_EXPORT_INVENTORY.json") -PathType Leaf) "$target inventory is missing"
    Assert-True (Test-Path -LiteralPath (Join-Path $destination "SHA256SUMS.txt") -PathType Leaf) "$target manifest is missing"
    Assert-Manifest -Destination $destination
    $gitPaths = @(Get-ChildItem -LiteralPath $destination -Force -Recurse | Where-Object { $_.Name -eq ".git" })
    Assert-True ($gitPaths.Count -eq 0) "$target export contains .git metadata"
    if ($target -eq "web") {
      $webResidue = @(& rg -l -i "429b5cf|owner-risk-acceptance|openvex-security-hold|scout-unsuppressed|build-metadata\.json|runtime-evidence\.json" $destination 2>$null |
        Where-Object { $_ -notmatch "[\\/]scripts[\\/]public-export[\\/]test-public-export\.ps1$" })
      Assert-True ($webResidue.Count -eq 0) "web export contains stale or private compliance evidence references"
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $destination "server/lib/billing.ts"))) "web export contains billing.ts"
    }
    else {
      Assert-True (-not (Test-Path -LiteralPath (Join-Path $destination "extension"))) "extension export retained the parent extension wrapper"
      Assert-True (Test-Path -LiteralPath (Join-Path $destination "src/manifest.json") -PathType Leaf) "extension export is not standalone"
    }
  }

  $insideSource = Join-Path $scriptDirectory (".unsafe-probe-{0}" -f $PID)
  Assert-True (-not (Test-Path -LiteralPath $insideSource)) "inside-source probe already exists"
  $insideExitCode = Invoke-Exporter -Target "extension" -Destination $insideSource
  Assert-True ($insideExitCode -ne 0) "destination inside source was accepted"
  Assert-True (-not (Test-Path -LiteralPath $insideSource)) "inside-source rejection created output"

  $nonEmpty = Join-Path $tempRoot "non-empty"
  New-Item -ItemType Directory -Path $nonEmpty | Out-Null
  $sentinel = Join-Path $nonEmpty "keep-me.txt"
  [System.IO.File]::WriteAllText($sentinel, "preserve", [System.Text.Encoding]::ASCII)
  $nonEmptyExitCode = Invoke-Exporter -Target "extension" -Destination $nonEmpty
  Assert-True ($nonEmptyExitCode -ne 0) "non-empty destination was accepted without the safety flag"
  Assert-True ((Get-Content -LiteralPath $sentinel -Raw) -eq "preserve") "non-empty rejection changed the sentinel"

  $allowedExitCode = Invoke-Exporter -Target "extension" -Destination $nonEmpty -AllowNonEmpty
  Assert-True ($allowedExitCode -eq 0) "safe non-empty export failed"
  Assert-True ((Get-Content -LiteralPath $sentinel -Raw) -eq "preserve") "safe non-empty export changed the sentinel"

  $collision = Join-Path $tempRoot "collision"
  New-Item -ItemType Directory -Path $collision | Out-Null
  $collisionLicense = Join-Path $collision "LICENSE"
  [System.IO.File]::WriteAllText($collisionLicense, "do-not-overwrite", [System.Text.Encoding]::ASCII)
  $collisionExitCode = Invoke-Exporter -Target "extension" -Destination $collision -AllowNonEmpty
  Assert-True ($collisionExitCode -ne 0) "existing output collision was accepted"
  Assert-True ((Get-Content -LiteralPath $collisionLicense -Raw) -eq "do-not-overwrite") "collision rejection overwrote a file"

  $gitDestination = Join-Path $tempRoot "contains-git"
  New-Item -ItemType Directory -Path (Join-Path $gitDestination "nested/.git") -Force | Out-Null
  $gitExitCode = Invoke-Exporter -Target "extension" -Destination $gitDestination -AllowNonEmpty
  Assert-True ($gitExitCode -ne 0) "destination containing nested .git metadata was accepted"

  Write-Output "[OK] Public exporter self-test passed"
}
finally {
  $resolvedTempRoot = [System.IO.Path]::GetFullPath($tempRoot)
  $expectedPrefix = $tempParent + [System.IO.Path]::DirectorySeparatorChar + "bunbite-public-export-test-"
  if ((Test-Path -LiteralPath $resolvedTempRoot) -and
      $resolvedTempRoot.StartsWith($expectedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Remove-Item -LiteralPath $resolvedTempRoot -Recurse -Force
  }
}
