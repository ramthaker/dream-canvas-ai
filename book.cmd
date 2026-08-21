@echo off
setlocal

pushd "%~dp0" || exit /b 1
call node "%CD%\src\flowpass-booker.mjs"
set "EXIT_CODE=%ERRORLEVEL%"
popd
exit /b %EXIT_CODE%
