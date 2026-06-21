# Run this script to deploy (updates "Last updated" in gallery-data.js only when any album's photo count changes, then uploads via publish-ftp.ps1 using cyberfolks.env).
# Does not regenerate tribute-data.js or support-data.js — run those generators manually when markdown changes.
# FTP step uploads only changed files by default (SHA256 vs .deploy-state.json). Use -Full to upload the entire site.
param(
    [switch]$WhatIf,
    [switch]$Full,
    [string[]]$ForcePaths = @(),
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

function Get-AlbumCountsFromSig {
    param([string]$Sig)
    $map = @{}
    if ([string]::IsNullOrWhiteSpace($Sig)) { return $map }
    foreach ($part in $Sig.Split('|', [StringSplitOptions]::RemoveEmptyEntries)) {
        $colon = $part.IndexOf(':')
        if ($colon -gt 0) {
            $id = $part.Substring(0, $colon)
            $count = 0
            [void][int]::TryParse($part.Substring($colon + 1), [ref]$count)
            $map[$id] = $count
        }
    }
    return $map
}

function Get-ChangedAlbumIds {
    param(
        [hashtable]$Previous,
        [hashtable]$Current
    )
    $changed = [System.Collections.Generic.List[string]]::new()
    foreach ($id in ($Current.Keys | Sort-Object)) {
        $prevCount = $null
        if ($Previous.ContainsKey($id)) { $prevCount = $Previous[$id] }
        if ($null -eq $prevCount -or $prevCount -ne $Current[$id]) {
            $changed.Add($id)
        }
    }
    return $changed
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

    $albumsPattern = 'window\.PORTFOLIO_LAST_UPDATED_ALBUMS\s*=\s*\[[^\]]*\]'
    if ($raw -notmatch $albumsPattern) {
        throw "gallery-data.js must contain: window.PORTFOLIO_LAST_UPDATED_ALBUMS = [...];"
    }

    $changedAlbumIds = @()
    if (-not [string]::IsNullOrWhiteSpace($previousSig)) {
        $prevCounts = Get-AlbumCountsFromSig -Sig $previousSig
        $currCounts = Get-AlbumCountsFromSig -Sig $currentSig
        $changedAlbumIds = @(Get-ChangedAlbumIds -Previous $prevCounts -Current $currCounts)
    }

    $albumsJson = ($changedAlbumIds | ForEach-Object { "`"$_`"" }) -join ", "
    $replacement = "window.PORTFOLIO_LAST_UPDATED = `"$isoDateUtc`""
    $albumsReplacement = "window.PORTFOLIO_LAST_UPDATED_ALBUMS = [$albumsJson]"
    $newContent = [regex]::Replace($raw, $pattern, $replacement)
    $newContent = [regex]::Replace($newContent, $albumsPattern, $albumsReplacement)
    if ($WhatIf) {
        $albumsLabel = if ($changedAlbumIds.Count) { $changedAlbumIds -join ", " } else { "(none)" }
        Write-Host "[WhatIf] Would set PORTFOLIO_LAST_UPDATED to $isoDateUtc and albums to $albumsLabel (photo counts changed)."
        Write-Host "[WhatIf] Would write signature store: $photoSigStore"
    }
    else {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        if ($newContent -ne $raw) {
            [System.IO.File]::WriteAllText($galleryDataPath, $newContent, $utf8NoBom)
            $albumsLabel = if ($changedAlbumIds.Count) { $changedAlbumIds -join ", " } else { "(none)" }
            Write-Host "Photo counts changed; set PORTFOLIO_LAST_UPDATED to $isoDateUtc and albums to $albumsLabel in gallery-data.js"
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
if ($ForcePaths.Count -gt 0) {
    $ftpParams.ForcePaths = $ForcePaths
}
& $ftpScript @ftpParams
