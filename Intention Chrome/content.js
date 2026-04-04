// Inject styles globally to hide everything immediately to prevent flashing
const rootStyle = document.createElement('style');
rootStyle.textContent = 'html { display: none !important; }';
document.documentElement.appendChild(rootStyle);

let currentSession = null;

chrome.storage.local.get(['blockedDomains', 'defaultInterval'], (result) => {
  const domains = result.blockedDomains || [];
  const defaultInterval = result.defaultInterval || 5;
  const currentHost = window.location.hostname;
  
  // Check if current host matches any blocked domain
  const isBlocked = domains.some(domain => 
    currentHost === domain || currentHost.endsWith('.' + domain)
  );

  if (isBlocked) {
    // Check if we have an active session for this tab
    chrome.runtime.sendMessage({ action: 'getSession' }, (response) => {
      if (response && response.session) {
        // Session exists and is active.
        currentSession = response.session;
        rootStyle.remove();
        setupInterruptionListener();
      } else {
        // No session. We need to block.
        // Stop page from loading any further media/scripts
        window.stop(); 
        
        // Ensure body exists before we replace things
        if (!document.body) {
           const body = document.createElement('body');
           document.documentElement.appendChild(body);
        }
        
        // Clear out the HTML entirely and render our UI
        document.body.innerHTML = '';
        renderBlockUI(defaultInterval);
        
        // Make HTML visible again so our UI shows
        rootStyle.remove();
      }
    });
  } else {
    // Not blocked
    rootStyle.remove();
  }
});

function renderBlockUI(defaultInterval) {
  const root = document.createElement('div');
  root.id = 'intention-root';
  
  root.innerHTML = `
    <div class="pw-container">
      <h1>Intention</h1>
      <p class="pw-subtitle">This site is on your mindful blocklist. Why are you visiting?</p>
      
      <input type="text" id="pw-reason" placeholder="I need to..." autocomplete="off">
      
      <div class="pw-input-group">
        <label for="pw-interval">Remind me in:</label>
        <input type="number" id="pw-interval" value="${defaultInterval}" min="1" style="margin-bottom:0;">
        <span style="color: #a0a5b1; font-size:14px;">mins</span>
      </div>
      
      <button id="pw-submit">Enter Site</button>
    </div>
  `;
  
  document.body.appendChild(root);
  
  // Load fonts for the shadow DOM / override
  const fontLink = document.createElement('link');
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
  fontLink.rel = 'stylesheet';
  document.head.appendChild(fontLink);

  const reasonInput = document.getElementById('pw-reason');
  const intervalInput = document.getElementById('pw-interval');
  const submitBtn = document.getElementById('pw-submit');
  
  reasonInput.focus();
  
  const submitLogic = () => {
    const reason = reasonInput.value.trim();
    const intervalMinutes = parseInt(intervalInput.value, 10);
    
    if (reason && intervalMinutes > 0) {
      chrome.runtime.sendMessage({ 
        action: 'startSession', 
        reason: reason, 
        intervalMinutes: intervalMinutes 
      }, (response) => {
        if (response.success) {
          // Reload the page to resume normal loading
          window.location.reload();
        }
      });
    } else {
      reasonInput.style.borderColor = '#ef4444';
      setTimeout(() => reasonInput.style.borderColor = '', 1000);
    }
  };

  submitBtn.addEventListener('click', submitLogic);
  reasonInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitLogic();
  });
}

function setupInterruptionListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'showInterruption') {
      showInterruptionUI();
      sendResponse({ received: true });
    }
  });
}

function showInterruptionUI() {
  // Check if UI already exists
  if (document.getElementById('intention-root')) return;

  const root = document.createElement('div');
  root.id = 'intention-root';
  
  const reasonText = currentSession ? currentSession.reason : 'your assigned purpose';

  root.innerHTML = `
    <div class="pw-container" style="animation: pw-fade-in 0.3s ease-out;">
      <h1>Time Check-in</h1>
      <p class="pw-subtitle">Have you fulfilled your intended purpose?</p>
      
      <div class="pw-reason-display">
        "${reasonText}"
      </div>
      
      <button id="pw-yes-btn">Yes, I'm done (Close Tab)</button>
      <button id="pw-no-btn" class="pw-secondary-btn">No, I need more time (Snooze)</button>
    </div>
  `;

  // We append this overlay to the existing page body
  document.documentElement.appendChild(root);

  document.getElementById('pw-yes-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'sessionFulfilled' });
    // Attempt to close tab from content script side if needed
    window.close();
  });

  document.getElementById('pw-no-btn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'snoozeSession' }, () => {
      root.remove();
    });
  });
}

// Add tiny keyframe animation
const style = document.createElement('style');
style.textContent = `
  @keyframes pw-fade-in {
    from { opacity: 0; transform: scale(0.95); }
    to { opacity: 1; transform: scale(1); }
  }
`;
document.head.appendChild(style);
