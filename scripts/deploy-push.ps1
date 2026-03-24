# Netlify(Git 연동) 재배포: 커밋 후 origin main 푸시
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "== Repo: $Root"
git status --short
git add -A
$st = git status --short
if (-not $st) {
    Write-Host "No changes to commit. Pushing anyway..."
    git push origin main
    exit $LASTEXITCODE
}
git commit -m "feat: 본사등급/1원알림/가맹점스코프·충전중복·store-settlement 등 일괄 반영"
git push origin main
Write-Host "Done. Check Netlify Deploys for a new Published build."
