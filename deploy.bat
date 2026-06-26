@echo off
cd /d "%~dp0"

:: Remove stale git lock files left by crashed processes
if exist ".git\index.lock" del /f ".git\index.lock"

:: Suppress pack file unlink warnings (Windows can't delete open pack files)
git config gc.auto 0

echo Pushing to GitHub...
git add .
git commit -m "update"
git push
echo.
echo Done! Cloudflare will build and deploy in ~1-2 minutes.
pause
