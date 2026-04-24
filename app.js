// ============ STATE ============
let currentImage = null; // base64 string
let history = [];

// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
    // Auto-load from config.js if available
    if (typeof CONFIG !== 'undefined') {
        if (CONFIG.GEMINI_API_KEY && !localStorage.getItem('gemini_api_key')) {
            localStorage.setItem('gemini_api_key', CONFIG.GEMINI_API_KEY);
        }
        if (CONFIG.GEMINI_MODEL && !localStorage.getItem('gemini_model')) {
            localStorage.setItem('gemini_model', CONFIG.GEMINI_MODEL);
        }
    }

    // Load saved API key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) document.getElementById('apiKeyInput').value = savedKey;

    const savedModel = localStorage.getItem('gemini_model');
    if (savedModel) document.getElementById('modelSelect').value = savedModel;

    // Load history
    const savedHistory = localStorage.getItem('answer_history');
    if (savedHistory) {
        history = JSON.parse(savedHistory);
        renderHistory();
    }

    // If no API key, show settings
    if (!savedKey) toggleSettings();

    // Setup paste listener
    document.addEventListener('paste', handlePaste);

    // Setup drag & drop
    const dropZone = document.getElementById('dropZone');
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('image/')) {
            loadImageFile(file);
        }
    });

    // Click to upload
    dropZone.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files[0]) loadImageFile(e.target.files[0]);
        };
        input.click();
    });

    // Keyboard shortcut: Enter to submit in text mode
    document.getElementById('questionInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
            e.preventDefault();
            getAnswer();
        }
    });
});

// ============ TABS ============
function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    document.getElementById('tab' + capitalize(tab)).classList.add('active');
    document.getElementById('content' + capitalize(tab)).classList.add('active');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ============ IMAGE HANDLING ============
function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
        if (item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            loadImageFile(file);
            // Auto switch to image tab
            switchTab('image');
            break;
        }
    }
}

function loadImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64 = e.target.result;
        currentImage = base64;

        const preview = document.getElementById('previewImage');
        preview.src = base64;
        preview.style.display = 'block';

        document.getElementById('dropZoneInner').style.display = 'none';
        document.getElementById('dropZone').classList.add('has-image');
        document.getElementById('clearImageBtn').style.display = 'inline-block';
    };
    reader.readAsDataURL(file);
}

function clearImage() {
    currentImage = null;
    document.getElementById('previewImage').style.display = 'none';
    document.getElementById('previewImage').src = '';
    document.getElementById('dropZoneInner').style.display = 'block';
    document.getElementById('dropZone').classList.remove('has-image');
    document.getElementById('clearImageBtn').style.display = 'none';
}

// ============ SETTINGS ============
function toggleSettings() {
    document.getElementById('settingsModal').classList.toggle('show');
}

function saveSettings() {
    const key = document.getElementById('apiKeyInput').value.trim();
    const model = document.getElementById('modelSelect').value;

    if (key) localStorage.setItem('gemini_api_key', key);
    localStorage.setItem('gemini_model', model);
    toggleSettings();
}

// ============ GET ANSWER ============
async function getAnswer() {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        toggleSettings();
        return;
    }

    const model = localStorage.getItem('gemini_model') || 'gemini-2.0-flash';
    const isImageTab = document.getElementById('tabImage').classList.contains('active');
    const textInput = document.getElementById('questionInput').value.trim();

    // Validate input
    if (isImageTab && !currentImage) {
        alert('Please paste a screenshot first (Ctrl+V)');
        return;
    }
    if (!isImageTab && !textInput) {
        alert('Please enter a question');
        return;
    }

    // Show loading
    const btn = document.getElementById('answerBtn');
    const btnText = document.getElementById('btnText');
    const btnLoader = document.getElementById('btnLoader');
    btn.disabled = true;
    btnText.textContent = 'Thinking...';
    btnLoader.style.display = 'inline-block';

    try {
        const prompt = `You are an expert test-taker. Look at this multiple choice question and determine the CORRECT answer.

Rules:
- Identify the question and ALL answer options
- Analyze each option carefully
- Pick the BEST/CORRECT answer
- Be concise but clear

Format your response EXACTLY like this:
ANSWER: [letter only, e.g. A, B, C, or D]
EXPLANATION: [brief 1-3 sentence explanation of why this is correct]`;

        // Build request body
        const parts = [];
        parts.push({ text: prompt });

        if (isImageTab && currentImage) {
            // Extract base64 data and mime type
            const match = currentImage.match(/^data:(image\/\w+);base64,(.+)$/);
            if (match) {
                parts.push({
                    inline_data: {
                        mime_type: match[1],
                        data: match[2]
                    }
                });
            }
        } else {
            parts.push({ text: "\n\nQuestion:\n" + textInput });
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 500
                }
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || `API error ${response.status}`);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';

        // Parse answer
        const answerMatch = text.match(/ANSWER:\s*([A-Za-z])/i);
        const explanationMatch = text.match(/EXPLANATION:\s*([\s\S]*)/i);

        const letter = answerMatch ? answerMatch[1].toUpperCase() : '?';
        const explanation = explanationMatch ? explanationMatch[1].trim() : text;

        // Display answer
        displayAnswer(letter, explanation);

        // Add to history
        const questionPreview = isImageTab ? '📸 Screenshot question' : textInput.substring(0, 80);
        addToHistory(questionPreview, letter, explanation);

    } catch (err) {
        alert('Error: ' + err.message);
        console.error(err);
    } finally {
        btn.disabled = false;
        btnText.textContent = '🔍 Get Answer';
        btnLoader.style.display = 'none';
    }
}

// ============ DISPLAY ============
function displayAnswer(letter, explanation) {
    const section = document.getElementById('answerSection');
    section.style.display = 'block';

    document.getElementById('answerLetter').textContent = letter;
    document.getElementById('answerExplanation').textContent = explanation;

    // Scroll to answer
    section.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ============ HISTORY ============
function addToHistory(question, answer, explanation) {
    history.unshift({ question, answer, explanation, time: Date.now() });
    if (history.length > 50) history.pop();
    localStorage.setItem('answer_history', JSON.stringify(history));
    renderHistory();
}

function renderHistory() {
    if (history.length === 0) {
        document.getElementById('historySection').style.display = 'none';
        return;
    }

    document.getElementById('historySection').style.display = 'block';
    const list = document.getElementById('historyList');
    list.innerHTML = history.map((h, i) => `
        <div class="history-item" onclick="showHistoryAnswer(${i})">
            <span class="history-q">${escapeHtml(h.question)}</span>
            <span class="history-a">${escapeHtml(h.answer)}</span>
        </div>
    `).join('');
}

function showHistoryAnswer(index) {
    const h = history[index];
    displayAnswer(h.answer, h.explanation);
}

function clearHistory() {
    history = [];
    localStorage.removeItem('answer_history');
    renderHistory();
    document.getElementById('answerSection').style.display = 'none';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
