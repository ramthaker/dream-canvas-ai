@echo off
setlocal

set "FLOWPASS_DATE_TEXT=28|28th|May 28|28 May|2026-05-28"
set "FLOWPASS_PRIMARY_TEXT=Co-working day pass|Coworking day pass|Co-working pass|Coworking pass"
set "FLOWPASS_FALLBACK_TEXT=Last-minute day pass|Last minute day pass"
set "FLOWPASS_FALLBACK_PICK=last"
set "FLOWPASS_ONLY_AVAILABLE=true"
set "FLOWPASS_CONFIRM_BOOKING=true"
set "FLOWPASS_ALLOW_PAYMENT_ACTION=false"
set "FLOWPASS_NONINTERACTIVE=true"
set "FLOWPASS_HEADLESS=true"

call "%~dp0book.cmd"
