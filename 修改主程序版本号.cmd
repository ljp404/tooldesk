@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"

set "CURRENT_VERSION="
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "CURRENT_VERSION=%%V"
if "%CURRENT_VERSION%"=="" (
  set "CURRENT_VERSION=未知"
)

set "NEXT_VERSION=%~1"
if /i "%NEXT_VERSION%"=="__run__" (
  set "NEXT_VERSION=%~2"
)

if "%NEXT_VERSION%"=="" (
  set /p "NEXT_VERSION=请输入主程序版本号，当前版本 !CURRENT_VERSION!: "
)

if "%NEXT_VERSION%"=="" (
  echo [tooldesk] 版本号不能为空。
  pause
  exit /b 1
)

call npm.cmd run version:set -- "%NEXT_VERSION%"

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [tooldesk] Version update failed. Exit code: %EXIT_CODE%
  pause
  exit /b %EXIT_CODE%
)

echo [tooldesk] Version update finished.
pause
