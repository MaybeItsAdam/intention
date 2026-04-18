const rootStyle = document.createElement('style');
rootStyle.textContent = 'html { display: none !important; }';
document.documentElement.appendChild(rootStyle);

let currentSession = null;
let matchedDomain = null;

chrome.storage.local.get(['blockedDomains', 'setupComplete'], (result) => {
  const domains = result.blockedDomains || [];
  const setupComplete = !!result.setupComplete;
  const host = window.location.hostname;

  matchedDomain = domains.find(d => host === d || host.endsWith('.' + d)) || null;

  if (!matchedDomain) {
    rootStyle.remove();
    return;
  }

  if (!setupComplete) {
    window.stop();
    ensureBody();
    document.body.innerHTML = '';
    renderSetupNeededUI();
    rootStyle.remove();
    return;
  }

  chrome.runtime.sendMessage({ action: 'getSession' }, (response) => {
    if (response && response.session) {
      currentSession = response.session;
      rootStyle.remove();
      setupInterruptionListener();
      renderStatusBadge(response.session);
    } else {
      window.stop();
      ensureBody();
      document.body.innerHTML = '';
      renderChatUI({ mode: 'gate', domain: matchedDomain });
      rootStyle.remove();
    }
  });
});

function ensureBody() {
  if (!document.body) {
    const body = document.createElement('body');
    document.documentElement.appendChild(body);
  }
}

function renderSetupNeededUI() {
  const root = document.createElement('div');
  root.id = 'intention-root';
  root.innerHTML = `
    <div class="int-container">
      <h1>Intention</h1>
      <p class="int-subtitle">Finish setup to enable your AI coach.</p>
      <button id="int-open-options">Open settings</button>
    </div>
  `;
  document.documentElement.appendChild(root);
  document.getElementById('int-open-options').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openOptions' });
  });
}

function renderChatUI({ mode, domain }) {
  if (document.getElementById('intention-root')) {
    document.getElementById('intention-root').remove();
  }
  const seed = mode === 'gate'
    ? `Hey. I see you've opened ${domain}. What's going on — what are you hoping to get out of it?`
    : `Time check. Your time on ${domain} is up. Did you get what you came for?`;

  const subtitle = mode === 'gate'
    ? `${domain} — let's check in before you go through`
    : `${domain} — your time is up`;

  const root = document.createElement('div');
  root.id = 'intention-root';
  root.innerHTML = `
    <div class="int-container int-chat">
      <h1>Intention</h1>
      <p class="int-subtitle">${subtitle}</p>
      <div class="int-messages" id="int-messages"></div>
      <div class="int-composer">
        <input type="text" id="int-input" placeholder="Type your reply..." autocomplete="off">
        <button id="int-send">Send</button>
      </div>
      <div class="int-close-row">
        <button id="int-close" class="int-secondary">Close tab</button>
      </div>
    </div>
  `;
  document.documentElement.appendChild(root);

  const messagesEl = document.getElementById('int-messages');
  const inputEl = document.getElementById('int-input');
  const sendBtn = document.getElementById('int-send');
  const closeBtn = document.getElementById('int-close');

  addMessage(messagesEl, 'assistant', seed);

  let sending = false;

  async function send() {
    const text = inputEl.value.trim();
    if (!text || sending) return;
    sending = true;
    addMessage(messagesEl, 'user', text);
    inputEl.value = '';
    const thinking = addMessage(messagesEl, 'assistant', '…', true);

    chrome.runtime.sendMessage({
      action: 'chat',
      mode,
      domain,
      userMessage: text
    }, (resp) => {
      sending = false;
      thinking.remove();
      if (!resp) {
        addMessage(messagesEl, 'assistant', '[no response — background worker may be offline]');
        return;
      }
      if (resp.error) {
        addMessage(messagesEl, 'assistant', `[error: ${resp.error}]`);
        return;
      }
      addMessage(messagesEl, 'assistant', resp.assistantText || '(no reply)');
      if (resp.grantedSession) {
        setTimeout(() => window.location.reload(), 1200);
      }
    });
  }

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  closeBtn.addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'endSession', reason: 'fulfilled' });
    window.close();
  });
  inputEl.focus();
}

function addMessage(container, role, text, isThinking) {
  const div = document.createElement('div');
  div.className = `int-msg int-msg-${role}` + (isThinking ? ' int-thinking' : '');
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function renderStatusBadge(session) {
  const badge = document.createElement('div');
  badge.id = 'intention-badge';
  const end = session.startTime + session.intervalMinutes * 60000;

  function update() {
    const remaining = Math.max(0, Math.round((end - Date.now()) / 60000));
    badge.textContent = `⏱ ${remaining}m · ${session.reason}`;
  }
  update();
  setInterval(update, 15000);
  document.documentElement.appendChild(badge);
}

function setupInterruptionListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'showCheckin') {
      if (!document.getElementById('intention-root')) {
        renderChatUI({ mode: 'checkin', domain: currentSession?.domain || matchedDomain || window.location.hostname });
      }
    }
  });
}
