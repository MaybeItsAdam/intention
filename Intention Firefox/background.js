try {
  importScripts('providers.js', 'prompts.js', 'tracking.js');
} catch (e) {
  // Firefox loads these via manifest scripts array; globals already present.
}

const GRANTS_DAILY_CAP = 3;

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { activeSessions = {}, chatHistories = {} } = await getStorage(['activeSessions', 'chatHistories']);
  const session = activeSessions[tabId];
  if (session) {
    const elapsed = (Date.now() - session.startTime) / 60000;
    await recordSessionMinutes(session.domain, Math.min(elapsed, session.intervalMinutes));
    delete activeSessions[tabId];
    await setStorage({ activeSessions });
  }
  if (chatHistories[String(tabId)]) {
    delete chatHistories[String(tabId)];
    await setStorage({ chatHistories });
  }
  chrome.alarms.clear(`checkin-${tabId}`);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('checkin-')) return;
  const tabId = parseInt(alarm.name.replace('checkin-', ''), 10);
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'showCheckin' });
  } catch (e) {
    const { activeSessions = {} } = await getStorage(['activeSessions']);
    if (activeSessions[tabId]) {
      delete activeSessions[tabId];
      await setStorage({ activeSessions });
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch(err => sendResponse({ error: String(err?.message || err) }));
  return true;
});

async function handleMessage(message, sender) {
  const tabId = sender.tab?.id;
  switch (message.action) {
    case 'getConfig': return getFullConfig();
    case 'saveSetup': return saveSetup(message.config);
    case 'saveSettings': return saveSettings(message.config);
    case 'getSession': {
      if (tabId == null) return { session: null };
      const { activeSessions = {} } = await getStorage(['activeSessions']);
      return { session: activeSessions[tabId] || null };
    }
    case 'chat':
      return handleChat({ tabId, mode: message.mode, domain: message.domain, userMessage: message.userMessage });
    case 'clearChatHistory':
      return clearChatHistory(message.historyKey || (tabId != null ? String(tabId) : null));
    case 'endSession':
      return endSession({ tabId, reason: message.reason });
    case 'getStatsForDomain':
      return getStatsForDomain(message.domain);
    case 'getStatsSummary':
      return getStatsSummary();
    case 'openOptions':
      chrome.runtime.openOptionsPage();
      return { ok: true };
    default:
      throw new Error('Unknown action: ' + message.action);
  }
}

async function getFullConfig() {
  const keys = ['provider', 'apiKey', 'model', 'userContext', 'blockedDomains', 'setupComplete'];
  const stored = await getStorage(keys);
  return {
    setupComplete: !!stored.setupComplete,
    provider: stored.provider || '',
    apiKey: stored.apiKey || '',
    model: stored.model || '',
    userContext: stored.userContext || '',
    blockedDomains: stored.blockedDomains || [],
    providers: PROVIDERS,
    grantsCap: GRANTS_DAILY_CAP
  };
}

async function saveSetup({ provider, apiKey, model, userContext, blockedDomains }) {
  await setStorage({
    provider,
    apiKey,
    model: model || PROVIDERS[provider]?.defaultModel || '',
    userContext: userContext || '',
    blockedDomains: blockedDomains || [],
    setupComplete: true
  });
  return { ok: true };
}

async function saveSettings(partial) {
  await setStorage(partial);
  return { ok: true };
}

