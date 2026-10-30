'use strict';
// The notes page (Ctrl+Alt+N): one quick note and a to-do list, saved on this PC as you type.

let notes = null, notesTimer = 0;

function notesPage() {
  if (!notes) return '<div class="hint">Opening your notes…</div>';
  const todos = notes.todos || [];
  const open = todos.filter(t => !t.done), done = todos.filter(t => t.done);
  const item = t => `<div class="todo${t.done ? ' done' : ''}"><input type="checkbox" data-todo="${esc(t.id)}"${t.done ? ' checked' : ''}>` +
    `<span>${esc(t.text)}</span><button class="icon-btn" data-todo-remove="${esc(t.id)}" title="Remove">${ICON.close}</button></div>`;
  return `<div class="section">To-do <span class="n">${open.length}</span>${done.length ? '<span class="link section-link" data-todo-clear>Clear done</span>' : ''}</div>` +
    `<div class="answer-row"><input class="field" data-draft="todo:new" placeholder="Add a to-do and press Enter"></div>` +
    open.map(item).join('') + done.map(item).join('') +
    `<div class="section">Note</div><textarea class="field note" rows="7" data-draft="note:text" placeholder="Anything you want to keep in mind…"></textarea>`;
}

function saveNotes() {
  clearTimeout(notesTimer);
  notesTimer = setTimeout(() => api.saveNotes(notes), 500);
}

ui.pages.notes = {
  label: 'Notes', tab: true, order: 4,
  render: notesPage,
  async opened() {
    notes = await api.notes();
    ui.drafts['note:text'] = notes.text || '';
    render();
    island.querySelector('[data-draft="todo:new"]')?.focus();
  },
  click(e) {
    const t = e.target;
    const rm = t.closest('[data-todo-remove]');
    if (rm) { notes.todos = notes.todos.filter(x => x.id !== rm.dataset.todoRemove); saveNotes(); render(); return true; }
    if (t.closest('[data-todo-clear]')) { notes.todos = notes.todos.filter(x => !x.done); saveNotes(); render(); return true; }
    return false;
  },
  change(e) {
    const box = e.target.closest?.('[data-todo]');
    if (!box) return false;
    const todo = notes.todos.find(x => x.id === box.dataset.todo);
    if (todo) { todo.done = box.checked; todo.doneAt = box.checked ? Date.now() : 0; saveNotes(); render(); }
    return true;
  },
  keydown(e) {
    if (e.target.dataset?.draft === 'todo:new' && e.key === 'Enter') {
      e.preventDefault();
      const text = String(ui.drafts['todo:new'] || '').trim();
      if (text) {
        notes.todos.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, done: false, at: Date.now() });
        ui.drafts['todo:new'] = '';
        saveNotes();
        render();
      }
      return true;
    }
    return false;
  },
};

ui.input.push(e => {
  if (e.target.dataset?.draft !== 'note:text' || !notes) return false;
  notes.text = e.target.value;
  saveNotes();
  return true;
});
