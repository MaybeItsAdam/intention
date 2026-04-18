function sendBg(msg) {
  return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve));
}

async function getConfig() {
  return sendBg({ action: 'getConfig' });
}

document.addEventListener('DOMContentLoaded', async () => {
  populateProviderDropdowns();
  const state = await getConfig();
  if (state?.setupComplete) showSettingsView(state);
  else showSetupView();
});

function populateProviderDropdowns() {
  for (const id of ['provider-select', 'provider-select-2']) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    sel.innerHTML = '';
    for (const [key, cfg] of Object.entries(PROVIDERS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = cfg.label;
      sel.appendChild(opt);
    }
  }
}

function showSetupView() {
  document.getElementById('setup-view').hidden = false;
  document.getElementById('settings-view').hidden = true;

  const providerSel = document.getElementById('provider-select');
  const modelInput = document.getElementById('model-input');
  const syncPlaceholder = () => {
    const p = PROVIDERS[providerSel.value];
    modelInput.placeholder = p ? p.modelPlaceholder : '';
  };
  providerSel.addEventListener('change', syncPlaceholder);
  syncPlaceholder();

  document.getElementById('save-setup-btn').addEventListener('click', async () => {
    const provider = providerSel.value;
    const apiKey = document.getElementById('api-key-input').value.trim();
    const model = modelInput.value.trim();
    const userContext = document.getElementById('context-input').value.trim();
    const raw = document.getElementById('domains-input').value.trim();
    const blockedDomains = raw.split(',')
      .map(d => d.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase())
      .filter(Boolean);

    if (!provider || !apiKey) {
      setStatus('setup-status', 'Choose a provider and enter an API key.');
      return;
    }
    await sendBg({
      action: 'saveSetup',
      config: { provider, apiKey, model, userContext, blockedDomains }
    });
    setStatus('setup-status', 'Saved. Reloading...', 'success');
    setTimeout(() => location.reload(), 600);
  });
}

async function showSettingsView(state) {
  document.getElementById('setup-view').hidden = true;
  document.getElementById('settings-view').hidden = false;

  document.getElementById('context-display').textContent =
    state.userContext || '(no context yet — talk to your coach to create one)';

  const provSel = document.getElementById('provider-select-2');
  const modelInput = document.getElementById('model-input-2');
  const keyInput = document.getElementById('api-key-input-2');
  provSel.value = state.provider || 'anthropic';
  modelInput.value = state.model || '';
  keyInput.value = state.apiKey || '';

  const syncPlaceholder = () => {
    const p = PROVIDERS[provSel.value];
    modelInput.placeholder = p ? p.modelPlaceholder : '';
  };
  provSel.addEventListener('change', syncPlaceholder);
  syncPlaceholder();

  document.getElementById('save-provider-btn').addEventListener('click', async () => {
    const provider = provSel.value;
    const model = modelInput.value.trim() || PROVIDERS[provider].defaultModel;
    const apiKey = keyInput.value.trim();
    await sendBg({ action: 'saveSettings', config: { provider, model, apiKey } });
    setStatus('provider-status', 'Saved.', 'success');
  });

  renderDomains(state.blockedDomains || []);
  document.getElementById('add-btn').addEventListener('click', addDomain);
  document.getElementById('domain-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addDomain();
  });

  const summary = await sendBg({ action: 'getStatsSummary' });
  renderStats(summary);

  document.getElementById('open-coach-btn').addEventListener('click', openCoachModal);
  document.getElementById('close-coach-btn').addEventListener('click', closeCoachModal);
}

async function addDomain() {
  const input = document.getElementById('domain-input');
  const raw = input.value.trim().toLowerCase();
  if (!raw) return;
  const domain = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const state = await getConfig();
  const domains = state.blockedDomains || [];
  if (!domains.includes(domain)) {
    domains.push(domain);
    await sendBg({ action: 'saveSettings', config: { blockedDomains: domains } });
    renderDomains(domains);
    input.value = '';
  }
}

async function removeDomain(d) {
  const state = await getConfig();
  const domains = (state.blockedDomains || []).filter(x => x !== d);
  await sendBg({ action: 'saveSettings', config: { blockedDomains: domains } });
  renderDomains(domains);
}

function renderDomains(domains) {
  const list = document.getElementById('domain-list');
  list.innerHTML = '';
  for (const d of domains) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = d;
    li.appendChild(span);
    const btn = document.createElement('button');
    btn.textContent = 'Remove';
    btn.className = 'delete-btn';
    btn.addEventListener('click', () => removeDomain(d));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function renderStats(summary) {
  const el = document.getElementById('stats-display');
  if (!summary || !summary.minutesToday) {
    el.innerHTML = '<p class="muted">No time on blocked sites yet today. Nice.</p>';
    return;
  }
  const perSite = Object.entries(summary.perSiteToday || {})
    .sort((a, b) => b[1] - a[1])
    .map(([d, m]) => `${d}: ${Math.round(m)}m`)
    .join(' · ');
  el.innerHTML = `
    <p><strong>${summary.minutesToday} min</strong> on blocked sites today.</p>
    <p class="muted">${perSite}</p>
    <p class="muted">Past 7 days: <strong>${summary.minutesWeek} min</strong>.</p>
  `;
}

let coachSending = false;

async function openCoachModal() {
  const modal = document.getElementById('coach-modal');
  modal.hidden = false;
  const messagesEl = document.getElementById('coach-messages');
  messagesEl.innerHTML = '';
  addCoachMsg('assistant', "Hey. What would you like me to know about you? Your work, goals, or what you'd like me to help you stay on top of — I'll save an updated version when we've covered enough.");

  const input = document.getElementById('coach-input');
  const send = document.getElementById('coach-send-btn');
  input.value = '';
  input.focus();

  const onSend = async () => {
    const text = input.value.trim();
    if (!text || coachSending) return;
    coachSending = true;
    addCoachMsg('user', text);
    input.value = '';
    const thinking = addCoachMsg('assistant', '…', true);
    const resp = await sendBg({ action: 'chat', mode: 'context', userMessage: text });
    coachSending = false;
    thinking.remove();
    if (!resp) {
      addCoachMsg('assistant', '[no response — background worker may be offline]');
      return;
    }
    if (resp.error) {
      addCoachMsg('assistant', `[error: ${resp.error}]`);
      return;
    }
    addCoachMsg('assistant', resp.assistantText || '(no reply)');
    if (resp.contextUpdated) {
      addCoachMsg('assistant', `(context saved — ${resp.contextUpdated.diff_summary || 'updated'})`, false, true);
      const state = await getConfig();
      document.getElementById('context-display').textContent = state.userContext || '';
    }
  };
  send.onclick = onSend;
  input.onkeydown = e => { if (e.key === 'Enter') onSend(); };
}

async function closeCoachModal() {
  document.getElementById('coach-modal').hidden = true;
  await sendBg({ action: 'clearChatHistory', historyKey: 'context' });
}

function addCoachMsg(role, text, isThinking, isSystem) {
  const messagesEl = document.getElementById('coach-messages');
  const div = document.createElement('div');
  div.className = `int-msg int-msg-${role}`
    + (isThinking ? ' int-thinking' : '')
    + (isSystem ? ' int-system' : '');
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

function setStatus(id, text, variant = '') {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = 'status ' + variant;
  if (text) setTimeout(() => { el.textContent = ''; el.className = 'status'; }, 3000);
}
