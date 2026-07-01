@echo off
setlocal EnableExtensions EnableDelayedExpansion
if /i not "%~1"=="__run__" (
  start "tooldesk upload plugins" cmd /k ""%~f0" __run__"
  exit /b
)

chcp 65001 >nul
cd /d "%~dp0"

echo [tooldesk] Start uploading plugins to COS...

set "PLUGIN_COUNT=0"
for /d %%D in ("plugins\*") do (
  if exist "%%~fD\plugin.json" (
    set /a PLUGIN_COUNT+=1
    echo.
    echo [tooldesk] Upload plugin: %%~nxD
    call node scripts/upload-plugin-to-cos.mjs "%%~fD"
    if errorlevel 1 (
      set "EXIT_CODE=!ERRORLEVEL!"
      echo.
      echo [tooldesk] Upload failed. Exit code: !EXIT_CODE!
      exit /b !EXIT_CODE!
    )
  )
)

echo.
if "!PLUGIN_COUNT!"=="0" (
  echo [tooldesk] No plugin found in plugins\*\plugin.json.
  exit /b 1
)

echo [tooldesk] Uploaded !PLUGIN_COUNT! plugin(s).
