const DEFAULT_API_KEY = 'AIzaSyBLv829idb6D2ij5r-1o7JSM9IBnsYpPc4';
const DEFAULT_MODEL = 'gemini-2.5-flash';

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('apiKey').value = DEFAULT_API_KEY;
    document.getElementById('model').value = DEFAULT_MODEL;
    chrome.storage.local.set({ apiKey: DEFAULT_API_KEY, model: DEFAULT_MODEL });

    chrome.storage.local.get(['apiKey', 'model'], (data) => {
        if (data.apiKey) document.getElementById('apiKey').value = data.apiKey;
        if (data.model) document.getElementById('model').value = data.model;
    });

    document.getElementById('apiKey').addEventListener('change', saveSettings);
    document.getElementById('model').addEventListener('change', saveSettings);
    document.getElementById('scanBtn').addEventListener('click', scan);
});

function saveSettings() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('model').value;
    chrome.storage.local.set({ apiKey, model });
}

async function scan() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const model = document.getElementById('model').value;

    if (!apiKey) {
        showStatus('Please enter your API key', 'error');
        return;
    }

    chrome.storage.local.set({ apiKey, model });

    const btn = document.getElementById('scanBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Injecting...';

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Step 1: Force inject the CSS
        await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content.css']
        });

        // Step 2: Force inject the JS
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content.js']
        });

        // Step 3: Small delay then send the scan command
        setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: 'scan', apiKey, model }, (response) => {
                if (chrome.runtime.lastError) {
                    showStatus('❌ Error: ' + chrome.runtime.lastError.message, 'error');
                } else {
                    showStatus('✅ Scanning! Check the page.', 'success');
                }
                btn.disabled = false;
                btn.textContent = '🔍 Scan & Answer';
            });
        }, 300);

    } catch (err) {
        showStatus('❌ ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = '🔍 Scan & Answer';
    }
}

function showStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = `status show ${type}`;
}
