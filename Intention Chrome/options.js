document.addEventListener('DOMContentLoaded', () => {
  const domainInput = document.getElementById('domain-input');
  const addBtn = document.getElementById('add-btn');
  const domainList = document.getElementById('domain-list');
  const intervalInput = document.getElementById('interval-input');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const saveStatus = document.getElementById('save-status');

  // Load current settings
  chrome.storage.local.get(['blockedDomains', 'defaultInterval'], (result) => {
    const domains = result.blockedDomains || [];
    const interval = result.defaultInterval || 5;

    intervalInput.value = interval;
    renderDomains(domains);
  });

  addBtn.addEventListener('click', () => {
    handleAddDomain();
  });

  domainInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddDomain();
  });

  saveSettingsBtn.addEventListener('click', () => {
    const interval = parseInt(intervalInput.value, 10);
    if (interval > 0) {
      chrome.storage.local.set({ defaultInterval: interval }, () => {
        saveStatus.textContent = 'Settings saved!';
        setTimeout(() => { saveStatus.textContent = ''; }, 3000);
      });
    }
  });

  function handleAddDomain() {
    const rawDomain = domainInput.value.trim().toLowerCase();
    if (!rawDomain) return;

    // Clean up domain (remove http://, www., etc)
    let domain = rawDomain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

    if (domain) {
      chrome.storage.local.get(['blockedDomains'], (result) => {
        const domains = result.blockedDomains || [];
        if (!domains.includes(domain)) {
          domains.push(domain);
          chrome.storage.local.set({ blockedDomains: domains }, () => {
            renderDomains(domains);
            domainInput.value = '';
          });
        }
      });
    }
  }

  function removeDomain(domainToRemove) {
    chrome.storage.local.get(['blockedDomains'], (result) => {
      const domains = result.blockedDomains || [];
      const updatedDomains = domains.filter(d => d !== domainToRemove);
      chrome.storage.local.set({ blockedDomains: updatedDomains }, () => {
        renderDomains(updatedDomains);
      });
    });
  }

  function renderDomains(domains) {
    domainList.innerHTML = '';
    domains.forEach(domain => {
      const li = document.createElement('li');
      li.textContent = domain;
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Remove';
      deleteBtn.className = 'delete-btn';
      deleteBtn.addEventListener('click', () => removeDomain(domain));
      li.appendChild(deleteBtn);
      domainList.appendChild(li);
    });
  }
});
