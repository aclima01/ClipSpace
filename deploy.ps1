Set-Location $PSScriptRoot

Write-Host "Building client..." -ForegroundColor Cyan
Set-Location client
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Client build failed." -ForegroundColor Red; exit 1 }
Set-Location ..

Write-Host "Building server..." -ForegroundColor Cyan
Set-Location server
npm run build
if ($LASTEXITCODE -ne 0) { Write-Host "Server build failed." -ForegroundColor Red; exit 1 }
Set-Location ..

Write-Host "Restarting PM2..." -ForegroundColor Cyan
pm2 restart clipspace
if ($LASTEXITCODE -ne 0) { Write-Host "PM2 restart failed." -ForegroundColor Red; exit 1 }

Write-Host "Deployment complete!" -ForegroundColor Green