@echo off
if /i not "%~1"=="__run__" (
  start "tooldesk upload" cmd /k ""%~f0" __run__"
  exit /b
)

chcp 65001 >nul
cd /d "%~dp0"

echo [tooldesk] Start uploading app release and plugins to COS...
call npm.cmd run release:cos:all

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [tooldesk] Upload failed. Exit code: %EXIT_CODE%
  exit /b %EXIT_CODE%
)

echo [tooldesk] Upload finished.
