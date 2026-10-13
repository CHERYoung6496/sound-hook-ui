@echo off
setlocal
rem Kimi Code sound manager launcher.
rem If the port is already LISTENING, the server is running -> just open the browser.

if "%SOUND_MANAGER_PORT%"=="" set "SOUND_MANAGER_PORT=23177"
set "URL=http://127.0.0.1:%SOUND_MANAGER_PORT%"

netstat -ano | findstr /C:":%SOUND_MANAGER_PORT% " | findstr /C:"LISTENING" >nul 2>&1
if errorlevel 1 (
    start /min "" node "%~dp0manager\server.mjs"
    ping -n 2 127.0.0.1 >nul
)
start "" "%URL%"
endlocal
