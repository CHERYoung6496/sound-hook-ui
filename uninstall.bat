@echo off
rem sound-hook-ui multi-tool uninstaller launcher (double-click friendly).
rem No args: remove hooks from all supported agent tools
rem (kimi / claude / codex / gemini / cursor / continue / deepseek / pi).
rem Args are passed through to uninstall.mjs, e.g.:
rem   uninstall.bat --tool kimi --tool claude
rem   uninstall.bat --tool kimi,claude
rem   uninstall.bat --list
node "%~dp0uninstall.mjs" %*
pause
