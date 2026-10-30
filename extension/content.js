// Island for ChatGPT and Claude: watches this chat tab and tells Island (through background.js) when an
// answer is being written, when it is done, and whether you are looking at this tab.
//
// "Writing" means: a visible stop button next to the box you type in (ChatGPT, Claude), or Claude's own
// streaming marker. The sites change their pages now and then, so this looks for as little as possible:
// a button only counts when you can actually see it (sites keep hidden ones around), and if nothing on the
// page changed for 2 minutes it no longer counts as writing. Each report says why ("why"), so a wrong state
// can be traced: Island keeps it with the session (see /debug/sessions).
(() => {
  const site = location.hostname.endsWith('claude.ai') ? 'claude' : 'chatgpt';
  const STOP_WORDS = /\bstop\b|остановить|стоп|durdur|dayandır/i; // English, Russian, Turkish, Azerbaijani
  const QUIET_AFTER = 2 * 60 * 1000;

  const MESSAGES = {
    chatgpt: {
      user: '[data-message-author-role="user"], article[data-turn="user"]',
      assistant: '[data-message-author-role="assistant"], article[data-turn="assistant"]',
    },
    claude: {
      user: '[data-testid="user-message"]',
      assistant: '[data-is-streaming], .font-claude-response, .font-claude-message',
    },
  }[site];

  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const css = getComputedStyle(el);
    return css.display !== 'none' && css.visibility !== 'hidden' && Number(css.opacity) > 0.05;
  };

  /** The box you type in, with the buttons around it (send, stop, voice …). */
  function composer() {
    const box = document.querySelector('#prompt-textarea, div[contenteditable="true"], textarea');
    return box ? box.closest('form') || box.closest('fieldset') || box.parentElement?.parentElement?.parentElement || null : null;
  }

  /** Why this tab is writing an answer right now, or '' when it is not. */
  function writing() {
    if (site === 'claude') {
      const streaming = document.querySelector('[data-is-streaming="true"]');
      if (streaming && visible(streaming)) return 'claude streaming marker';
    }
    const scope = composer() || document;
    for (const b of scope.querySelectorAll('button')) {
      const label = b.getAttribute('aria-label') || b.getAttribute('title') || '';
      const isStop = b.dataset.testid === 'stop-button' || STOP_WORDS.test(label);
      if (isStop && visible(b)) return `stop button "${label || b.dataset.testid}"`;
    }
    return '';
  }

  const lastText = selector => {
    const all = document.querySelectorAll(selector);
    const text = all.length ? all[all.length - 1].innerText || '' : '';
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
  };
  const title = () => document.title.replace(/\s*[-|–]\s*(ChatGPT|Claude)\s*$/i, '').replace(/^(ChatGPT|Claude)(:.*)?$/i, '').trim();

  let last = '', timer = 0, lastChange = Date.now();
  function report(force = false) {
    let why = writing();
    if (why && Date.now() - lastChange > QUIET_AFTER) why = ''; // nothing moved for minutes: not really writing
    const msg = {
      site,
      title: title(),
      url: location.href,
      generating: !!why,
      why,
      visible: document.visibilityState === 'visible' && document.hasFocus(),
      prompt: lastText(MESSAGES.user),
      reply: why ? '' : lastText(MESSAGES.assistant),
    };
    const key = [msg.title, msg.url, msg.generating, msg.visible, msg.prompt.length].join('|');
    if (!force && key === last) return;
    last = key;
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
  const soon = () => { clearTimeout(timer); timer = setTimeout(report, 400); };

  new MutationObserver(records => {
    // your own typing does not count as the page changing
    const box = composer();
    if (records.some(r => !box || !box.contains(r.target))) lastChange = Date.now();
    soon();
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['data-is-streaming', 'data-testid', 'aria-label', 'class', 'style', 'hidden'],
  });
  document.addEventListener('visibilitychange', () => report());
  window.addEventListener('focus', () => report());
  window.addEventListener('blur', () => report());
  setInterval(() => report(true), 15000); // a heartbeat, so Island knows the tab is still open
  report(true);
})();
