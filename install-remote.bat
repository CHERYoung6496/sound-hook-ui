@echo off
rem kimi-sound-hook one-click remote installer (double-click friendly wrapper).
rem Supports 6 agent tools: kimi / claude / codex / gemini / cursor / continue.
rem Downloads and runs install-remote.ps1 from GitHub, same as the one-liner in README.
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/Yang-ChenRui/kimi-sound-hook/main/install-remote.ps1)"
pause
