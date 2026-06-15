# Generates album thumbnails in {Album}/thumbs/ from gallery-data.js (same filenames as originals).
param(
    [switch]$Force,
    [int]$MaxEdge = 1200,
    [int]$JpegQuality = 100,
    [string]$GalleryData = "gallery-data.js"
)

$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$galleryPath = if ([System.IO.Path]::IsPathRooted($GalleryData)) { $GalleryData } else { Join-Path $projectRoot $GalleryData }

if (-not (Test-Path $galleryPath)) {
    throw "Missing gallery data at '$galleryPath'."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    throw "Node.js is required to read gallery-data.js."
}

Add-Type -AssemblyName System.Drawing

function Get-GalleryGroups {
    param([string]$Path)
    $json = & node -e @"
const fs = require('fs');
const window = {};
eval(fs.readFileSync(process.argv[1], 'utf8'));
if (!Array.isArray(window.PORTFOLIO_GROUPS)) {
  process.exit(2);
}
process.stdout.write(JSON.stringify(window.PORTFOLIO_GROUPS));
"@ $Path
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to parse gallery-data.js."
    }
    return @($json | ConvertFrom-Json)
}

function Save-Jpeg {
    param(
        [System.Drawing.Image]$Image,
        [string]$Path,
        [int]$Quality
    )

    $encoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" } |
        Select-Object -First 1
    if (-not $encoder) {
        throw "JPEG encoder not found."
    }

    $encParams = New-Object System.Drawing.Imaging.EncoderParameters 1
    $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter (
        [System.Drawing.Imaging.Encoder]::Quality,
        [long]$Quality
    )
    try {
        $Image.Save($Path, $encoder, $encParams)
    }
    finally {
        $encParams.Dispose()
    }
}

function New-PhotoThumbnail {
    param(
        [string]$SourcePath,
        [string]$DestPath,
        [int]$MaxEdge,
        [int]$JpegQuality
    )

    $src = [System.Drawing.Image]::FromFile($SourcePath)
    try {
        $width = $src.Width
        $height = $src.Height
        $longEdge = [Math]::Max($width, $height)
        $scale = if ($longEdge -gt $MaxEdge) { $MaxEdge / $longEdge } else { 1.0 }

        $newWidth = [Math]::Max(1, [int][Math]::Round($width * $scale))
        $newHeight = [Math]::Max(1, [int][Math]::Round($height * $scale))

        $bmp = New-Object System.Drawing.Bitmap $newWidth, $newHeight
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bmp)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($src, 0, 0, $newWidth, $newHeight)
            }
            finally {
                $graphics.Dispose()
            }

            $destDir = Split-Path -Parent $DestPath
            if (-not (Test-Path $destDir)) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }

            Save-Jpeg -Image $bmp -Path $DestPath -Quality $JpegQuality
        }
        finally {
            $bmp.Dispose()
        }
    }
    finally {
        $src.Dispose()
    }
}

$groups = Get-GalleryGroups -Path $galleryPath
$created = 0
$skipped = 0
$failed = 0

Write-Host "Thumbnail settings: max edge ${MaxEdge}px, JPEG quality $JpegQuality"

foreach ($group in $groups) {
    $folder = $group.folder
    if ([string]::IsNullOrWhiteSpace($folder)) { continue }

    foreach ($filename in @($group.photos)) {
        if ([string]::IsNullOrWhiteSpace($filename)) { continue }

        $sourcePath = Join-Path $projectRoot (Join-Path $folder $filename)
        $thumbPath = Join-Path $projectRoot (Join-Path $folder (Join-Path "thumbs" $filename))

        if (-not (Test-Path $sourcePath)) {
            Write-Warning "Missing source: $folder/$filename"
            $failed++
            continue
        }

        $needsUpdate = $Force
        if (-not $needsUpdate) {
            if (-not (Test-Path $thumbPath)) {
                $needsUpdate = $true
            }
            else {
                $needsUpdate = (Get-Item $sourcePath).LastWriteTimeUtc -gt (Get-Item $thumbPath).LastWriteTimeUtc
            }
        }

        if (-not $needsUpdate) {
            $skipped++
            continue
        }

        try {
            New-PhotoThumbnail -SourcePath $sourcePath -DestPath $thumbPath -MaxEdge $MaxEdge -JpegQuality $JpegQuality
            $created++
            Write-Host "Created: $folder/thumbs/$filename"
        }
        catch {
            Write-Warning "Failed $folder/$filename : $($_.Exception.Message)"
            $failed++
        }
    }
}

Write-Host "Done. Created: $created, skipped: $skipped, failed: $failed."

if ($failed -gt 0) {
    exit 1
}
