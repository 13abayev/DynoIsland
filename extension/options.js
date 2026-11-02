// The extension's popup: whether it is connected to Island, Connect (asks Island again), or a token pasted by hand.
const input = document.getElementById('token'), status = document.getElementById('status'), pairBtn = document.getElementById('pair');

async function showStatus() {
  const { token } = await chrome.storage.local.get('token');
  if (token && !input.value) input.value = token;
  const r = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  status.className = 'status ' + (r?.connected ? 'on' : 'off');
  status.textContent = r?.connected ? 'Connected to Island'
    : token ? 'Not connected: is Island running?'
    : r?.asking ? 'Waiting for you to allow it in Island…' : 'Not connected yet';
  pairBtn.style.display = r?.connected ? 'none' : '';
}

pairBtn.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'pair' }).catch(() => null);
  status.textContent = 'Asking Island…';
  setTimeout(showStatus, 1500);
});

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ token: input.value.trim() });
  status.textContent = 'Connecting…';
  setTimeout(showStatus, 1500);
});

showStatus();
setInterval(showStatus, 3000);
