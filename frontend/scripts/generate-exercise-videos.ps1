param(
    [string]$FfmpegPath = ""
)

$ErrorActionPreference = "Stop"

$frontendRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$projectRoot = (Resolve-Path (Join-Path $frontendRoot "..")).Path
$outputDirectory = Join-Path $frontendRoot "public\exercise-videos"
$sourceDirectory = Join-Path ([System.IO.Path]::GetTempPath()) "ritmo-exercise-video-sources"

if (-not $FfmpegPath) {
    $pythonPath = Join-Path $projectRoot "backend\.venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        throw "Informe -FfmpegPath ou prepare o ambiente virtual do backend."
    }
    $FfmpegPath = & $pythonPath -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"
}

if (-not (Test-Path -LiteralPath $FfmpegPath)) {
    throw "FFmpeg não encontrado em $FfmpegPath"
}

New-Item -ItemType Directory -Force -Path $outputDirectory, $sourceDirectory | Out-Null

$clips = @(
    @{ Slug = "supino-chao"; Source = "Dumbbell_Floor_Press" },
    @{ Slug = "crucifixo-chao"; Source = "Dumbbell_Flyes" },
    @{ Slug = "triceps-frances"; Source = "Seated_Triceps_Press" },
    @{ Slug = "agachamento-goblet"; Source = "Goblet_Squat" },
    @{ Slug = "terra-romeno"; Source = "Stiff-Legged_Dumbbell_Deadlift" },
    @{ Slug = "panturrilha-pe"; Source = "Standing_Dumbbell_Calf_Raise" },
    @{ Slug = "remada-unilateral"; Source = "One-Arm_Dumbbell_Row" },
    @{ Slug = "pullover-chao"; Source = "Bent-Arm_Dumbbell_Pullover" },
    @{ Slug = "rosca-alternada"; Source = "Dumbbell_Alternate_Bicep_Curl" },
    @{ Slug = "desenvolvimento-halteres"; Source = "Dumbbell_Shoulder_Press" },
    @{ Slug = "elevacao-lateral"; Source = "Side_Lateral_Raise" },
    @{ Slug = "afundo-alternado"; Source = "Dumbbell_Lunges" },
    @{ Slug = "caminhada-fazendeiro"; Source = "Farmers_Walk" }
)

$baseUrl = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises"
foreach ($clip in $clips) {
    $clipSourceDirectory = Join-Path $sourceDirectory $clip.Source
    New-Item -ItemType Directory -Force -Path $clipSourceDirectory | Out-Null
    $startImage = Join-Path $clipSourceDirectory "0.jpg"
    $endImage = Join-Path $clipSourceDirectory "1.jpg"

    if (-not (Test-Path -LiteralPath $startImage)) {
        Invoke-WebRequest -Uri "$baseUrl/$($clip.Source)/0.jpg" -OutFile $startImage
    }
    if (-not (Test-Path -LiteralPath $endImage)) {
        Invoke-WebRequest -Uri "$baseUrl/$($clip.Source)/1.jpg" -OutFile $endImage
    }

    $outputPath = Join-Path $outputDirectory "$($clip.Slug).mp4"
    $concatPath = Join-Path $clipSourceDirectory "frames.txt"
    @(
        "file '$($startImage.Replace("'", "''"))'"
        "duration 0.9"
        "file '$($endImage.Replace("'", "''"))'"
        "duration 0.9"
        "file '$($startImage.Replace("'", "''"))'"
        "duration 0.9"
        "file '$($startImage.Replace("'", "''"))'"
    ) | Set-Content -Encoding ascii -LiteralPath $concatPath

    & $FfmpegPath `
        -hide_banner -loglevel error -y `
        -f concat -safe 0 -i $concatPath `
        -vf "fps=20,scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x120f0e" `
        -c:v libx264 -profile:v baseline -level 3.0 -preset slow -crf 27 `
        -pix_fmt yuv420p -movflags +faststart -an $outputPath

    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao gerar $outputPath"
    }
}

Get-ChildItem -LiteralPath $outputDirectory -Filter "*.mp4" |
    Select-Object Name, Length
