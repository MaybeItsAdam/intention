// Remove sessions for a specific tab when it's closed
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.get(['activeSessions'], (result) => {
    let sessions = result.activeSessions || {};
    if (sessions[tabId]) {
      delete sessions[tabId];
      chrome.storage.local.set({ activeSessions: sessions });
    }
  });
});

// Listener for alarms (the "interruptions")
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('checkin-')) {
    const tabId = parseInt(alarm.name.replace('checkin-', ''), 10);
    // Ping the content script in that tab to show the interruption UI
    chrome.tabs.sendMessage(tabId, { action: 'showInterruption' }, (response) => {
      if (chrome.runtime.lastError) {
        // Tab might be closed or navigated away, handled via tabs.onRemoved mostly
        console.log("Could not send interruption message to tab", tabId);
      }
    });
  }
});

// Listen for messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;
  if (!tabId) return;

  if (message.action === 'startSession') {
    const { reason, intervalMinutes } = message;
    
    // Store active session
    chrome.storage.local.get(['activeSessions'], (result) => {
      let sessions = result.activeSessions || {};
      sessions[tabId] = {
        reason: reason,
        intervalMinutes: intervalMinutes,
        startTime: Date.now()
      };
      
      chrome.storage.local.set({ activeSessions: sessions }, () => {
        // Create an alarm for the interruption
        chrome.alarms.create(`checkin-${tabId}`, { delayInMinutes: intervalMinutes });
        sendResponse({ success: true });
      });
    });
    return true; // async response
  }
  
  if (message.action === 'clearSession' || message.action === 'sessionFulfilled') {
    chrome.alarms.clear(`checkin-${tabId}`);
    chrome.storage.local.get(['activeSessions'], (result) => {
      let sessions = result.activeSessions || {};
      delete sessions[tabId];
      chrome.storage.local.set({ activeSessions: sessions }, () => {
        if (message.action === 'sessionFulfilled' && sender.tab) {
          // If fulfilled, we could close the tab or just let our content script reload it
          chrome.tabs.remove(tabId);
        }
      });
    });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'snoozeSession') {
    chrome.storage.local.get(['activeSessions'], (result) => {
      let sessions = result.activeSessions || {};
      if (sessions[tabId]) {
        // Snooze by recreating the alarm for the same interval
        chrome.alarms.create(`checkin-${tabId}`, { delayInMinutes: sessions[tabId].intervalMinutes });
        sendResponse({ success: true });
      }
    });
    return true;
  }

  if (message.action === 'getSession') {
     chrome.storage.local.get(['activeSessions'], (result) => {
        let sessions = result.activeSessions || {};
        sendResponse({ session: sessions[tabId] });
     });
     return true;
  }
});
