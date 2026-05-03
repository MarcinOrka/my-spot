# FTP upload (reads cyberfolks.env by default). Invoked by deploy.ps1; can be run alone.
# By default only files whose SHA256 changed since the last run are uploaded (see .deploy-state.json). Use -Full for a complete upload.
param(
    [switch]$WhatIf,
    [switch]$Full,
    [string]$EnvFile = "cyberfolks.env",
    [string]$StateFile = ".deploy-state.json"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = if ([System.IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $projectRoot $EnvFile }
$statePath = if ([System.IO.Path]::IsPathRooted($StateFile)) { $StateFile } else { Join-Path $projectRoot $StateFile }
$stateRelativePath = if ($statePath.StartsWith($projectRoot)) { $statePath.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/") } else { "" }

if (-not (Test-Path $envPath)) {
    throw "Missing env file at '$envPath'. Add cyberfolks.env in the project root or pass -EnvFile."
}

function Import-DotEnv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $values = @{}
    $lines = Get-Content -Path $Path

    foreach ($rawLine in $lines) {
        $line = $rawLine.Trim()
        if (-not $line -or $line.StartsWith("#")) {
            continue
        }

        $parts = $line -split "=", 2
        if ($parts.Count -ne 2) {
            continue
        }

        $key = $parts[0].Trim()
        $value = $parts[1].Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $values[$key] = $value
    }

    return $values
}

function Require-EnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Values,
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if (-not $Values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace($Values[$Name])) {
        throw "Required variable '$Name' is missing in the deployment env file."
    }

    return $Values[$Name]
}

function Encode-FtpPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $segments = $Path -split "/"
    $encodedSegments = @()

    foreach ($segment in $segments) {
        if ($segment -eq "") {
            continue
        }
        $encodedSegments += [System.Uri]::EscapeDataString($segment)
    }

    return ($encodedSegments -join "/")
}

function Get-FileSha256 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $hash = Get-FileHash -Path $Path -Algorithm SHA256
    return $hash.Hash.ToLower()
}

function Load-DeployState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return @{}
    }

    $raw = Get-Content -Path $Path -Raw
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return @{}
    }

    $parsed = $raw | ConvertFrom-Json
    if ($null -eq $parsed -or $null -eq $parsed.files) {
        return @{}
    }

    $result = @{}
    $fileEntries = $parsed.files.PSObject.Properties
    foreach ($entry in $fileEntries) {
        $result[$entry.Name] = [string]$entry.Value
    }

    return $result
}

function Save-DeployState {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [hashtable]$Files
    )

    $state = @{
        version = 1
        generatedAt = (Get-Date).ToString("o")
        files = $Files
    }

    $json = $state | ConvertTo-Json -Depth 4
    Set-Content -Path $Path -Value $json -Encoding UTF8
}

function New-FtpRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [System.Net.NetworkCredential]$Credential,
        [Parameter(Mandatory = $true)]
        [bool]$UseSsl
    )

    $request = [System.Net.FtpWebRequest]::Create($Uri)
    $request.Method = $Method
    $request.Credentials = $Credential
    $request.UseBinary = $true
    $request.UsePassive = $true
    $request.KeepAlive = $false
    $request.EnableSsl = $UseSsl
    return $request
}

function Ensure-RemoteDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ServerHost,
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [Parameter(Mandatory = $true)]
        [string]$Protocol,
        [Parameter(Mandatory = $true)]
        [string]$RemoteDirectory,
        [Parameter(Mandatory = $true)]
        [System.Net.NetworkCredential]$Credential,
        [Parameter(Mandatory = $true)]
        [bool]$UseSsl,
        [System.Collections.Generic.HashSet[string]]$CreatedDirs
    )

    $segments = $RemoteDirectory -split "/" | Where-Object { $_ -ne "" }
    if ($segments.Count -eq 0) {
        return
    }

    $current = ""
    foreach ($segment in $segments) {
        if ($current) {
            $current = "$current/$segment"
        }
        else {
            $current = $segment
        }

        if ($CreatedDirs.Contains($current)) {
            continue
        }

        $encodedPath = Encode-FtpPath $current
        $dirUri = "${Protocol}://${ServerHost}:${Port}/${encodedPath}"
        $request = New-FtpRequest -Uri $dirUri -Method ([System.Net.WebRequestMethods+Ftp]::MakeDirectory) -Credential $Credential -UseSsl $UseSsl

        try {
            $response = $request.GetResponse()
            $response.Close()
            Write-Host "Created remote directory: /$current"
        }
        catch [System.Net.WebException] {
            # Directory may already exist.
        }

        $CreatedDirs.Add($current) | Out-Null
    }
}

$config = Import-DotEnv -Path $envPath

$hostName = Require-EnvValue -Values $config -Name "FTP_HOST"
$userName = Require-EnvValue -Values $config -Name "FTP_USER"
$password = Require-EnvValue -Values $config -Name "FTP_PASS"

$protocol = if ($config.ContainsKey("FTP_PROTOCOL") -and $config["FTP_PROTOCOL"]) { $config["FTP_PROTOCOL"].ToLower() } else { "ftp" }
$remoteRoot = if ($config.ContainsKey("FTP_REMOTE_DIR")) { $config["FTP_REMOTE_DIR"] } else { "" }
$port = if ($config.ContainsKey("FTP_PORT") -and $config["FTP_PORT"]) { [int]$config["FTP_PORT"] } else { 21 }
$useSsl = $false
if ($config.ContainsKey("FTP_SSL")) {
    $sslValue = $config["FTP_SSL"].ToLower()
    $useSsl = $sslValue -in @("1", "true", "yes")
}

