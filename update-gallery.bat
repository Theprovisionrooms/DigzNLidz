@echo off
echo Updating the gallery from public\assets\gallery\photos ...
node tools\generate-gallery-manifest.js
echo.
echo Done. Check the changes in GitHub Desktop, commit, and push as normal.
pause
