# Run this script to deploy (updates "Last updated" in gallery-data.js, then uploads via publish-ftp.ps1 using cyberfolks.env).
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

if (-not (Test-Path $galleryDataPath)) {
    throw "Missing gallery-data.js at '$galleryDataPath'."
}

$isoDateUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd")
$raw = [System.IO.File]::ReadAllText($galleryDataPath)
$pattern = 'window\.PORTFOLIO_LAST_UPDATED\s*=\s*"[^"]*"'
if ($raw -notmatch $pattern) {
    throw "gallery-data.js must contain: window.PORTFOLIO_LAST_UPDATED = `"YYYY-MM-DD`";"
}

$replacement = "window.PORTFOLIO_LAST_UPDATED = `"$isoDateUtc`""
$newContent = [regex]::Replace($raw, $pattern, $replacement)
if ($newContent -ne $raw) {
    if ($WhatIf) {
        Write-Host "[WhatIf] Would set PORTFOLIO_LAST_UPDATED to $isoDateUtc in gallery-data.js"
    }
    else {
        $utf8NoBom = New-Object System.Text.UTF8Encoding $false
        [System.IO.File]::WriteAllText($galleryDataPath, $newContent, $utf8NoBom)
        Write-Host "Set PORTFOLIO_LAST_UPDATED to $isoDateUtc in gallery-data.js"
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
