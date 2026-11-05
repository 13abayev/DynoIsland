'use strict';
// Reading and writing other programs' settings files (an agent's hooks, your SSH config) without losing anything:
// a file that is not valid JSON is left alone, and the first time Island changes a file it keeps a copy next to it
// as <file>.island-backup.
const fs = require('fs');
const path = require('path');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw new Error(`${file} is not valid JSON, so Island left it alone.`);
  }
}

function writeKeepingBackup(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && !fs.existsSync(file + '.island-backup')) fs.copyFileSync(file, file + '.island-backup');
  fs.writeFileSync(file + '.island-tmp', text);
  fs.renameSync(file + '.island-tmp', file);
}

const writeJson = (file, data) => writeKeepingBackup(file, JSON.stringify(data, null, 2) + '\n');

module.exports = { readJson, writeJson, writeKeepingBackup };
