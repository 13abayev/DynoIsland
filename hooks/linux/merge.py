"""Adds Island's hooks to Claude Code / Codex settings on this machine, or removes them again.
  python3 merge.py install claude|codex [--if-present]
  python3 merge.py uninstall claude|codex
  python3 merge.py status
Prints {"claude": true/false, "codex": true/false}. Your own hooks and settings stay as they are; the first
time a file is changed, a copy is kept next to it as <file>.island-backup."""
import json
import os
import shutil
import sys

HOME = os.path.expanduser('~')
DIR = os.path.join(HOME, '.island')
HOOK = os.path.join(DIR, 'hook.sh')
STATUS = os.path.join(DIR, 'statusline.sh')
ORIGINAL = os.path.join(DIR, 'statusline-original')
CODEX_HOME = os.environ.get('CODEX_HOME') or os.path.join(HOME, '.codex')
TARGETS = {
    'claude': (os.path.join(HOME, '.claude', 'settings.json'),
               ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Notification', 'Stop', 'SessionEnd']),
    'codex': (os.path.join(CODEX_HOME, 'hooks.json'),
              ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Stop', 'SessionEnd']),
}


def ours(hook):
    return isinstance(hook, dict) and '/.island/hook.sh' in str(hook.get('command', ''))


def ours_status(line):
    return isinstance(line, dict) and '/.island/statusline.sh' in str(line.get('command', ''))


def read(path):
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        return {}
    except ValueError:
        sys.exit(path + ' is not valid JSON, so Island left it alone.')


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and not os.path.exists(path + '.island-backup'):
        shutil.copy2(path, path + '.island-backup')
    tmp = path + '.island-tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    os.replace(tmp, path)


def strip(data):
    """Removes Island's hooks, keeps everything else."""
    hooks = data.get('hooks') or {}
    for event in list(hooks):
        groups = []
        for group in hooks[event] or []:
            kept = [h for h in (group.get('hooks') or []) if not ours(h)]
            if kept:
                groups.append({**group, 'hooks': kept})
        if groups:
            hooks[event] = groups
        else:
            del hooks[event]
    if hooks:
        data['hooks'] = hooks
    else:
        data.pop('hooks', None)


def installed(agent):
    data = read(TARGETS[agent][0])
    return any(ours(h) for groups in (data.get('hooks') or {}).values() for g in groups or [] for h in g.get('hooks') or [])


def install(agent, if_present):
    path, events = TARGETS[agent]
    if if_present and not os.path.isdir(os.path.dirname(path)):
        return  # that agent is not used on this machine
    data = read(path)
    strip(data)
    hooks = data.setdefault('hooks', {})
    for event in events:
        hooks.setdefault(event, []).append({'hooks': [{'type': 'command', 'command': f'bash "{HOOK}" {agent}', 'timeout': 5}]})
    if agent == 'claude':
        current = data.get('statusLine')
        if isinstance(current, dict) and current.get('command') and not ours_status(current):
            with open(ORIGINAL, 'w') as f:
                json.dump(current, f)
        data['statusLine'] = {'type': 'command', 'command': f'bash "{STATUS}"'}
    write(path, data)


def uninstall(agent):
    path = TARGETS[agent][0]
    if not os.path.exists(path):
        return
    data = read(path)
    strip(data)
    if agent == 'claude' and ours_status(data.get('statusLine')):
        if os.path.exists(ORIGINAL):
            with open(ORIGINAL) as f:
                data['statusLine'] = json.load(f)
            os.remove(ORIGINAL)
        else:
            data.pop('statusLine', None)
    write(path, data)


if __name__ == '__main__':
    args = sys.argv[1:] or ['status']
    if args[0] == 'install':
        install(args[1], '--if-present' in args)
    elif args[0] == 'uninstall':
        uninstall(args[1])
    print(json.dumps({'claude': installed('claude'), 'codex': installed('codex')}))
