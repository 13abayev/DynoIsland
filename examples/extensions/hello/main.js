'use strict';
// An example agent extension (EXTENSIONS.md walks through it). Anything that can send an HTTP request can report a
// session to Island through it, from this PC:
//
//   POST http://127.0.0.1:47900/hook
//   headers  X-Island-Token: <the token file in Island's data folder>   X-Island-Agent: hello   X-Island-Src: win
//   body     { "id": "build-1", "state": "working", "text": "Compiling", "cwd": "C:\\code\\app" }
//
// state: working (text: what it does), needs (text: what it needs from you), done (text: how it went), error, end.

exports.activate = island => {
  let timer = null;

  /** What your request said, as Island's own session events. */
  function events(p) {
    const text = String(p.text || '');
    const event = {
      working: { type: 'working', doing: text || 'Working' },
      needs: { type: 'needs', ask: text || 'Needs you', again: true },
      done: { type: 'done', summary: text },
      error: { type: 'error', text },
      end: { type: 'end' },
    }[p.state];
    return { id: String(p.id || ''), cwd: String(p.cwd || ''), events: event ? [event] : [] };
  }

  return {
    agents: [{
      id: 'hello', name: 'Hello', color: '#7dd3fc',
      icon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 9V4.5a1 1 0 0 1 2 0V8M7 7.5v-4a1 1 0 0 1 2 0v4M9 7.5V5a1 1 0 0 1 2 0v4.5a4.5 4.5 0 0 1-8.2 2.6L1.6 10a1 1 0 0 1 1.6-1.2L5 10.5"/></svg>',
    }],
    hook: { events },
    // its own content in Settings → Sessions → Extensions: a line and a button
    ui: {
      blocks: () => [
        { type: 'text', text: 'Report your own sessions with **POST /hook** (its main.js shows how), or try one first.' },
        { type: 'buttons', items: [{ label: 'Show a test session', action: 'try' }] },
      ],
      actions: {
        try() {
          const meta = { src: 'win' };
          island.sessions.apply('hello', meta, { id: 'test', cwd: island.lib.os.homedir(), events: [{ type: 'prompt', text: 'Say hello' }, { type: 'working', doing: 'Waving' }] });
          clearTimeout(timer);
          timer = setTimeout(() => island.sessions.apply('hello', meta, { id: 'test', events: [{ type: 'done', summary: 'Hello from your own extension!' }] }), 4000);
          return { note: 'A Hello session is in the island now' };
        },
      },
    },
    // switched off or removed: what it started stops, and its session leaves the island
    deactivate() {
      clearTimeout(timer);
      island.sessions.remove(island.sessions.key('hello', 'test'));
    },
  };
};
