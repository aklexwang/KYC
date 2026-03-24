@echo off
chcp 65001 >nul
cd /d "%~dp0.."

echo == Repo: %CD%
git status --short
git add -A
git commit -m "feat: 본사등급/1원알림/가맹점스코프·충전중복·store-settlement 등 일괄 반영"
git push origin main

echo.
echo Done. Netlify Git 연동이면 Deploys에서 새 빌드를 확인하세요.
pause
