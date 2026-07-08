@echo off
if /i not "%~1"=="__run__" (
  start "tooldesk upload desktop" cmd /k ""%~f0" __run__"
  exit /b
)

chcp 65001 >nul
cd /d "%~dp0"

echo [tooldesk] Start uploading desktop app release to COS...
call npm.cmd run release:cos

set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" (
  echo [tooldesk] Upload failed. Exit code: %EXIT_CODE%
  exit /b %EXIT_CODE%
)

echo [tooldesk] Desktop app upload finished.
