#!/usr/bin/env python3
"""island: tells the Island app on your Windows PC about your long-running jobs.

  island run [--name NAME] -- COMMAND [ARGS...]
      Runs COMMAND here, as usual (its output, colors and progress bars show in your terminal as always).
      Island shows it running with its time, its last line and any progress it sees ("45%", "Epoch 12/50"),
      and tells you when it finishes or fails. Exits with COMMAND's exit code.
  island progress PERCENT [MESSAGE]
      Sets the progress yourself, from inside a job (a script started with island run) or any script.
  island notify MESSAGE
      A notification on your PC.

Works in WSL and on SSH servers connected to Island. When Island cannot be reached, your command still runs.
"""
import json
import os
import pty
import re
import shlex
import socket
import subprocess
import sys
import threading
import time
import uuid

DIR = os.path.expanduser('~/.island')


def conf(name, default=''):
    try:
        with open(os.path.join(DIR, name)) as f:
            return f.read().strip() or default
    except OSError:
        return default


TOKEN, SRC, PORT, ALIAS = conf('token'), conf('src', 'ssh'), conf('port', '47900'), conf('alias')


def post(route, body):
    """Sends to Island. Never fails your job: if Island is not there, nothing happens."""
    if not TOKEN:
        return
    data = json.dumps(body).encode()
    url = f'http://127.0.0.1:{PORT}{route}'
    headers = {'Content-Type': 'application/json', 'X-Island-Token': TOKEN, 'X-Island-Src': SRC, 'X-Island-Host': socket.gethostname(),
               'X-Island-Alias': ALIAS, 'X-Island-Distro': os.environ.get('WSL_DISTRO_NAME', '')}
    try:
        if SRC == 'wsl':  # WSL reaches Island through Windows' own curl.exe
            args = ['/mnt/c/Windows/System32/curl.exe', '-s', '-m', '3', '-X', 'POST', '--data-binary', '@-']
            for k, v in headers.items():
                args += ['-H', f'{k}: {v}']
            subprocess.run(args + [url], input=data, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=6)
        else:  # on a server, 127.0.0.1:PORT is the tunnel Island keeps open back to your PC
            import urllib.request
            urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=3).read()
    except Exception:
        pass


ANSI = re.compile(r'\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[()][A-Z0-9]')
PERCENT = re.compile(r'(\d{1,3}(?:\.\d+)?)\s?%')
RATIO = re.compile(r'\b(?:epoch|step|iter(?:ation)?|batch|round|fold|shard|file|item)s?\s*[:#]?\s*(\d+)\s*/\s*(\d+)', re.I)


def progress_of(line):
    """A percentage seen in a line of output: "45%" (tqdm and friends), or "Epoch 12/50"."""
    found = [float(p) for p in PERCENT.findall(line) if 0 <= float(p) <= 100]
    if found:
        return found[-1]
    for done, total in reversed(RATIO.findall(line)):
        done, total = int(done), int(total)
        if 0 < total and 0 <= done <= total:
            return 100.0 * done / total
    return None


def job_name(argv):
    """train.py for "python train.py --lr 3e-4", make for "make all", …"""
    runners = {'python', 'python3', 'bash', 'sh', 'node', 'uv', 'poetry', 'torchrun', 'accelerate', 'deepspeed', 'nohup', 'time', 'sudo'}
    for arg in argv:
        if any(c.isspace() for c in arg.strip()):  # a script given as one string: bash -c 'python train.py'
            try:
                name = job_name(shlex.split(arg))
            except ValueError:
                name = arg.split()[0]
            return 'script' if name in ('for', 'while', 'until', 'if', 'case', '{', '(') else name
        base = os.path.basename(arg)
        if base in runners or base.startswith('-') or base in ('run', 'launch'):
            continue
        return base
    return os.path.basename(argv[0])


def run(argv, name):
    job = uuid.uuid4().hex[:12]
    os.environ['ISLAND_JOB'] = job  # "island progress" inside the job reports to this job
    started = time.time()
    about = {'id': job, 'name': name, 'cmd': ' '.join(argv)[:400], 'cwd': os.getcwd(), 'started': round(started)}
    state = {'line': '', 'cur': '', 'tail': [], 'percent': None, 'dirty': True}
    post('/job', {**about, 'event': 'start'})

    stop = threading.Event()

    def reporter():
        sent = time.time()
        while not stop.wait(2):
            # what changed, every 2 seconds; otherwise a sign of life every 30 seconds
            if state['dirty'] or time.time() - sent > 30:
                state['dirty'] = False
                sent = time.time()
                # who it is goes along every time: Island may have restarted since the job started
                post('/job', {**about, 'event': 'progress', 'last': state['line'][-300:], 'percent': state['percent']})

    threading.Thread(target=reporter, daemon=True).start()

    def read(fd):
        data = os.read(fd, 65536)
        # progress bars redraw their line after a \r: what follows the last \r is what you see now
        for piece in re.split(r'(\r|\n)', ANSI.sub('', data.decode('utf-8', 'replace'))):
            if piece == '\n':
                if state['cur'].strip():
                    state['tail'] = (state['tail'] + [state['cur'].strip()])[-5:]
                state['cur'] = ''
            elif piece == '\r':
                state['cur'] = ''
            elif piece:
                state['cur'] += piece
                if state['cur'].strip():
                    state['line'] = state['cur'].strip()
                    p = progress_of(state['cur'])
                    if p is not None:
                        state['percent'] = round(p, 1)
                    state['dirty'] = True
        return data

    try:
        code = os.waitstatus_to_exitcode(pty.spawn(argv, read))
    except FileNotFoundError:
        print(f'island: command not found: {argv[0]}', file=sys.stderr)
        code = 127
    except KeyboardInterrupt:
        code = 130
    stop.set()
    tail = state['tail'] + ([state['cur'].strip()] if state['cur'].strip() else [])
    post('/job', {**about, 'event': 'end', 'exit': code, 'seconds': round(time.time() - started), 'tail': tail[-5:], 'last': state['line'][-300:]})
    return code


def main(args):
    if not args or args[0] in ('-h', '--help', 'help'):
        print(__doc__.strip())
        return 0
    cmd, rest = args[0], args[1:]
    if cmd == 'run':
        name = None
        if rest[:1] == ['--name'] and len(rest) > 1:
            name, rest = rest[1], rest[2:]
        if rest[:1] == ['--']:
            rest = rest[1:]
        if not rest:
            print('usage: island run [--name NAME] -- COMMAND [ARGS...]', file=sys.stderr)
            return 2
        return run(rest, name or job_name(rest))
    if cmd == 'progress' and rest:
        try:
            percent = max(0.0, min(100.0, float(rest[0].rstrip('%'))))
        except ValueError:
            print('usage: island progress PERCENT [MESSAGE]', file=sys.stderr)
            return 2
        message = ' '.join(rest[1:])
        body = {'event': 'progress', 'percent': percent, 'last': message}
        if os.environ.get('ISLAND_JOB'):  # inside "island run": that job's progress
            body['id'] = os.environ['ISLAND_JOB']
        else:  # a script of its own: named after it
            parent = ''
            try:
                with open(f'/proc/{os.getppid()}/cmdline', 'rb') as f:
                    parent = job_name([a.decode(errors='replace') for a in f.read().split(b'\0') if a])
            except OSError:
                pass
            body.update(id=f'script-{os.getppid()}', name=parent or 'Script')
        post('/job', body)
        return 0
    if cmd == 'notify' and rest:
        post('/notify', {'text': ' '.join(rest)[:500]})
        return 0
    print(__doc__.strip(), file=sys.stderr)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
