@echo off
rem kimi-sound-hook multi-tool installer launcher (double-click friendly).
rem No args: auto-detect and install to all supported agent tools
rem (kimi / claude / codex / gemini / cursor / continue).
rem Args are passed through to install.mjs, e.g.:
rem   install.bat --tool kimi --tool claude
rem   install.bat --tool kimi,claude
rem   install.bat --list
node "%~dp0install.mjs" %*
pause
