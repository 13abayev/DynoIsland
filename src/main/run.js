'use strict';
// Runs a program with `input` on its stdin and collects what it prints (place extensions: a script through
// wsl.exe or ssh … bash -s). Resolves { code, out, err }; never rejects.
const { spawn } = require('child_process');

function run(cmd, args, input = '', { timeout = 60000 } = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    const child = spawn(cmd, args, { windowsHide: true, env: { ...process.env, WSL_UTF8: '1' } });
    const timer = setTimeout(() => { child.kill(); err += '\ntook too long'; }, timeout);
    child.stdout.on('data', d => (out += d));
    child.stderr.on('data', d => (err += d));
    child.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, out: out.replace(/\r/g, ''), err: err.replace(/\r/g, '') }); });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

module.exports = { run };
