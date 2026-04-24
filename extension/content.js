// Content script — Auto Answer AI
// Message listener always registers on each inject
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[AutoAnswer] 📩 Message:', request.action);
    if (request.action === 'scan') {
        if (window.__aaRunning) {
            console.log('[AutoAnswer] Already running.');
        } else if (window.__aaRun) {
            window.__aaRun(request.apiKey, request.model);
        }
        sendResponse({ ok: true });
        return true;
    }
});

// Only initialize functions once
if (!window.__aaLoaded) {
    window.__aaLoaded = true;
    window.__aaRunning = false;

    console.log('[AutoAnswer] ✅ Initialized on:', window.location.href);

    // ============ MAIN ============
    window.__aaRun = async function(apiKey, model) {
        window.__aaRunning = true;
        console.log('[AutoAnswer] 🚀 Model:', model);
        showOverlay('🔍 Scanning questions...');

        try {
            const questions = detectQuestions();
            console.log('[AutoAnswer] 🔎 Found:', questions.length, questions);

            if (questions.length === 0) {
                updateOverlay('❌ No questions found on this page.', 'error');
                setTimeout(() => hideOverlay(), 3000);
                window.__aaRunning = false;
                return;
            }

            updateOverlay(`📝 Found ${questions.length} question(s). Asking AI...`, 'info');

            const prompt = buildPrompt(questions);
            console.log('[AutoAnswer] 📤 Prompt:\n', prompt);

            const response = await chrome.runtime.sendMessage({
                action: 'askGemini', prompt, apiKey, model
            });
            console.log('[AutoAnswer] 📥 Response:', response);

            if (!response.success) {
                updateOverlay('❌ API Error: ' + response.error, 'error');
                setTimeout(() => hideOverlay(), 8000);
                window.__aaRunning = false;
                return;
            }

            const answers = parseAnswers(response.answer);
            console.log('[AutoAnswer] 🧠 Answers:', answers);

            let applied = 0;
            for (const ans of answers) {
                const q = questions[ans.questionIndex];
                if (q && selectAnswer(q, ans.letter)) applied++;
            }

            updateOverlay(`✅ Done! ${applied}/${questions.length} answered.`, 'success', answers, questions);

        } catch (err) {
            console.error('[AutoAnswer] ❌', err);
            updateOverlay('❌ Error: ' + err.message, 'error');
            setTimeout(() => hideOverlay(), 5000);
        }

        window.__aaRunning = false;
    };

    // ============ DETECT QUESTIONS ============
    function detectQuestions() {
        const questions = [];

        // Strategy 1: Radio buttons
        const radioGroups = {};
        document.querySelectorAll('input[type="radio"]').forEach(radio => {
            const name = radio.name || ('group_' + Array.from(document.querySelectorAll('input[type="radio"]')).indexOf(radio));
            if (!radioGroups[name]) radioGroups[name] = [];

            let labelText = '';
            if (radio.id) {
                const lbl = document.querySelector(`label[for="${radio.id}"]`);
                if (lbl) labelText = lbl.textContent.trim();
            }
            if (!labelText) {
                const lbl = radio.closest('label');
                if (lbl) labelText = lbl.textContent.trim();
            }
            if (!labelText && radio.nextElementSibling) labelText = radio.nextElementSibling.textContent.trim();
            if (!labelText) labelText = radio.value;

            radioGroups[name].push({ element: radio, text: labelText });
        });

        const letters = ['A','B','C','D','E','F','G','H'];
        Object.entries(radioGroups).forEach(([name, opts]) => {
            if (opts.length < 2) return;
            const container = opts[0].element.closest('fieldset, .question-card, .question, [class*="question"], form > div, div');
            let qText = '';
            if (container) {
                const el = container.querySelector('.question-text, .question-title, h1, h2, h3, h4, p, legend');
                if (el) qText = el.textContent.trim();
            }
            questions.push({
                text: qText || '(Question not detected)',
                options: opts.map((o, i) => ({
                    letter: letters[i],
                    text: o.text,
                    element: o.element,
                    labelElement: o.element.closest('label') || document.querySelector(`label[for="${o.element.id}"]`)
                }))
            });
        });

        // Strategy 2: Clickable divs (test_quiz.html style)
        if (questions.length === 0) {
            document.querySelectorAll('.question-card, .question, [class*="question"]').forEach(card => {
                const qEl = card.querySelector('.question-text, p, h3, h4');
                const optEls = card.querySelectorAll('.option, [class*="option"], [class*="choice"]');
                if (qEl && optEls.length >= 2) {
                    questions.push({
                        text: qEl.textContent.trim(),
                        options: Array.from(optEls).map((el, i) => ({
                            letter: letters[i],
                            text: (el.querySelector('.option-text, span, p') || el).textContent.trim(),
                            element: el,
                            labelElement: el
                        }))
                    });
                }
            });
        }

        return questions;
    }

    // ============ BUILD PROMPT ============
    function buildPrompt(questions) {
        let p = `You are an expert test-taker. Answer ALL multiple choice questions below.

Respond EXACTLY in this format (one per line):
Q1: A
Q2: B
Q3: C
...

Then add:
---
EXPLANATIONS:
Q1: reason
Q2: reason
...

Questions:\n\n`;
        questions.forEach((q, i) => {
            p += `Q${i+1}: ${q.text}\n`;
            q.options.forEach(o => { p += `  ${o.letter}. ${o.text}\n`; });
            p += '\n';
        });
        return p;
    }

    // ============ PARSE ANSWERS ============
    function parseAnswers(text) {
        const answers = [];
        for (const line of text.split('\n')) {
            const m = line.match(/^Q(\d+)\s*[:.]\s*([A-Ha-h])/);
            if (m) answers.push({ questionIndex: parseInt(m[1]) - 1, letter: m[2].toUpperCase() });
        }
        const explPart = text.split(/---\s*\n?EXPLANATIONS?:/i)[1];
        if (explPart) {
            for (const line of explPart.split('\n')) {
                const m = line.match(/^Q(\d+)\s*[:.]\s*(.*)/);
                if (m) {
                    const a = answers.find(a => a.questionIndex === parseInt(m[1]) - 1);
                    if (a) a.explanation = m[2].trim();
                }
            }
        }
        return answers;
    }

    // ============ SELECT ANSWER ============
    function selectAnswer(q, letter) {
        const opt = q.options.find(o => o.letter === letter);
        if (!opt) return false;
        try {
            if (opt.element.tagName === 'INPUT') {
                opt.element.checked = true;
                opt.element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            (opt.labelElement || opt.element).click();
            const target = opt.labelElement || opt.element;
            target.style.outline = '3px solid #34d399';
            target.style.outlineOffset = '3px';
            return true;
        } catch (e) { return false; }
    }

    // ============ OVERLAY ============
    function showOverlay(msg) {
        let el = document.getElementById('__aaOverlay');
        if (!el) {
            el = document.createElement('div');
            el.id = '__aaOverlay';
            document.body.appendChild(el);
        }
        el.innerHTML = `
            <div class="aa-header"><span class="aa-logo">🧠 Auto Answer</span>
            <button class="aa-close" onclick="document.getElementById('__aaOverlay').remove()">✕</button></div>
            <div class="aa-body"><div class="aa-status"><div class="aa-spinner"></div><span>${msg}</span></div></div>`;
        el.style.display = 'block';
    }

    function updateOverlay(msg, type, answers, questions) {
        const el = document.getElementById('__aaOverlay');
        if (!el) return;
        let rows = '';
        if (answers && questions) {
            rows = '<div class="aa-answers">' + answers.map(a => {
                const q = questions[a.questionIndex];
                return `<div class="aa-answer-row">
                    <span class="aa-q-num">Q${a.questionIndex+1}</span>
                    <span class="aa-q-text">${(q?.text||'').substring(0,55)}...</span>
                    <span class="aa-ans-letter">${a.letter}</span>
                </div>${a.explanation ? `<div class="aa-explanation">${a.explanation}</div>` : ''}`;
            }).join('') + '</div>';
        }
        const cls = type === 'success' ? 'aa-success' : type === 'error' ? 'aa-error' : 'aa-info';
        el.innerHTML = `
            <div class="aa-header"><span class="aa-logo">🧠 Auto Answer</span>
            <button class="aa-close" onclick="document.getElementById('__aaOverlay').remove()">✕</button></div>
            <div class="aa-body"><div class="aa-status ${cls}"><span>${msg}</span></div>${rows}</div>`;
    }

    function hideOverlay() {
        const el = document.getElementById('__aaOverlay');
        if (el) el.remove();
    }

} // end __aaLoaded guard
