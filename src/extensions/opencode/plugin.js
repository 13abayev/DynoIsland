// Island for OpenCode: tells the Island app on your Windows PC what your OpenCode sessions do, lets you allow or
// deny OpenCode's permission prompts from the island, and takes your reply to a finished session from there.
// Island put this file here (~/.config/opencode/plugins/island.js) when you connected this place; disconnecting it in
// Island removes it again. It talks to Island through ~/.island/hook.sh (Island's Linux kit), never to the internet.
// OpenCode keeps working as always: a permission prompt can still be answered in OpenCode while the island shows it.
// With ISLAND_DEBUG=1 it also writes the events OpenCode sends it to ~/.island/opencode-events.log.
import { appendFileSync } from 'fs';
import { homedir } from 'os';

const HOOK = ['bash', `${homedir()}/.island/hook.sh`, 'opencode'];
const DEBUG = process.env.ISLAND_DEBUG === '1';
const running = new Set(); // hooks still waiting for an answer: stopped when OpenCode quits

/** Runs Island's hook with this event on stdin; mode wait / reply: resolves what you answered in the island. */
async function send(event, mode = '') {
  let proc;
  try {
    proc = Bun.spawn([...HOOK, ...(mode ? [mode] : [])], { stdin: new Blob([JSON.stringify(event)]), stdout: 'pipe', stderr: 'ignore' });
    if (mode) { running.add(proc); proc.unref(); } // a wait never keeps OpenCode from quitting
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return out.trim();
  } catch {
    return '';
  } finally {
    running.delete(proc);
  }
}
process.on('exit', () => { for (const p of running) try { p.kill(); } catch {} });

const parse = text => { try { return text ? JSON.parse(text) : {}; } catch { return {}; } };

export const Island = async ({ client, directory }) => {
  const parentOf = new Map(); // a helper agent's session → the session it works for (shown as that one)
  const busy = new Set();
  const replyWait = new Set();
  const owner = id => parentOf.get(id) || id;
  const at = (id, kind, extra = {}) => ({ island_event: kind, session_id: owner(id), cwd: directory, ...extra });

  /** The last answer of a session's last turn (the island's "done" line), or '' when that turn gave none. */
  async function lastAnswer(id) {
    try {
      const r = await client.session.messages({ path: { id } });
      const messages = r?.data || [];
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.info?.role === 'user') break; // an older turn's answer is not this one's
        if (m.info?.role !== 'assistant') continue;
        const text = (m.parts || []).filter(p => p.type === 'text').map(p => p.text).join(' ').trim();
        if (text) return text.slice(0, 600);
      }
    } catch {}
    return '';
  }

  /** After a session finished: waits in the background for a reply you type in the island, and sends it on. */
  async function takeReply(id) {
    if (replyWait.has(id)) return;
    replyWait.add(id);
    try {
      const text = parse(await send(at(id, 'reply-wait'), 'reply')).reply;
      if (text) {
        const body = { parts: [{ type: 'text', text }] };
        await (client.session.promptAsync ? client.session.promptAsync({ path: { id }, body }) : client.session.prompt({ path: { id }, body }));
      }
    } catch {} finally {
      replyWait.delete(id);
    }
  }

  /** A permission prompt: shown in the island, and answered from there if you answer it there first. */
  async function permission(p) {
    const status = parse(await send(at(p.sessionID, 'permission', {
      permission: { id: p.id, type: p.permission, patterns: p.patterns || [], metadata: p.metadata || {} },
    }), 'wait')).status;
    if (status !== 'allow' && status !== 'deny') return; // answered in OpenCode, or nothing was answered
    try {
      await client.postSessionIdPermissionsPermissionId({ path: { id: p.sessionID, permissionID: p.id }, body: { response: status === 'allow' ? 'once' : 'reject' } });
    } catch {}
  }

  async function finished(id) {
    if (!busy.delete(id) || parentOf.has(id)) return; // a helper agent finishing is not its session finishing
    await send(at(id, 'idle', { summary: await lastAnswer(id) }));
    takeReply(id);
  }

  return {
    'chat.message': async (input, output) => {
      if (parentOf.has(input.sessionID)) return; // what the session asked its helper agent
      const text = (output?.parts || []).filter(p => p.type === 'text').map(p => p.text).join(' ');
      send(at(input.sessionID, 'prompt', { prompt: text }));
    },
    'tool.execute.before': async (input, output) => {
      send(at(input.sessionID, 'tool', { tool: input.tool, args: output?.args || {} }));
    },
    // OpenCode waits for no one here: whatever needs a while runs on its own
    event: async ({ event }) => {
      const p = event?.properties || {};
      if (DEBUG && !/delta|part\.updated|plugin\.added/.test(event.type)) {
        try { appendFileSync(`${homedir()}/.island/opencode-events.log`, JSON.stringify(event).slice(0, 2000) + '\n'); } catch {}
      }
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          if (p.info?.parentID) parentOf.set(p.info.id, p.info.parentID);
          break;
        case 'session.status':
          if (p.status?.type === 'busy' && !busy.has(p.sessionID)) {
            busy.add(p.sessionID);
            if (!parentOf.has(p.sessionID)) send(at(p.sessionID, 'busy'));
          } else if (p.status?.type === 'idle') finished(p.sessionID);
          break;
        case 'session.idle': finished(p.sessionID); break;
        case 'session.error':
          if (!parentOf.has(p.sessionID)) send(at(p.sessionID, 'error', { error: String(p.error?.data?.message || p.error?.name || '') }));
          break;
        case 'session.deleted':
          if (p.info?.id && !p.info.parentID) send(at(p.info.id, 'end'));
          break;
        case 'permission.asked': permission(p); break;
        case 'permission.replied': send(at(p.sessionID, 'replied')); break; // answered (here or in the island)
        case 'question.asked':
          send(at(p.sessionID, 'question', { question: String(p.questions?.[0]?.question || '') }));
          break;
        case 'question.replied':
        case 'question.rejected': send(at(p.sessionID, 'replied')); break;
      }
    },
  };
};
