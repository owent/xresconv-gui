# Native nonzero exit codes do not reliably throw in PowerShell. Check both
# command lookup/launch failures and LASTEXITCODE, including the repair itself.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$zstdReady = $false
try {
    zstd --version
    $zstdReady = $LASTEXITCODE -eq 0
} catch {
    $zstdReady = $false
}
if (-not $zstdReady) {
    choco install zstandard -y --no-progress
    if ($LASTEXITCODE -ne 0) {
        throw "zstandard installation failed (exit $LASTEXITCODE)"
    }
    zstd --version
    if ($LASTEXITCODE -ne 0) {
        throw "zstd is unusable after installation (exit $LASTEXITCODE)"
    }
}
