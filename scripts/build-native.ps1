param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$NativeDir = Join-Path $Root "native"
$DistDir = Join-Path $Root "dist\Dih"
$Target = "x86_64-pc-windows-gnullvm"

if (-not $SkipBuild) {
    $Sysroot = (& rustc --print sysroot).Trim()
    $RustLld = Join-Path $Sysroot "lib\rustlib\x86_64-pc-windows-gnu\bin\rust-lld.exe"
    if (-not (Test-Path $RustLld)) {
        throw "Expected rust-lld.exe at $RustLld"
    }

    $env:RUSTFLAGS = "-C linker=$RustLld -C linker-flavor=ld.lld"
    Push-Location $NativeDir
    try {
        & cargo build --release --target $Target
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build failed with exit code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

$ExeSrc = Join-Path $NativeDir "target\$Target\release\Dih.exe"
if (-not (Test-Path $ExeSrc)) {
    throw "Missing compiled executable at $ExeSrc"
}

$LoaderSrc = Get-ChildItem (Join-Path $NativeDir "target\$Target\release\build") -Recurse -Filter "WebView2Loader.dll" |
    Where-Object { $_.FullName -match "\\x64\\" } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
if (-not $LoaderSrc) {
    throw "Missing WebView2Loader.dll (x64) in build output"
}

if (Test-Path $DistDir) {
    Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

Copy-Item $ExeSrc (Join-Path $DistDir "Dih.exe") -Force
Copy-Item $LoaderSrc (Join-Path $DistDir "WebView2Loader.dll") -Force

$AssetsOut = Join-Path $DistDir "assets"
New-Item -ItemType Directory -Path $AssetsOut -Force | Out-Null
Copy-Item (Join-Path $Root "assets\dih-icon.ico") (Join-Path $AssetsOut "dih-icon.ico") -Force
Copy-Item (Join-Path $Root "assets\dih-icon.png") (Join-Path $AssetsOut "dih-icon.png") -Force

Copy-Item (Join-Path $Root "swap") (Join-Path $DistDir "swap") -Recurse -Force
Copy-Item (Join-Path $Root "src\studio") (Join-Path $DistDir "studio") -Recurse -Force

Write-Host "Packaged native Dih Client -> $DistDir"
