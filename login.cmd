@echo off
setlocal

set "FLOWPASS_LOGIN_ONLY=true"
set "FLOWPASS_HEADLESS=false"
set "FLOWPASS_NONINTERACTIVE=false"
set "FLOWPASS_CONFIRM_BOOKING=false"

call "%~dp0book.cmd"
