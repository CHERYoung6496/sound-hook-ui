#!/usr/bin/env node
// Multi-tool agent CLI sound hook player (kimi/claude/codex/gemini/cursor/continue/deepseek/pi)
// Reads hook payload from stdin, maps events to pi-sound-style names,
// and plays the configured .wav sound asynchronously.

import { exec } from 'node:child_process';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, 'sounds.json');
const LOG_PATH = join(__dirname, 'sound-debug.log');

function log(line) {
  const ts = new Date().toISOString();
  try {
    appendFileSync(LOG_PATH, `[${ts}] ${line}\n`, 'utf8');
  } catch {}
}

const TOOL_IDS = ['kimi', 'claude', 'codex', 'gemini', 'cursor', 'continue', 'deepseek', 'pi'];

// The 12 generic sound event names used in sounds.json. Pi payloads carry one
// of these verbatim in payload.event.
const GENERIC_EVENTS = new Set([
  'agent_end', 'input', 'session_start', 'session_end', 'permission_request',
  'ask_user_question:start', 'ask_user_question:result', 'agent_end_failure',
  'tool_execution_error', 'interrupt', 'subagent_start', 'subagent_stop',
]);

// Event values only emitted by Gemini CLI (used for payload-based inference).
const GEMINI_ONLY_EVENTS = new Set([
  'BeforeAgent', 'AfterAgent', 'Notification', 'BeforeTool', 'AfterTool', 'PreCompress',
]);

// Per-tool event mappers: (event, toolName, payload) => sounds.json event name or null.
// `event` is payload.hook_event_name for every tool except pi, whose mapper
// reads the generic event name straight from payload.event.

function mapKimiEvent(event, toolName) {
  if (event === 'PreToolUse' && toolName === 'AskUserQuestion') {
    return 'ask_user_question:start';
  }
  if (event === 'PermissionRequest') return 'permission_request';
  if (event === 'PostToolUse' && toolName === 'AskUserQuestion') {
    return 'ask_user_question:result';
  }
  if (event === 'SessionStart') return 'session_start';
  if (event === 'SessionEnd') return 'session_end';
  if (event === 'Stop') return 'agent_end';
  if (event === 'StopFailure') return 'agent_end_failure';
  if (event === 'UserPromptSubmit') return 'input';
  if (event === 'PostToolUseFailure') return 'tool_execution_error';
  if (event === 'Interrupt') return 'interrupt';
  if (event === 'SubagentStart') return 'subagent_start';
  if (event === 'SubagentStop') return 'subagent_stop';
  return null;
}

function mapClaudeEvent(event, toolName) {
  if (event === 'Notification') return 'permission_request';
  if (event === 'Interrupt') return null;
  return mapKimiEvent(event, toolName);
}

function mapCodexEvent(event) {
  if (event === 'Stop') return 'agent_end';
  if (event === 'SessionStart') return 'session_start';
  if (event === 'SessionEnd') return 'session_end';
  if (event === 'UserPromptSubmit') return 'input';
  if (event === 'PermissionRequest') return 'permission_request';
  if (event === 'Interrupt') return 'interrupt';
  if (event === 'SubagentStart') return 'subagent_start';
  if (event === 'SubagentStop') return 'subagent_stop';
  return null;
}

function mapGeminiEvent(event, toolName, payload) {
  if (event === 'AfterAgent') return 'agent_end';
  if (event === 'BeforeAgent') return 'input';
  if (event === 'SessionStart') return 'session_start';
  if (event === 'SessionEnd') return 'session_end';
  if (event === 'Notification') {
    return payload?.notification_type === 'ToolPermission' ? 'permission_request' : null;
  }
  if (event === 'AfterTool') {
    const response = payload?.tool_response;
    const hasError = response !== null && typeof response === 'object' && 'error' in response;
    return hasError ? 'tool_execution_error' : null;
  }
  return null;
}

function mapCursorEvent(event, toolName, payload) {
  if (event === 'stop') {
    if (payload?.status === 'aborted') return 'interrupt';
    if (payload?.status === 'error') return 'agent_end_failure';
    return 'agent_end';
  }
  if (event === 'sessionStart') return 'session_start';
  if (event === 'sessionEnd') return 'session_end';
  if (event === 'beforeSubmitPrompt') return 'input';
  if (event === 'postToolUseFailure') return 'tool_execution_error';
  return null;
}

