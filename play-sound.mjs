#!/usr/bin/env node
// Kimi Code CLI sound hook player
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

/**
 * Map Kimi hook events to the event names used in sounds.json.
 */
function mapEvent(payload) {
  const event = payload?.hook_event_name;
  const toolName = payload?.tool_name;

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
  log(`received payload event=${payload?.hook_event_name} tool=${payload?.tool_name}`);

  const eventName = mapEvent(payload);
  if (!eventName) {
    log('no mapped event, skipping');
    return;
  }
  log(`mapped to ${eventName}`);

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
