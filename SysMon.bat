@echo off
rem  SysMon - double-click this.
rem
rem  It starts the probe agent, which serves SysMon on this PC and does the
rem  real ping and HTTP checks, then opens your browser on it.
rem
rem  The window that appears IS SysMon's agent. Leave it open. Closing it stops
rem  the real checks; SysMon carries on with simulated ones and says so.
rem
rem  Nothing is installed. This uses the PowerShell that comes with Windows.
rem
rem    SysMon.bat            this PC only, port 8765
rem    SysMon.bat 9000       a different port, if 8765 is taken
rem    SysMon.bat --lan      also serve phones on the same Wi-Fi (see below)
rem    SysMon.bat 9000 --lan both
rem
rem  --lan needs either an Administrator window or a one-off permission, and
rem  the agent prints the exact command if it hits that. Without it, SysMon is
rem  reachable from this PC and nothing else, which is the safer default: the
rem  agent will ping any address it is asked to, so it is not something to
rem  leave open to a network you do not control.

setlocal
set "PORT=8765"
set "LAN="

rem  Arguments in either order: a number is the port, --lan is the switch.
:args
if "%~1"=="" goto ready
if /i "%~1"=="--lan" (set "LAN=-Lan") else (set "PORT=%~1")
shift
goto args

:ready
set "AGENT=%~dp0agent\sysmon-agent.ps1"
if not exist "%AGENT%" (
  echo.
  echo   Cannot find agent\sysmon-agent.ps1 next to this file.
  echo   Keep SysMon.bat in the same folder as index.html.
  echo.
  pause
  exit /b 1
)

rem  Its own window, titled, so it is obvious which one to leave open and which
rem  one to close. -ExecutionPolicy Bypass because the default policy blocks
rem  scripts and nobody should have to change a machine-wide setting to read a
rem  ping. -NoProfile so a profile that writes to the console cannot corrupt the
rem  first response.
start "SysMon agent" powershell -NoProfile -ExecutionPolicy Bypass -File "%AGENT%" -Port %PORT% %LAN%

endlocal
