# Run this script to deploy (updates "Last updated" in gallery-data.js only when any album's photo count changes, then uploads via publish-ftp.ps1 using cyberfolks.env).
# FTP step uploads only changed files by default (SHA256 vs .deploy-state.json). Use -Full to upload the entire site.
param(
    [switch]$WhatIf,
    [switch]$Full,
    [string]$EnvFile = "cyberfolks.env",
    [string]$StateFile = ".deploy-state.json"
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$galleryDataPath = Join-Path $projectRoot "gallery-data.js"
$photoSigScript = Join-Path $projectRoot "photo-count-signature.mjs"
$photoSigStore = Join-Path $projectRoot ".portfolio-photo-counts"

if (-not (Test-Path $galleryDataPath)) {
    throw "Missing gallery-data.js at '$galleryDataPath'."
}

if (-not (Test-Path $photoSigScript)) {
    throw "Missing photo-count-signature.mjs at '$photoSigScript'."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js (node on PATH) is required to compare gallery photo counts. Install from https://nodejs.org/ or add Node to PATH."
}

$currentSig = (& node $photoSigScript $galleryDataPath).Trim()
if ([string]::IsNullOrWhiteSpace($currentSig)) {
    throw "photo-count-signature.mjs returned an empty signature."
}

$previousSig = $null
if (Test-Path $photoSigStore) {
    $previousSig = ([System.IO.File]::ReadAllText($photoSigStore)).Trim()
}

if ($currentSig -eq $previousSig) {
    Write-Host "Photo counts per catalog unchanged; PORTFOLIO_LAST_UPDATED left as-is."
}
else {
    $isoDateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
    $raw = [System.IO.File]::ReadAllText($galleryDataPath)
    $pattern = 'window\.PORTFOLIO_LAST_UPDATED\s*=\s*"[^"]*"'
    if ($raw -notmatch $pattern) {
        throw "gallery-data.js must contain: window.PORTFOLIO_LAST_UPDATED = `"YYYY-MM-DD`";"
    }

    $replacement = "window.PORTFOLIO_LAST_UPDATED = `"$isoDateUtc`""
    $newContent = [regex]::Replace($raw, $pattern, $replacement)
    if ($WhatIf) {
        Write-Host "[WhatIf] Would set PORTFOLIO_LAST_UPDATED to $isoDateUtc (photo counts changed)."
        Write-Host "[WhatIf] Would write signature store: $photoSigStore"
    }
    else {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        if ($newContent -ne $raw) {
            [System.IO.File]::WriteAllText($galleryDataPath, $newContent, $utf8NoBom)
            Write-Host "Photo counts changed; set PORTFOLIO_LAST_UPDATED to $isoDateUtc in gallery-data.js"
        }
        else {
            Write-Host "Photo counts changed; PORTFOLIO_LAST_UPDATED already $isoDateUtc; updated signature store only."
        }
        [System.IO.File]::WriteAllText($photoSigStore, $currentSig, $utf8NoBom)
    }
}

$ftpScript = Join-Path $projectRoot "publish-ftp.ps1"
$ftpParams = @{
    EnvFile   = $EnvFile
    StateFile = $StateFile
}
if ($WhatIf) {
    $ftpParams.WhatIf = $true
}
if ($Full) {
    $ftpParams.Full = $true
}
& $ftpScript @ftpParams
