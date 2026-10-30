// The extension's settings: the token that lets it talk to Island.
const input = document.getElementById('token'), status = document.getElementById('status');

async function showStatus() {
  const { token } = await chrome.storage.local.get('token');
  if (token && !input.value) input.value = token;
  const r = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  status.className = 'status ' + (r?.connected ? 'on' : 'off');
  status.textContent = r?.connected ? 'Connected to Island' : token ? 'Not connected: is Island running?' : 'Not connected yet';
}

document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ token: input.value.trim() });
  status.textContent = 'Connecting…';
  setTimeout(showStatus, 1500);
});

showStatus();
setInterval(showStatus, 3000);
