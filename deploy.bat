@echo off
cd /d "%~dp0"

:: Remove stale git lock files
if exist ".git\index.lock" del /f ".git\index.lock"
if exist ".git\COMMIT_EDITMSG.lock" del /f ".git\COMMIT_EDITMSG.lock"

:: Suppress ALL git garbage collection globally (persists across runs)
git config --global gc.auto 0
git config --global gc.autoPackLimit 0
git config --global maintenance.auto false
git config gc.auto 0

echo Pushing to GitHub...

:: Refresh index then stage all changes
git status > nul 2>&1
git add -A

:: Commit (--allow-empty ensures Cloudflare always gets a new build trigger)
git commit --allow-empty -m "update"

:: Push — pipe 'n' to auto-dismiss any pack file unlink prompts
echo n | git push

echo.
echo Done! Cloudflare will build and deploy in ~1-2 minutes.
pause