async function handleChat({ tabId, mode, domain, userMessage }) {
  const { provider, apiKey, model, userContext } = await getStorage(['provider', 'apiKey', 'model', 'userContext']);
  if (!provider || !apiKey) return { error: 'No API key configured. Open settings to finish setup.' };

  const historyKey = mode === 'context' ? 'context' : (tabId != null ? String(tabId) : null);
  if (!historyKey) return { error: 'No history context' };
  const { chatHistories = {} } = await getStorage(['chatHistories']);
  const history = chatHistories[historyKey] || [];

  let systemPrompt = '';
  let tools = [];

  if (mode === 'gate') {
    const stats = await getStatsForDomain(domain);
    systemPrompt = buildGateSystemPrompt({
      domain,
      userContext,
      grantsToday: stats.grantsToday,
      grantsCap: GRANTS_DAILY_CAP,
      minutesTodaySite: stats.minutesToday,
      minutesTodayAll: stats.minutesTodayAll,
      minutesWeekAll: stats.minutesWeekAll
    });
    tools = [GRANT_TOOL];
  } else if (mode === 'checkin') {
    const { activeSessions = {} } = await getStorage(['activeSessions']);
    const session = activeSessions[tabId] || {};
    const stats = await getStatsForDomain(domain);
    systemPrompt = buildCheckinSystemPrompt({
      domain,
      userContext,
      originalReason: session.reason,
      grantsToday: stats.grantsToday,
      grantsCap: GRANTS_DAILY_CAP,
      minutesTodaySite: stats.minutesToday,
      minutesTodayAll: stats.minutesTodayAll
    });
    tools = [GRANT_TOOL];
  } else if (mode === 'context') {
    systemPrompt = buildContextSystemPrompt({ currentContext: userContext });
    tools = [UPDATE_CONTEXT_TOOL];
  } else {
    return { error: `Unknown chat mode: ${mode}` };
  }

  if (userMessage) history.push({ role: 'user', content: userMessage });
  if (history.length === 0) history.push({ role: 'user', content: '(user just opened the conversation)' });

  let llmResponse;
  try {
    llmResponse = await callLLM({ provider, apiKey, model, system: systemPrompt, messages: history, tools });
  } catch (e) {
    return { error: e.message };
  }

  let grantedSession = null;
  let contextUpdated = null;
  let appendedNote = '';

  for (const tc of llmResponse.toolCalls || []) {
    if (tc.name === 'grant_access' && (mode === 'gate' || mode === 'checkin')) {
      const stats = await getStatsForDomain(domain);
      if (stats.grantsToday >= GRANTS_DAILY_CAP) {
        appendedNote = `\n\n_(Intention: daily grant cap reached — no more time can be granted today, but I'm still here to talk.)_`;
        continue;
      }
      const minutes = Math.max(1, Math.min(60, Math.round(Number(tc.input.minutes) || 0)));
      const reason = String(tc.input.reason || '').slice(0, 240);
      await recordGrant(domain, minutes, reason);
      const { activeSessions = {} } = await getStorage(['activeSessions']);
      activeSessions[tabId] = { domain, reason, intervalMinutes: minutes, startTime: Date.now() };
      await setStorage({ activeSessions });
      chrome.alarms.create(`checkin-${tabId}`, { delayInMinutes: minutes });
      grantedSession = activeSessions[tabId];
    } else if (tc.name === 'update_context' && mode === 'context') {
      const newContext = String(tc.input.new_context || '').slice(0, 5000).trim();
      if (newContext) {
        await setStorage({ userContext: newContext });
        contextUpdated = { new_context: newContext, diff_summary: String(tc.input.diff_summary || '').slice(0, 240) };
      }
    }
  }

  const assistantText = (llmResponse.text || '') + appendedNote;
  history.push({ role: 'assistant', content: assistantText || '(…)' });
  chatHistories[historyKey] = history.slice(-40);
  await setStorage({ chatHistories });

  return { assistantText, grantedSession, contextUpdated };
}

async function clearChatHistory(historyKey) {
  if (!historyKey) return { ok: true };
  const { chatHistories = {} } = await getStorage(['chatHistories']);
  delete chatHistories[historyKey];
  await setStorage({ chatHistories });
  return { ok: true };
}

async function endSession({ tabId, reason }) {
  const { activeSessions = {}, chatHistories = {} } = await getStorage(['activeSessions', 'chatHistories']);
  const session = activeSessions[tabId];
  if (session) {
    const elapsed = (Date.now() - session.startTime) / 60000;
    await recordSessionMinutes(session.domain, Math.min(elapsed, session.intervalMinutes));
    delete activeSessions[tabId];
    await setStorage({ activeSessions });
  }
  if (tabId != null) {
    delete chatHistories[String(tabId)];
    await setStorage({ chatHistories });
    chrome.alarms.clear(`checkin-${tabId}`);
  }
  if (reason === 'fulfilled' && tabId != null) {
    try { chrome.tabs.remove(tabId); } catch (e) {}
  }
  return { ok: true };
}
