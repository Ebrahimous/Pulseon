@echo off
cd /d "%~dp0"
echo Pushing to GitHub...
git add .
git commit -m "update"
git push
echo.
echo Done! Cloudflare will build and deploy in ~1-2 minutes.
pause