$remoteRoot = ($remoteRoot -replace "\\", "/").Trim("/")

$credential = New-Object System.Net.NetworkCredential($userName, $password)
$createdDirs = New-Object "System.Collections.Generic.HashSet[string]"

$excludeNames = @(
    ".env",
    ".env.example",
    "cyberfolks.env",
    ".gitignore",
    ".portfolio-photo-counts",
    "deploy-ftp.ps1",
    "publish-ftp.ps1",
    "photo-count-signature.mjs",
    [System.IO.Path]::GetFileName($statePath)
)

$files = @(Get-ChildItem -Path $projectRoot -Recurse -File | Where-Object {
    $fullName = $_.FullName
    $relative = $fullName.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/")
    $name = $_.Name

    if ($relative.StartsWith(".git/") -or $relative.StartsWith(".git\")) {
        return $false
    }

    if ($relative.StartsWith("monnomnom/")) {
        return $false
    }

    if ($excludeNames -contains $name) {
        return $false
    }

    if ($name -like "*.env") {
        return $false
    }

    return $true
})

if ($files.Count -eq 0) {
    throw "No files found to deploy."
}

if (-not [string]::IsNullOrWhiteSpace($stateRelativePath)) {
    $files = @($files | Where-Object {
        $relative = $_.FullName.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/")
        $relative -ne $stateRelativePath
    })
}

if ($files.Count -eq 0) {
    throw "No files found to deploy after exclusions."
}

Write-Host "Mode: $(if (-not $Full) { "changed-files-only" } else { "full" })"
Write-Host "Deploy target: ${protocol}://${hostName}:${port}/$remoteRoot"

$currentHashes = @{}
foreach ($file in $files) {
    $relativePath = $file.FullName.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/")
    $currentHashes[$relativePath] = Get-FileSha256 -Path $file.FullName
}

$filesToUpload = @($files)
if (-not $Full) {
    $previousHashes = Load-DeployState -Path $statePath
    if ($previousHashes.Count -gt 0) {
        $filesToUpload = @($files | Where-Object {
            $relativePath = $_.FullName.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/")
            (-not $previousHashes.ContainsKey($relativePath)) -or ($previousHashes[$relativePath] -ne $currentHashes[$relativePath])
        })
    }
    else {
        Write-Host "No previous state found at '$statePath'. Uploading all files this run."
    }
}

Write-Host "Files scanned: $($files.Count)"
Write-Host "Files to upload: $($filesToUpload.Count)"

if ($filesToUpload.Count -eq 0) {
    Write-Host "No changed files to upload."
    if (-not $WhatIf) {
        Save-DeployState -Path $statePath -Files $currentHashes
        Write-Host "Deployment state updated at '$statePath'."
    }
    if ($WhatIf) {
        Write-Host "Dry run complete."
    }
    else {
        Write-Host "Deployment complete. Uploaded 0 files."
    }
    exit 0
}

$uploaded = 0
foreach ($file in $filesToUpload) {
    $relativePath = $file.FullName.Substring($projectRoot.Length).TrimStart("\").Replace("\", "/")
    $targetPath = if ([string]::IsNullOrWhiteSpace($remoteRoot)) { $relativePath } else { "$remoteRoot/$relativePath" }
    $targetPath = $targetPath -replace "//+", "/"

    if ($WhatIf) {
        Write-Host "[WhatIf] Would upload: $relativePath -> /$targetPath"
        continue
    }

    $targetDirectoryRaw = [System.IO.Path]::GetDirectoryName($targetPath)
    $targetDirectory = if ($null -eq $targetDirectoryRaw) { "" } else { $targetDirectoryRaw.Replace("\", "/") }
    if (-not [string]::IsNullOrWhiteSpace($targetDirectory)) {
        Ensure-RemoteDirectory -ServerHost $hostName -Port $port -Protocol $protocol -RemoteDirectory $targetDirectory -Credential $credential -UseSsl $useSsl -CreatedDirs $createdDirs
    }

    $encodedTarget = Encode-FtpPath $targetPath
    $uri = "${protocol}://${hostName}:${port}/${encodedTarget}"
    $request = New-FtpRequest -Uri $uri -Method ([System.Net.WebRequestMethods+Ftp]::UploadFile) -Credential $credential -UseSsl $useSsl

    $content = [System.IO.File]::ReadAllBytes($file.FullName)
    $request.ContentLength = $content.Length

    $requestStream = $request.GetRequestStream()
    $requestStream.Write($content, 0, $content.Length)
    $requestStream.Close()

    $response = $request.GetResponse()
    $response.Close()

    $uploaded++
    Write-Host "Uploaded ($uploaded/$($filesToUpload.Count)): $relativePath"
}

if ($WhatIf) {
    Write-Host "Dry run complete."
}
else {
    Save-DeployState -Path $statePath -Files $currentHashes
    Write-Host "Deployment state updated at '$statePath'."
    Write-Host "Deployment complete. Uploaded $uploaded files."
}