function mapPiEvent(event, toolName, payload) {
  return GENERIC_EVENTS.has(payload?.event) ? payload.event : null;
}

const EVENT_MAPPERS = {
  kimi: mapKimiEvent,
  claude: mapClaudeEvent,
  codex: mapCodexEvent,
  gemini: mapGeminiEvent,
  cursor: mapCursorEvent,
  continue: mapClaudeEvent,
  deepseek: mapClaudeEvent,
  pi: mapPiEvent,
};

function parseToolArg(argv) {
  const idx = argv.indexOf('--tool');
  if (idx === -1) return null;
  const id = argv[idx + 1];
  return TOOL_IDS.includes(id) ? id : null;
}

// Infer the tool when --tool is absent: pi glue extensions send a generic
// snake_case payload.event (or tool === 'pi'), cursor uses camelCase, Gemini
// has its own PascalCase set, everything else falls back to the shared
// kimi/claude mapping (backwards compatible with old installs).
function inferTool(event, payload) {
  if (payload?.tool === 'pi') return 'pi';
  if (GENERIC_EVENTS.has(payload?.event)) return 'pi';
  if (typeof event !== 'string' || event === '') return 'kimi';
  if (/^[a-z]/.test(event)) return 'cursor';
  if (GEMINI_ONLY_EVENTS.has(event)) return 'gemini';
  return 'kimi';
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function pickSound(eventConfig) {
  const { mode, sounds } = eventConfig;
  if (!Array.isArray(sounds) || sounds.length === 0) return null;

  if (mode === 'disabled') return null;
  if (mode === 'sequential') {
    // Simple round-robin based on a shared counter file is overkill for a hook.
    // Fall back to random for sequential in this lightweight player.
    return sounds[Math.floor(Math.random() * sounds.length)];
  }
  if (mode === 'random') {
    return sounds[Math.floor(Math.random() * sounds.length)];
  }
  // mode === 'single' or any other value: always use the first sound.
  return sounds[0];
}

function playSound(filePath) {
  const absPath = isAbsolute(filePath) ? resolve(filePath) : resolve(__dirname, filePath);
  const winPath = absPath.replace(/\//g, '\\');
  // Spawn a visible console (minimized) so PowerShell gets its own audio session.
  // This works around GUI/headless parent processes that cannot play sound.
  const psCommand = `try { (New-Object System.Media.SoundPlayer '${winPath.replace(/'/g, "''")}').PlaySync() } catch { }`;
  const cmd = `cmd /c start /min "" powershell.exe -NoProfile -WindowStyle Hidden -Command "${psCommand.replace(/"/g, '\\"')}"`;
  exec(cmd, { windowsHide: true }, (err) => {
    if (err) log(`start/powershell error: ${err.message}`);
    else log('start/powershell player launched');
  });
}

async function main() {
  const payload = await readStdin();
  const event = payload?.hook_event_name;
  const toolName = payload?.tool_name;

  const argTool = parseToolArg(process.argv.slice(2));
  const tool = argTool ?? inferTool(event, payload);
  log(`received payload event=${event} tool=${toolName} hook_tool=${tool}${argTool ? '' : ' (inferred)'}`);

  const eventName = EVENT_MAPPERS[tool](event, toolName, payload);
  if (!eventName) {
    log(`no mapped event for hook_tool=${tool}, skipping`);
    return;
  }
  log(`mapped to ${eventName} (hook_tool=${tool})`);

  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    log(`failed to read config: ${err.message}`);
    return;
  }

  if (config.enabled === false) {
    log('sound disabled in config');
    return;
  }

  const eventConfig = config.events?.[eventName];
  if (!eventConfig) {
    log(`no event config for ${eventName}`);
    return;
  }

  const soundFile = pickSound(eventConfig);
  if (!soundFile) {
    log(`no sound picked for ${eventName} (mode=${eventConfig.mode})`);
    return;
  }
  log(`playing ${soundFile}`);

  playSound(soundFile);
  log('spawned player process');
}

main().catch((err) => log(`uncaught error: ${err.message}`));
