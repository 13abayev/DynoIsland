"""For hook.sh: prints two lines, both base64 so any text is safe in an HTTP header.
  1. the git branch of the session's folder
  2. when the agent stopped: the start of its last answer (from the event, or the end of the transcript)"""
import base64
import json
import os
import re
import sys


def b64(text):
    return base64.b64encode(text.encode()).decode() if text else ''


def branch(folder):
    d = os.path.abspath(folder) if folder else ''
    while d:
        git = os.path.join(d, '.git')
        head = None
        if os.path.isdir(git):
            head = os.path.join(git, 'HEAD')
        elif os.path.isfile(git):  # a worktree: ".git" is a file pointing at the real folder
            target = open(git).read().strip()
            if target.startswith('gitdir:'):
                head = os.path.join(os.path.join(d, target[7:].strip()), 'HEAD')
        if head:
            text = open(head).read().strip()
            return text[16:] if text.startswith('ref: refs/heads/') else text[:7]
        parent = os.path.dirname(d)
        d = '' if parent == d else parent
    return ''


def clean(text):
    # markdown marks only: single _ and * stay, they are part of names like test_client.py
    text = re.sub(r'(?m)`+|\*\*|__|^\s*(#+|>)\s*|\|', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text[:217].rstrip() + '…' if len(text) > 220 else text


def last_reply(ev):
    direct = ev.get('last_assistant_message') or ''
    if isinstance(direct, str) and direct:
        return clean(direct)
    path = ev.get('transcript_path') or ''
    if not path or not os.path.isfile(path):
        return ''
    with open(path, 'rb') as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 512 * 1024))
        lines = f.read().decode('utf-8', 'replace').split('\n')
    for line in reversed(lines):
        if '"assistant"' not in line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue  # the first line of the tail can be cut in half
        if row.get('type') != 'assistant':
            continue
        content = (row.get('message') or {}).get('content')
        if isinstance(content, str):
            parts = [content]
        else:
            parts = [p.get('text', '') for p in content or [] if isinstance(p, dict) and p.get('type') == 'text']
        text = ' '.join(p for p in parts if p)
        if text:
            return clean(text)
    return ''


ev = json.load(sys.stdin)
try:
    print(b64(branch(ev.get('cwd') or '')))
except OSError:
    print('')
try:
    print(b64(last_reply(ev)) if ev.get('hook_event_name') == 'Stop' else '')
except OSError:
    print('')
