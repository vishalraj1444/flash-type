# PowerShell script to convert PNG to ICO for Windows
Add-Type -AssemblyName System.Drawing

$sourceImage = "$PSScriptRoot\..\build\icon.png"
$outputIco = "$PSScriptRoot\..\build\icon.ico"

if (-Not (Test-Path $sourceImage)) {
    Write-Host "Error: icon.png not found at $sourceImage" -ForegroundColor Red
    exit 1
}

if (Test-Path $outputIco) {
    Write-Host "icon.ico already exists at $outputIco" -ForegroundColor Yellow
    exit 0
}

try {
    # Load the source PNG
    $img = [System.Drawing.Image]::FromFile($sourceImage)
    
    # Create 256x256 bitmap (most common size for Windows icons)
    $bitmap256 = New-Object System.Drawing.Bitmap($img, 256, 256)
    
    # Get the icon handle and convert to icon
    $iconHandle = $bitmap256.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    
    # Save to file
    $fileStream = New-Object System.IO.FileStream($outputIco, [System.IO.FileMode]::Create)
    $icon.Save($fileStream)
    $fileStream.Close()
    
    # Cleanup
    $icon.Dispose()
    $bitmap256.Dispose()
    $img.Dispose()
    
    Write-Host "Successfully created icon.ico at $outputIco" -ForegroundColor Green
    
} catch {
    Write-Host "Error creating ICO: $_" -ForegroundColor Red
    
    # Fallback: electron-builder can work with just PNG if it's properly sized
    Write-Host "Continuing anyway - electron-builder may auto-convert the PNG" -ForegroundColor Yellow
    exit 0
}

