<#
.SYNOPSIS
  kimi-sound-hook 一键远程安装脚本（Windows / PowerShell 5.1+）

.DESCRIPTION
  从 GitHub 下载仓库压缩包 → 解压到 %USERPROFILE%\kimi-sound-hook → 注册 Kimi Code 音效 hooks。
  重复运行即升级：自动备份并恢复你的 sounds.json 与 sounds\ 目录（自定义专辑与音效选择不会丢），
  旧目录改名为 kimi-sound-hook.old-<时间戳> 留作兜底。

.EXAMPLE
  用法（一行命令，在 PowerShell 或 Windows Terminal 中粘贴执行）：

  powershell -ExecutionPolicy Bypass -Command "iex (irm https://raw.githubusercontent.com/Yang-ChenRui/kimi-sound-hook/main/install-remote.ps1)"

.EXAMPLE
  可选参数（一般不需要）：不联网，直接用本地仓库压缩包安装（离线/测试用）

  powershell -ExecutionPolicy Bypass -File install-remote.ps1 -SourceZip D:\path\main.zip

.NOTES
  卸载：双击安装目录里的 uninstall.bat
  项目主页：https://github.com/Yang-ChenRui/kimi-sound-hook
#>

param(
  [string]$SourceZip = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # 关闭 Invoke-WebRequest 进度条，显著加快下载

# GitHub 要求 TLS 1.2；Windows PowerShell 5.1 的默认协议可能不含，显式开启
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

function Fail([string]$Message) {
  Write-Host ''
  Write-Host "[安装失败] $Message" -ForegroundColor Red
  # 失败时尽力清理解压临时目录（变量可能尚未定义，需先判空）
  if ($ExtractDir -and (Test-Path $ExtractDir)) {
    try { Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
  }
  exit 1
}

if ($PSVersionTable.PSVersion.Major -lt 5) {
  Fail "PowerShell 版本过低（当前 $($PSVersionTable.PSVersion)），需要 5.1 或更高版本。"
}

$RepoUrl    = 'https://github.com/Yang-ChenRui/kimi-sound-hook'
$ZipUrl     = "$RepoUrl/archive/refs/heads/main.zip"
$ZipPath    = Join-Path $env:TEMP 'kimi-sound-hook-main.zip'
$TargetDir  = Join-Path $env:USERPROFILE 'kimi-sound-hook'
$Timestamp  = Get-Date -Format 'yyyyMMdd-HHmmss'
$ExtractDir = Join-Path $env:TEMP "ksh-extract-$Timestamp"

Write-Host '============================================================'
Write-Host ' kimi-sound-hook 一键安装程序'
Write-Host " 目标目录：$TargetDir"
Write-Host '============================================================'

# --- [1/5] 检查 Node.js -------------------------------------------------------

Write-Host ''
Write-Host '[1/5] 检查 Node.js 环境 ...' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail '未检测到 Node.js。请先安装 Node.js（版本 >= 18）：https://nodejs.org ——安装完成后重新打开 PowerShell，再运行本脚本。'
}
$nodeVersionText = (node --version)
$nodeMajor = 0
if ($nodeVersionText -match '^v?(\d+)') { $nodeMajor = [int]$Matches[1] }
if ($nodeMajor -lt 18) {
  Fail "Node.js 版本过低（当前 $nodeVersionText，需要 >= 18）。请到 https://nodejs.org 下载安装新版后重试。"
}
Write-Host "      Node.js $nodeVersionText，符合要求。"

# --- [2/5] 获取仓库压缩包 -----------------------------------------------------

if ($SourceZip) {
  Write-Host ''
  Write-Host "[2/5] 使用本地压缩包：$SourceZip" -ForegroundColor Cyan
  if (-not (Test-Path $SourceZip)) { Fail "本地压缩包不存在：$SourceZip" }
  $ZipPath = (Resolve-Path $SourceZip).Path
} else {
  Write-Host ''
  Write-Host '[2/5] 从 GitHub 下载仓库压缩包 ...' -ForegroundColor Cyan
  Write-Host "      $ZipUrl"
  try {
    Invoke-WebRequest -Uri $ZipUrl -OutFile $ZipPath -UseBasicParsing
  } catch {
    $msg = $_.Exception.Message
    if ($msg -match '404|Not Found|NotFound') {
      Fail "下载失败（404）：仓库不存在或尚未公开。请先在浏览器确认 $RepoUrl 可以访问，再重新运行本脚本。"
    }
    if ($msg -match '超时|timed out|无法解析|resolve|无法连接|connect|SSL|TLS|reset|closed|unreachable|代理|proxy') {
      Fail "下载失败，疑似网络问题：$msg`n可先设置代理环境变量后重试，例如在当前窗口执行：`n    `$env:HTTPS_PROXY = 'http://127.0.0.1:7890'`n然后重新运行本脚本；或检查网络连接与系统代理设置。"
    }
    Fail "下载仓库压缩包失败：$msg"
  }
  Write-Host "      已下载到：$ZipPath"
}

# --- [3/5] 解压安装（升级时保留自定义音效与配置） ------------------------------

Write-Host ''
Write-Host "[3/5] 解压安装到 $TargetDir ..." -ForegroundColor Cyan

$IsUpgrade  = Test-Path $TargetDir
$PreserveDir = Join-Path $env:TEMP "ksh-preserve-$Timestamp"

if ($IsUpgrade) {
  Write-Host '      检测到已有安装，执行升级：先备份你的音效与配置 ...'
  New-Item -ItemType Directory -Path $PreserveDir -Force | Out-Null
  if (Test-Path (Join-Path $TargetDir 'sounds.json')) {
    Copy-Item (Join-Path $TargetDir 'sounds.json') $PreserveDir -Force
    Write-Host "      已备份旧的 sounds.json 到 $PreserveDir"
  }
  if (Test-Path (Join-Path $TargetDir 'sounds')) {
    Copy-Item (Join-Path $TargetDir 'sounds') $PreserveDir -Recurse -Force
    Write-Host "      已备份旧的 sounds\ 音效库到 $PreserveDir"
  }
  $OldDir = Join-Path $env:USERPROFILE "kimi-sound-hook.old-$Timestamp"
  try {
    Move-Item $TargetDir $OldDir
  } catch {
    Fail "无法把旧目录改名为 $OldDir ：$($_.Exception.Message)。请关闭占用该目录的程序（资源管理器、终端等）后重试。"
  }
  Write-Host "      旧目录已改名为：$OldDir（确认新版本无误后可手动删除）"
}

try {
  New-Item -ItemType Directory -Path $ExtractDir -Force | Out-Null
  Expand-Archive -Path $ZipPath -DestinationPath $ExtractDir -Force
} catch {
  Fail "解压压缩包失败：$($_.Exception.Message)"
}
$TopDir = Get-ChildItem $ExtractDir -Directory |
  Where-Object { $_.Name -like 'kimi-sound-hook-*' } |
  Select-Object -First 1
if (-not $TopDir) {
  Fail '压缩包结构异常：未找到 kimi-sound-hook-main 顶层目录，压缩包可能已损坏，请重试。'
}
try {
  Move-Item $TopDir.FullName $TargetDir
} catch {
  Fail "无法把新文件移动到 $TargetDir ：$($_.Exception.Message)"
}
Write-Host '      新版本文件已就位。'

if ($IsUpgrade) {
  $preservedConfig = Join-Path $PreserveDir 'sounds.json'
  if (Test-Path $preservedConfig) {
    Copy-Item $preservedConfig (Join-Path $TargetDir 'sounds.json') -Force
    Write-Host '      已恢复你的 sounds.json（各事件的音效选择保持原样）'
  }
  $preservedSounds = Join-Path $PreserveDir 'sounds'
  if (Test-Path $preservedSounds) {
    $destSounds = Join-Path $TargetDir 'sounds'
    New-Item -ItemType Directory -Path $destSounds -Force | Out-Null
    Copy-Item (Join-Path $preservedSounds '*') $destSounds -Recurse -Force
    Write-Host '      已恢复你的 sounds\ 音效库（自定义专辑已保留）'
  }
}

# --- [4/5] 注册 hooks ----------------------------------------------------------

Write-Host ''
Write-Host '[4/5] 注册 Kimi Code 音效 hooks（node install.mjs） ...' -ForegroundColor Cyan
& node (Join-Path $TargetDir 'install.mjs')
if ($LASTEXITCODE -ne 0) {
  Fail "install.mjs 运行失败（退出码 $LASTEXITCODE），请查看上方输出定位原因。"
}

# --- [5/5] 清理与完成提示 ------------------------------------------------------

Write-Host ''
Write-Host '[5/5] 清理临时文件 ...' -ForegroundColor Cyan
try { Remove-Item $ExtractDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
if (-not $SourceZip) {
  try { Remove-Item $ZipPath -Force -ErrorAction SilentlyContinue } catch { }
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor Green
Write-Host ' [完成] kimi-sound-hook 安装成功！' -ForegroundColor Green
Write-Host '============================================================' -ForegroundColor Green
Write-Host " 安装目录：$TargetDir"
Write-Host ''
Write-Host ' 下一步：'
Write-Host '   1. 双击安装目录里的「音效管理.bat」，打开可视化管理器挑选/试听音效；'
Write-Host '   2. 新开一个 Kimi Code 会话，hooks 即生效（会话开始、任务完成、'
Write-Host '      请求审批等事件都会播放提示音）。'
Write-Host ''
Write-Host ' 卸载方法：双击安装目录里的「uninstall.bat」'
Write-Host '           （自动备份后从 config.toml 移除音效 hooks，其余配置不动）。'
Write-Host " 项目主页：$RepoUrl"
Write-Host ''
exit 0
