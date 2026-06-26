@echo off
cd /d "%~dp0"

:: Remove stale git lock files left by crashed processes
if exist ".git\index.lock" del /f ".git\index.lock"
if exist ".git\COMMIT_EDITMSG.lock" del /f ".git\COMMIT_EDITMSG.lock"

:: Suppress pack file unlink warnings (Windows can't delete open pack files)
git config gc.auto 0

echo Pushing to GitHub...

:: Force index refresh before staging (fixes "nothing to commit" on first run)
git status > nul 2>&1
git add -A

:: Always create a commit so Cloudflare always rebuilds
git commit --allow-empty -m "update"
git push

echo.
echo Done! Cloudflare will build and deploy in ~1-2 minutes.
pause
