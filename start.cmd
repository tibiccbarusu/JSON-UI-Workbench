@echo off
rem Compatibility entry for the optional, unfinished experimental GUI.
rem CLI/SDK/API consumers do not run this launcher.
setlocal enableextensions disabledelayedexpansion
rem An inherited ERRORLEVEL variable must not mask native process exit codes.
set "ERRORLEVEL="
rem Normalize without expanding untrusted environment text into command syntax.
set "JSONUI_BOOT_LANGUAGE=ja"
set JSONUI_LANGUAGE 2>nul | "%SystemRoot%\System32\findstr.exe" /i /x /l /c:"JSONUI_LANGUAGE=en" >nul
if "%errorlevel%"=="0" set "JSONUI_BOOT_LANGUAGE=en"
set "JSONUI_LANGUAGE=%JSONUI_BOOT_LANGUAGE%"
rem Preserve the caller's code page; this changes no OS or registry setting.
set "JSONUI_SAVED_CP="
set "JSONUI_CHANGED_CP="
for /f "tokens=2 delims=:" %%C in ('""%SystemRoot%\System32\chcp.com""') do set "JSONUI_SAVED_CP=%%C"
set "JSONUI_SAVED_CP=%JSONUI_SAVED_CP: =%"
set JSONUI_SAVED_CP 2>nul | "%SystemRoot%\System32\findstr.exe" /r /x /c:"JSONUI_SAVED_CP=[0-9][0-9]*" >nul
if not "%errorlevel%"=="0" set "JSONUI_SAVED_CP="
if not defined JSONUI_SAVED_CP goto codepage_ready
"%SystemRoot%\System32\chcp.com" 65001 >nul
if "%errorlevel%"=="0" set "JSONUI_CHANGED_CP=1"
:codepage_ready
rem Run with cmd.exe. Paths stay quoted data and delayed expansion stays off.
set "JSONUI_STAGE="
set "JSONUI_NODE="
set "JSONUI_EXIT=1"
set "JSONUI_BOOT_SOURCE=unselected"
rem Check extraction before treating a missing checker as an incompatible Node.
if not exist "%~dp0local-node\version-check.cjs" goto package_incomplete
if not exist "%~dp0local-node\preflight28.cjs" goto package_incomplete
if not exist "%~dp0local-node\runtime-files28.json" goto package_incomplete
if not exist "%~dp0local-node\launcher.mjs" goto package_incomplete
if not exist "%~dp0local-node\server.mjs" goto package_incomplete
if not exist "%~dp0editor-core\app\index.html" goto package_incomplete
if not exist "%~dp0editor-core\src\main.js" goto package_incomplete
rem Create bounded startup evidence for both installed and private Node paths.
set "JSONUI_PATH_PROBE=%~dp0.jsonui\download-00000-00000\node.part"
if not "%JSONUI_PATH_PROBE:~239,1%"=="" goto path_long
if not exist "%~dp0.jsonui\" mkdir "%~dp0.jsonui"
if not exist "%~dp0.jsonui\" goto setup_failed
if exist "%~dp0.jsonui\bootstrap.log" for %%L in ("%~dp0.jsonui\bootstrap.log") do if %%~zL GTR 1048576 move /y "%~dp0.jsonui\bootstrap.log" "%~dp0.jsonui\bootstrap.log.1" >nul
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_BEGIN
for %%N in (node.exe) do set "JSONUI_NODE=%%~$PATH:N"
if not defined JSONUI_NODE goto private_runtime
set "JSONUI_BOOT_SOURCE=path"
"%JSONUI_NODE%" "%~dp0local-node\version-check.cjs"
set "JSONUI_CHECK_EXIT=%errorlevel%"
rem Only an exact zero confirms compatibility; a crashed Node may exit negative.
if "%JSONUI_CHECK_EXIT%"=="0" goto launch
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_PATH_NODE_UNAVAILABLE exit=%JSONUI_CHECK_EXIT%
:private_runtime
set "JSONUI_BOOT_SOURCE=private-cache"
set "JSONUI_PATH_PROBE=%~dp0.jsonui\download-00000-00000\node.part"
if not "%JSONUI_PATH_PROBE:~239,1%"=="" goto path_long
set "JSONUI_ARCH=%PROCESSOR_ARCHITEW6432%"
if not defined JSONUI_ARCH set "JSONUI_ARCH=%PROCESSOR_ARCHITECTURE%"
if /i "%JSONUI_ARCH%"=="AMD64" goto arch_x64
if /i "%JSONUI_ARCH%"=="ARM64" goto arch_arm64
set "JSONUI_EXIT=20"
call :status SETUP_ARCH_UNSUPPORTED
goto finish
:arch_x64
set "JSONUI_DOWNLOAD_URL=https://nodejs.org/dist/v24.21.0/win-x64/node.exe"
set "JSONUI_EXPECTED_HASH=ba4e6d110e8c1592a1ecd390f6b05f3da124b13871a5be62b341a07a853c6c32"
goto prepare_stage
:arch_arm64
set "JSONUI_DOWNLOAD_URL=https://nodejs.org/dist/v24.21.0/win-arm64/node.exe"
set "JSONUI_EXPECTED_HASH=dff59da18b6ffe1bf1ca99e1d2af4906080c481740619f5b5098c0fca28bd9b7"
:prepare_stage
set "JSONUI_STAGE_TRIES=0"
:make_stage
set /a JSONUI_STAGE_TRIES+=1 >nul
set "JSONUI_STAGE=%~dp0.jsonui\download-%RANDOM%-%RANDOM%"
mkdir "%JSONUI_STAGE%" 2>nul
if not errorlevel 1 goto stage_ready
if %JSONUI_STAGE_TRIES% LSS 3 goto make_stage
set "JSONUI_STAGE="
goto setup_failed
:stage_ready
set "JSONUI_NODE=%~dp0.jsonui\runtime\node.exe"
if not exist "%JSONUI_NODE%" goto missing_runtime
if not exist "%SystemRoot%\System32\certutil.exe" goto powershell_fallback
call :verify_node
if errorlevel 2 goto powershell_fallback
if errorlevel 1 goto repair_runtime
goto launch
:missing_runtime
rem An interrupted/manual extraction may leave a runtime directory or file.
rem Preserve that app-owned entry as well, so it cannot block every retry.
if exist "%~dp0.jsonui\runtime\" goto repair_runtime
if exist "%~dp0.jsonui\runtime" goto repair_runtime
goto download_runtime
:repair_runtime
rem Preserve a failed app-owned runtime and retry initial setup automatically.
set "JSONUI_BAD_RUNTIME=bad-%RANDOM%-%RANDOM%"
ren "%~dp0.jsonui\runtime" "%JSONUI_BAD_RUNTIME%" 2>nul
if errorlevel 1 goto runtime_invalid
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_RUNTIME_QUARANTINED
set "JSONUI_NODE=%~dp0.jsonui\runtime\node.exe"
goto download_runtime
:download_runtime
set "JSONUI_BOOT_SOURCE=download"
if not exist "%SystemRoot%\System32\curl.exe" goto powershell_fallback
if not exist "%SystemRoot%\System32\certutil.exe" goto powershell_fallback
set "JSONUI_DOWNLOAD_TRIES=0"
:download_attempt
set /a JSONUI_DOWNLOAD_TRIES+=1 >nul
call :status SETUP_DOWNLOAD
echo attempt=%JSONUI_DOWNLOAD_TRIES%/2
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_DOWNLOAD attempt=%JSONUI_DOWNLOAD_TRIES% node=24.21.0
"%SystemRoot%\System32\curl.exe" --disable --fail --progress-bar --proto "=https" --tlsv1.2 --connect-timeout 30 --max-time 180 --max-filesize 268435456 --output "%JSONUI_STAGE%\node.part" --url "%JSONUI_DOWNLOAD_URL%"
set "JSONUI_CURL_EXIT=%errorlevel%"
if "%JSONUI_CURL_EXIT%"=="0" goto verify_download
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_DOWNLOAD_FAILED curl_exit=%JSONUI_CURL_EXIT%
if %JSONUI_DOWNLOAD_TRIES% LSS 2 goto download_attempt
goto setup_failed
:verify_download
call :status SETUP_VERIFYING
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_VERIFYING
set "JSONUI_NODE=%JSONUI_STAGE%\node.part"
call :verify_node
if errorlevel 2 goto powershell_fallback
if errorlevel 1 goto hash_mismatch
ren "%JSONUI_STAGE%\node.part" node.exe
if errorlevel 1 goto setup_failed
rem Renaming the whole directory publishes a complete runtime without overwrite.
ren "%JSONUI_STAGE%" runtime 2>nul
if errorlevel 1 goto adopt_existing
set "JSONUI_STAGE="
set "JSONUI_NODE=%~dp0.jsonui\runtime\node.exe"
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_RUNTIME_READY node=24.21.0 sha256=verified
goto launch
:adopt_existing
set "JSONUI_BOOT_SOURCE=concurrent-cache"
rem Another simultaneous launch may have published the same verified runtime.
set "JSONUI_NODE=%~dp0.jsonui\runtime\node.exe"
call :verify_node
if errorlevel 1 goto runtime_invalid
goto launch
:powershell_fallback
set "JSONUI_BOOT_SOURCE=powershell"
call :clean_stage
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -File "%~dp0local-node\bootstrap.ps1"
set "JSONUI_EXIT=%errorlevel%"
if "%JSONUI_EXIT%"=="0" goto finish
call :status SETUP_FALLBACK_FAILED
goto finish
:launch
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_LAUNCH source=%JSONUI_BOOT_SOURCE%
call :clean_stage
"%JSONUI_NODE%" "%~dp0local-node\preflight28.cjs"
if not "%errorlevel%"=="0" goto package_incomplete
"%JSONUI_NODE%" "%~dp0local-node\launcher.mjs"
set "JSONUI_EXIT=%errorlevel%"
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_LAUNCH_EXIT exit=%JSONUI_EXIT%
if not "%JSONUI_EXIT%"=="0" call :status SETUP_LAUNCH_FAILED
goto finish
:runtime_invalid
set "JSONUI_EXIT=23"
call :status SETUP_EXISTING_RUNTIME_INVALID
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_EXISTING_RUNTIME_INVALID
goto finish
:hash_mismatch
set "JSONUI_EXIT=24"
call :status SETUP_SHA256_MISMATCH
>> "%~dp0.jsonui\bootstrap.log" echo SETUP_SHA256_MISMATCH
goto finish
:path_long
call :status SETUP_PATH_LONG
set "JSONUI_EXIT=21"
goto finish
:package_incomplete
set "JSONUI_EXIT=22"
call :status SETUP_PACKAGE_INCOMPLETE
goto finish
:setup_failed
call :status SETUP_FAILED
goto finish
:verify_node
rem Internal label only: no untrusted arguments cross CALL's second expansion.
"%SystemRoot%\System32\certutil.exe" -hashfile "%JSONUI_NODE%" SHA256 > "%JSONUI_STAGE%\sha.txt" 2>nul
if not "%errorlevel%"=="0" exit /b 2
if not exist "%SystemRoot%\System32\findstr.exe" exit /b 2
"%SystemRoot%\System32\findstr.exe" /i /x /c:"%JSONUI_EXPECTED_HASH%" "%JSONUI_STAGE%\sha.txt" >nul
rem Normalize verifier status so a negative native crash code cannot mean match.
if "%errorlevel%"=="0" exit /b 0
if "%errorlevel%"=="1" exit /b 1
exit /b 2
:clean_stage
if not defined JSONUI_STAGE exit /b 0
if exist "%JSONUI_STAGE%\" rmdir /s /q "%JSONUI_STAGE%"
set "JSONUI_STAGE="
exit /b 0
:status
rem Called only with fixed application-owned event codes, never user arguments.
"%SystemRoot%\System32\findstr.exe" /b /l /c:"%~1: " "%~dp0local-node\bootstrap-messages-%JSONUI_BOOT_LANGUAGE%.txt" 2>nul
if errorlevel 1 echo %~1: See local-node\START-ja.md.
exit /b 0
:finish
call :clean_stage
if defined JSONUI_CHANGED_CP "%SystemRoot%\System32\chcp.com" %JSONUI_SAVED_CP% >nul
endlocal & exit /b %JSONUI_EXIT%
