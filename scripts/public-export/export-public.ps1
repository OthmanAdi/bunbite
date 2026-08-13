[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet("web", "extension")]
  [string]$Target,

  [Parameter(Mandatory = $true, Position = 1)]
  [string]$Destination,

  [switch]$AllowNonEmptyDestination
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$inventoryName = "PUBLIC_EXPORT_INVENTORY.json"
$manifestName = "SHA256SUMS.txt"
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDirectory "..\.."))

function Get-NormalizedFullPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  if ([System.IO.Path]::IsPathRooted($Path)) {
    return [System.IO.Path]::GetFullPath($Path)
  }
  return [System.IO.Path]::GetFullPath((Join-Path (Get-Location).Path $Path))
}

function Test-PathContainedBy {
  param(
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$Container
  )

  $candidatePath = (Get-NormalizedFullPath -Path $Candidate).TrimEnd([char[]]"\/")
  $containerPath = (Get-NormalizedFullPath -Path $Container).TrimEnd([char[]]"\/")
  if ($candidatePath.Equals($containerPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }
  $prefix = $containerPath + [System.IO.Path]::DirectorySeparatorChar
  return $candidatePath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-Sha256Text {
  param([Parameter(Mandatory = $true)][string]$Path)

  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hashBytes = $sha256.ComputeHash($stream)
    return [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLowerInvariant()
  }
  finally {
    $stream.Dispose()
    $sha256.Dispose()
  }
}

function New-ExportEntry {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [string]$Output = $Source
  )

  return [pscustomobject]@{
    Source = $Source.Replace("\", "/")
    Output = $Output.Replace("\", "/")
  }
}

function Get-WebAllowlist {
  return @(
    (New-ExportEntry ".dockerignore")
    (New-ExportEntry ".gitignore")
    (New-ExportEntry "AUTHORS.md")
    (New-ExportEntry "DEPLOY.md")
    (New-ExportEntry "Dockerfile")
    (New-ExportEntry "LICENSE")
    (New-ExportEntry "README.md")
    (New-ExportEntry "SCALING.md")
    (New-ExportEntry "VERSION")
    (New-ExportEntry "docker-entrypoint.c")
    (New-ExportEntry "fly.toml")
    (New-ExportEntry "product.json")
    (New-ExportEntry "docs/DEPLOYMENT_RUNBOOK.md")
    (New-ExportEntry "docs/screenshots/extension-studio.png")
    (New-ExportEntry "docs/screenshots/web-studio.png")
    (New-ExportEntry "docs/social-preview.jpg")
    (New-ExportEntry "editions/public.json")
    (New-ExportEntry "public/app.js")
    (New-ExportEntry "public/apple-touch-icon.png")
    (New-ExportEntry "public/grain.png")
    (New-ExportEntry "public/icon-192.png")
    (New-ExportEntry "public/icon-512.png")
    (New-ExportEntry "public/i18n.js")
    (New-ExportEntry "public/extension-privacy.html")
    (New-ExportEntry "public/index.html")
    (New-ExportEntry "public/og.png")
    (New-ExportEntry "public/privacy.html")
    (New-ExportEntry "public/robots.txt")
    (New-ExportEntry "public/site.webmanifest")
    (New-ExportEntry "public/sitemap.xml")
    (New-ExportEntry "public/style.css")
    (New-ExportEntry "public/support.html")
    (New-ExportEntry "public/terms.html")
    (New-ExportEntry "scripts/i18n-check.mjs")
    (New-ExportEntry "scripts/public-browser-smoke.mjs")
    (New-ExportEntry "scripts/public-export/export-public.ps1")
    (New-ExportEntry "scripts/public-export/test-public-export.ps1")
    (New-ExportEntry "server/bun.lock")
    (New-ExportEntry "server/package.json")
    (New-ExportEntry "server/server.ts")
    (New-ExportEntry "server/lib/db.ts")
    (New-ExportEntry "server/lib/optimizer.ts")
    (New-ExportEntry "server/lib/ratelimit.ts")
    (New-ExportEntry "server/test/core.ts")
    (New-ExportEntry "server/test/e2e.ts")
  )
}

function Get-ExtensionAllowlist {
  return @(
    (New-ExportEntry "extension/.gitignore" ".gitignore")
    (New-ExportEntry "AUTHORS.md" "AUTHORS.md")
    (New-ExportEntry "LICENSE" "LICENSE")
    (New-ExportEntry "extension/PRIVACY.md" "PRIVACY.md")
    (New-ExportEntry "extension/README.md" "README.md")
    (New-ExportEntry "extension/RELEASE-CHECKLIST.md" "RELEASE-CHECKLIST.md")
    (New-ExportEntry "extension/STORE-LISTING.md" "STORE-LISTING.md")
    (New-ExportEntry "extension/docs/screenshots/studio.png" "docs/screenshots/studio.png")
    (New-ExportEntry "extension/docs/social-preview.jpg" "docs/social-preview.jpg")
    (New-ExportEntry "extension/docs/store/promo-440x280.png" "docs/store/promo-440x280.png")
    (New-ExportEntry "extension/package.json" "package.json")
    (New-ExportEntry "extension/scripts/browser-smoke.mjs" "scripts/browser-smoke.mjs")
    (New-ExportEntry "extension/scripts/build.mjs" "scripts/build.mjs")
    (New-ExportEntry "extension/scripts/generate-icons.ps1" "scripts/generate-icons.ps1")
    (New-ExportEntry "extension/scripts/package.ps1" "scripts/package.ps1")
    (New-ExportEntry "extension/scripts/test.mjs" "scripts/test.mjs")
    (New-ExportEntry "extension/scripts/verify-dist.mjs" "scripts/verify-dist.mjs")
    (New-ExportEntry "extension/src/_locales/ar/messages.json" "src/_locales/ar/messages.json")
    (New-ExportEntry "extension/src/_locales/de/messages.json" "src/_locales/de/messages.json")
    (New-ExportEntry "extension/src/_locales/en/messages.json" "src/_locales/en/messages.json")
    (New-ExportEntry "extension/src/NOTICE.txt" "src/NOTICE.txt")
    (New-ExportEntry "extension/src/background.js" "src/background.js")
    (New-ExportEntry "extension/src/i18n.js" "src/i18n.js")
    (New-ExportEntry "extension/src/icon-192.png" "src/icon-192.png")
    (New-ExportEntry "extension/src/lib/cloud.js" "src/lib/cloud.js")
    (New-ExportEntry "extension/src/lib/optimizer.js" "src/lib/optimizer.js")
    (New-ExportEntry "extension/src/manifest.json" "src/manifest.json")
    (New-ExportEntry "extension/src/studio.css" "src/studio.css")
    (New-ExportEntry "extension/src/studio.html" "src/studio.html")
    (New-ExportEntry "extension/src/studio.js" "src/studio.js")
  )
}

function Assert-SafeRelativePath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $normalized = $Path.Replace("\", "/").TrimStart("/")
  if ([System.IO.Path]::IsPathRooted($Path) -or $normalized -match "(^|/)\.\.(/|$)") {
    throw "Unsafe relative export path: $Path"
  }

  $forbiddenSegments = @(
    ".git", ".github", ".claude", ".planning", ".gmira", ".herenow",
    ".heremes", ".verify-build", "node_modules", "data", "dist", "evidence",
    "packages", "release"
  )
  $segments = @($normalized.Split("/", [System.StringSplitOptions]::RemoveEmptyEntries))
  foreach ($segment in $segments) {
    if ($forbiddenSegments -contains $segment.ToLowerInvariant()) {
      throw "Excluded path class '$segment' selected for export: $Path"
    }
  }

  $forbiddenExact = @(
    "stripe_setup.md",
    "editions/paid.json",
    "scripts/stripe-setup.mjs",
    "server/lib/billing.ts",
    "server/test/webhook.ts",
    "server/test/delivery-outbox.ts",
    "server/test/release-gates.ts",
    "server/test/helpers/verified-entitlement.ts"
  )
  if ($forbiddenExact -contains $normalized.ToLowerInvariant()) {
    throw "Excluded private or paid path selected for export: $Path"
  }
}

function Test-IsTextFile {
  param([Parameter(Mandatory = $true)][string]$Path)

  $name = [System.IO.Path]::GetFileName($Path).ToLowerInvariant()
  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($name -in @("dockerfile", "license", ".dockerignore", ".gitattributes", ".gitignore")) {
    return $true
  }
  return $extension -in @(
    ".c", ".css", ".html", ".js", ".json", ".lock", ".md", ".mjs",
    ".ps1", ".sh", ".toml", ".ts", ".txt", ".webmanifest"
  )
}

function Assert-NoExcludedTokens {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$RelativePath
  )

  if (-not (Test-IsTextFile -Path $Path)) {
    return
  }

  $content = [System.IO.File]::ReadAllText($Path)
  $tokenClasses = @(
    [pscustomobject]@{ Name = "Stripe secret"; Pattern = "(?i)\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b" }
    [pscustomobject]@{ Name = "Stripe webhook secret"; Pattern = "(?i)\bwhsec_[A-Za-z0-9]{8,}\b" }
    [pscustomobject]@{ Name = "GitHub token"; Pattern = "(?i)\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b" }
    [pscustomobject]@{ Name = "Fly API token"; Pattern = "(?i)\bFlyV1\s+[A-Za-z0-9._-]{20,}\b" }
    [pscustomobject]@{ Name = "private key"; Pattern = "-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----" }
    [pscustomobject]@{ Name = "local Windows user path"; Pattern = "(?i)[A-Z]:\\Users\\[^\\\s]+\\" }
  )
  foreach ($tokenClass in $tokenClasses) {
    if ([System.Text.RegularExpressions.Regex]::IsMatch($content, $tokenClass.Pattern)) {
      $className = $tokenClass.Name
      throw "Excluded token class '$className' found in: $RelativePath"
    }
  }
}

try {
  $destinationPath = Get-NormalizedFullPath -Path $Destination
  if (Test-PathContainedBy -Candidate $destinationPath -Container $repoRoot) {
    throw "Destination must be outside the source repository: $destinationPath"
  }
  if (Test-PathContainedBy -Candidate $repoRoot -Container $destinationPath) {
    throw "Destination must not contain the source repository: $destinationPath"
  }

  if ((Test-Path -LiteralPath $destinationPath) -and
      (-not (Test-Path -LiteralPath $destinationPath -PathType Container))) {
    throw "Destination exists and is not a directory: $destinationPath"
  }

  $existingItems = @()
  if (Test-Path -LiteralPath $destinationPath -PathType Container) {
    $existingItems = @(Get-ChildItem -LiteralPath $destinationPath -Force)
  }
  if (($existingItems.Count -gt 0) -and (-not $AllowNonEmptyDestination)) {
    throw "Destination is not empty. Re-run with -AllowNonEmptyDestination only after reviewing it: $destinationPath"
  }
  if (Test-Path -LiteralPath $destinationPath -PathType Container) {
    $unsafeDestinationItems = @(Get-ChildItem -LiteralPath $destinationPath -Force -Recurse |
      Where-Object {
        $_.Name -eq ".git" -or
        (($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)
      })
    if ($unsafeDestinationItems.Count -gt 0) {
      throw "Destination contains .git metadata or a reparse point and cannot be used: $destinationPath"
    }
  }

  $entries = if ($Target -eq "web") { @(Get-WebAllowlist) } else { @(Get-ExtensionAllowlist) }
  $outputNames = @{}
  $prepared = @()
  foreach ($entry in $entries) {
    Assert-SafeRelativePath -Path $entry.Source
    Assert-SafeRelativePath -Path $entry.Output

    $sourcePath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $entry.Source))
    if (-not (Test-PathContainedBy -Candidate $sourcePath -Container $repoRoot)) {
      throw "Allowlisted source escapes the repository: $($entry.Source)"
    }
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
      throw "Required allowlisted source is missing: $($entry.Source)"
    }
    $sourceItem = Get-Item -LiteralPath $sourcePath -Force
    if (($sourceItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
      throw "Refusing reparse-point source: $($entry.Source)"
    }

    $outputKey = $entry.Output.ToLowerInvariant()
    if ($outputNames.ContainsKey($outputKey)) {
      throw "Duplicate export output path: $($entry.Output)"
    }
    $outputNames[$outputKey] = $true

    $outputPath = [System.IO.Path]::GetFullPath((Join-Path $destinationPath $entry.Output))
    if (-not (Test-PathContainedBy -Candidate $outputPath -Container $destinationPath)) {
      throw "Export output escapes the destination: $($entry.Output)"
    }
    if (Test-Path -LiteralPath $outputPath) {
      throw "Refusing to overwrite existing destination path: $($entry.Output)"
    }

    Assert-NoExcludedTokens -Path $sourcePath -RelativePath $entry.Source
    $prepared += [pscustomobject]@{
      SourcePath = $sourcePath
      OutputPath = $outputPath
      RelativePath = $entry.Output
      Bytes = [int64]$sourceItem.Length
      Sha256 = Get-Sha256Text -Path $sourcePath
    }
  }

  foreach ($receiptName in @($inventoryName, $manifestName)) {
    $receiptPath = Join-Path $destinationPath $receiptName
    if (Test-Path -LiteralPath $receiptPath) {
      throw "Refusing to overwrite existing export receipt: $receiptName"
    }
  }

  New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
  foreach ($file in $prepared) {
    $parent = Split-Path -Parent $file.OutputPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    Copy-Item -LiteralPath $file.SourcePath -Destination $file.OutputPath
    $copiedHash = Get-Sha256Text -Path $file.OutputPath
    if ($copiedHash -ne $file.Sha256) {
      throw "Copied file hash mismatch: $($file.RelativePath)"
    }
  }

  $sortedFiles = @($prepared | Sort-Object -Property RelativePath)
  $inventoryFiles = @($sortedFiles | ForEach-Object {
    [ordered]@{
      path = $_.RelativePath.Replace("\", "/")
      bytes = $_.Bytes
      sha256 = $_.Sha256
    }
  })
  $totalBytes = [int64](($sortedFiles | Measure-Object -Property Bytes -Sum).Sum)
  $inventory = [ordered]@{
    schemaVersion = "bunbite-public-export/v1"
    target = $Target
    generatedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
    fileCount = $inventoryFiles.Count
    totalBytes = $totalBytes
    files = $inventoryFiles
  }
  $inventoryPath = Join-Path $destinationPath $inventoryName
  $inventoryJson = $inventory | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText($inventoryPath, $inventoryJson + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))

  $manifestLines = @($sortedFiles | ForEach-Object {
    $manifestPath = $_.RelativePath.Replace("\", "/")
    "$($_.Sha256)  $manifestPath"
  })
  $inventoryHash = Get-Sha256Text -Path $inventoryPath
  $manifestLines += "$inventoryHash  $inventoryName"
  $manifestPath = Join-Path $destinationPath $manifestName
  [System.IO.File]::WriteAllLines($manifestPath, $manifestLines, [System.Text.Encoding]::ASCII)

  $copiedGitMetadata = @(Get-ChildItem -LiteralPath $destinationPath -Force -Recurse |
    Where-Object { $_.Name -eq ".git" })
  if ($copiedGitMetadata.Count -gt 0) {
    throw "Export verification found forbidden .git metadata"
  }

  Write-Output "[OK] Public export target: $Target"
  Write-Output "[OK] Files copied: $($inventoryFiles.Count)"
  Write-Output "[OK] Destination: $destinationPath"
  Write-Output "[OK] Inventory: $inventoryName"
  Write-Output "[OK] SHA256 manifest: $manifestName"
}
catch {
  Write-Error "Public export failed: $($_.Exception.Message)"
  exit 1
}
