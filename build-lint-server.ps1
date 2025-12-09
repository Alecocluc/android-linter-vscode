# Build script for Android Lint Server
# Run this script to build the lint server JAR for the VS Code extension

Write-Host "Building Android Lint Server..." -ForegroundColor Cyan

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$lintServerDir = Join-Path $scriptDir "lint-server"

if (-not (Test-Path $lintServerDir)) {
    Write-Host "Error: lint-server directory not found at $lintServerDir" -ForegroundColor Red
    exit 1
}

Push-Location $lintServerDir

try {
    # Check for Gradle wrapper
    $gradlew = if ($IsWindows -or $env:OS -eq "Windows_NT") { ".\gradlew.bat" } else { "./gradlew" }
    
    if (-not (Test-Path "gradlew") -and -not (Test-Path "gradlew.bat")) {
        Write-Host "Gradle wrapper not found. Generating..." -ForegroundColor Yellow
        gradle wrapper
    }
    
    Write-Host "Running shadowJar task..." -ForegroundColor Yellow
    
    if ($IsWindows -or $env:OS -eq "Windows_NT") {
        & .\gradlew.bat shadowJar --no-daemon
    } else {
        & ./gradlew shadowJar --no-daemon
    }
    
    if ($LASTEXITCODE -eq 0) {
        $jarPath = Join-Path $lintServerDir "build\libs\lint-server.jar"
        if (Test-Path $jarPath) {
            Write-Host "`nBuild successful!" -ForegroundColor Green
            Write-Host "JAR location: $jarPath" -ForegroundColor Cyan
            
            # Get JAR size
            $jarSize = (Get-Item $jarPath).Length / 1MB
            Write-Host "JAR size: $([math]::Round($jarSize, 2)) MB" -ForegroundColor Gray
        } else {
            Write-Host "Warning: JAR file not found at expected location" -ForegroundColor Yellow
        }
    } else {
        Write-Host "`nBuild failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit $LASTEXITCODE
    }
} finally {
    Pop-Location
}
