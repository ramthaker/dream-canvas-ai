@echo off
setlocal

pushd "%~dp0" || exit /b 1

call npm install
if errorlevel 1 goto finish

call npx playwright install chromium

:finish
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
