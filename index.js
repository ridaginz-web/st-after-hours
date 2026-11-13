(() => {
    const EXT_ID = 'st_after_hours';
    const PROMPT_KEY = 'after_hours_core_v4';
    const PROMPT_VERSION = 2;

    const DEFAULT_PROMPT = `[AFTER HOURS — MODULE SPECIFICATION]
You are AFTER HOURS, a compact universal roleplay state tracker.

CRITICAL ORDER OF EXECUTION:
1. If reasoning / Chain-of-Thought is active (e.g., <think>...</think> or numbered analysis steps like "1. Input & Anchor", "2. Database & Continuity", "3. Settings & Fixes", "4. Style & Modules"), you MUST complete all thinking steps and close </think> FIRST.
2. NEVER output <AFTERHOURS> before or inside your thinking block.
3. Immediately AFTER closing </think>, at the start of the visible roleplay message, output exactly one <AFTERHOURS> block, then continue with the roleplay prose.

<AFTERHOURS>
<div class="ah-section"><div class="ah-heading">📍 SCENE</div><div class="ah-body">Location: ...<br>Time: ...</div></div>
<div class="ah-section"><div class="ah-heading">👤 CHARACTERS</div><div class="ah-body">Name: ... | Action: ... | Emotion: ... | State: ...</div></div>
<div class="ah-section"><div class="ah-heading">♡ CONNECTION</div><div class="ah-body">Pair: ... ↔ ... | Dynamic: ...</div></div>
<div class="ah-section"><div class="ah-heading">⌛ TIMELINE</div><div class="ah-body">Recent significant events</div></div>
<div class="ah-section"><div class="ah-heading">♫ ATMOSPHERE</div><div class="ah-body">Mood: ... | Sound: ...</div></div>
<details class="ah-private"><summary>🔒 PRIVATE ACCESS</summary><div class="ah-body">Character: ... | Thoughts: ... | Desires: ...</div></details>
</AFTERHOURS>

RULES
- Adapt to any roleplay, characters, identities, and settings.
- Include only important characters and relevant current information.
- Never invent the user's character's actions, appearance, thoughts, emotions, intentions, dialogue, or physical state. Use only facts explicitly established by the user.
- Preserve continuity. Update only what changes.
- Never invent facts. Omit uncertain or irrelevant information.
- Keep the block compact, ideally 150–250 tokens or fewer.
- Timeline: maximum 3 significant recent events.
- Omit empty sections entirely. Never use placeholders or repeat unchanged information.
- PRIVATE contains relevant thoughts and desires of AI-controlled characters only. Never include the user's private thoughts.
- Use the exact HTML structure and class names shown above. Keep all HTML tags properly closed.
- Use <br> for line breaks. No Markdown, asterisks, backticks, or code fences inside the block.
- Do not add explanations or commentary inside the block.
- Output the <AFTERHOURS> block only after all thinking/reasoning steps are finished, right before the roleplay prose.`;

    const defaultSettings = {
        enabled: true,
        openLatest: false,
        theme: 'moonlight',
        injectPrompt: false,
        promptPosition: 0, // 0 = IN_PROMPT (System Prompt, как тоггл в пресете), 1 = IN_CHAT (на глубине Depth)
        promptDepth: 2,
        promptVersion: PROMPT_VERSION,
        promptText: DEFAULT_PROMPT
    };

    function getSettings() {
        const ctx = SillyTavern.getContext();
        if (!ctx.extensionSettings[EXT_ID]) {
            ctx.extensionSettings[EXT_ID] = Object.assign({}, defaultSettings);
        }
        const s = ctx.extensionSettings[EXT_ID];
        for (const k of Object.keys(defaultSettings)) {
            if (s[k] === undefined) {
                s[k] = defaultSettings[k];
            }
        }
        // Авто-обновление старого текста промпта до v2 (с защитой думалки)
        if ((s.promptVersion || 1) < PROMPT_VERSION) {
            s.promptText = DEFAULT_PROMPT;
            s.promptPosition = 0;
            s.promptVersion = PROMPT_VERSION;
        }
        return s;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function parsePipeFields(line) {
        const parts = line.split('|').map(s => s.trim()).filter(Boolean);
        const fields = {};
        const extras = [];
        for (const part of parts) {
            const idx = part.indexOf(':');
            if (idx !== -1) {
                const key = part.slice(0, idx).trim().toLowerCase();
                const val = part.slice(idx + 1).trim();
                fields[key] = val;
            } else {
                extras.push(part);
            }
        }
        return { fields, extras };
    }

    function pick(fields, keys) {
        for (const k of keys) {
            if (fields[k]) return fields[k];
        }
        return null;
    }

    function parseAfterHours(rawInner) {
        const cleaned = rawInner
            .replace(/«/g, '"')
            .replace(/»/g, '"')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/div>\s*<div[^>]*class=["']?ah-body["']?[^>]*>/gi, '\n')
            .replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi, '\n[PRIVATE]\n')
            .replace(/<details[^>]*class=["']?ah-private["']?[^>]*>/gi, '\n')
            .replace(/<\/?(div|details|span|p)[^>]*>/gi, '\n');

        const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const sections = [];
        let current = null;

        const matchers = [
            { type: 'scene', regex: /^(?:📍\s*)?(?:СЦЕНА|SCENE)$/i, title: '📍 СЦЕНА' },
            { type: 'characters', regex: /^(?:👤\s*)?(?:ПЕРСОНАЖИ|CHARACTERS)$/i, title: '👤 ПЕРСОНАЖИ' },
            { type: 'connection', regex: /^(?:[♡❤️🤍]\s*)?(?:СВЯЗЬ|СВЯЗИ|CONNECTION|CONNECTIONS)$/i, title: '♡ СВЯЗЬ' },
            { type: 'timeline', regex: /^(?:[⌛⏳]\s*)?(?:ТАЙМЛАЙН|ХРОНИКА|СОБЫТИЯ|TIMELINE)$/i, title: '⌛ ТАЙМЛАЙН' },
            { type: 'atmosphere', regex: /^(?:[♫♪🎵]\s*)?(?:АТМОСФЕРА|ATMOSPHERE)$/i, title: '♫ АТМОСФЕРА' },
            { type: 'private', regex: /^(?:\[PRIVATE\]|🔒\s*PRIVATE(?:\s*ACCESS)?|🔒\s*ПРИВАТ(?:НО)?)$/i, title: '🔒 PRIVATE ACCESS' }
        ];

        for (const line of lines) {
            const m = matchers.find(h => h.regex.test(line));
            if (m) {
                current = { type: m.type, title: m.title, lines: [] };
                sections.push(current);
            } else if (current) {
                current.lines.push(line);
            } else {
                current = { type: 'scene', title: '📍 СЦЕНА', lines: [line] };
                sections.push(current);
            }
        }
        return sections;
    }

    function buildAfterHoursHtml(rawInner, isOpen) {
        const settings = getSettings();
        const theme = settings.theme || 'moonlight';
        const sections = parseAfterHours(rawInner);
        const mainSections = sections.filter(s => s.type !== 'private');
        const privateSections = sections.filter(s => s.type === 'private');

        let bodyHtml = '';
        let timePreview = '';

        for (const sec of mainSections) {
            if (!sec.lines.length) continue;

            if (sec.type === 'scene' || sec.type === 'atmosphere') {
                let rowsHtml = '';
                for (const line of sec.lines) {
                    const subParts = line.includes('|') ? line.split('|').map(s => s.trim()) : [line];
                    for (const sub of subParts) {
                        const idx = sub.indexOf(':');
                        if (idx !== -1) {
                            const k = sub.slice(0, idx).trim();
                            const v = sub.slice(idx + 1).trim();
                            if (sec.type === 'scene' && /^(?:время|time)$/i.test(k) && v) {
                                const clockMatch = v.match(/\b\d{1,2}:\d{2}\b/);
                                timePreview = clockMatch ? clockMatch[0] : (v.length <= 18 ? v : v.slice(0, 16) + '…');
                            }
                            rowsHtml += `<div class="ah-kv-row"><span class="ah-kv-label">${escapeHtml(k)}</span><span class="ah-kv-val">${escapeHtml(v)}</span></div>`;
                        } else {
                            rowsHtml += `<div class="ah-kv-row"><span class="ah-kv-val">${escapeHtml(sub)}</span></div>`;
                        }
                    }
                }
                bodyHtml += `<div class="ah-section"><div class="ah-section-title">${sec.title}</div><div class="ah-card">${rowsHtml}</div></div>`;
            } else if (sec.type === 'characters') {
                let cardsHtml = '';
                for (const line of sec.lines) {
                    const { fields, extras } = parsePipeFields(line);
                    const name = pick(fields, ['имя', 'name', 'персонаж', 'character']) || extras[0] || 'Персонаж';
                    const action = pick(fields, ['действие', 'action', 'действия']);
                    const emotion = pick(fields, ['эмоция', 'эмоции', 'emotion', 'emotions', 'настроение']);
                    const state = pick(fields, ['состояние', 'state', 'status', 'вид']);

                    let pillsHtml = '';
                    if (emotion) pillsHtml += `<span class="ah-pill ah-pill-emotion">✦ ${escapeHtml(emotion)}</span>`;
                    if (state) pillsHtml += `<span class="ah-pill ah-pill-state">● ${escapeHtml(state)}</span>`;

                    cardsHtml += `<div class="ah-card">
                        <div class="ah-char-header"><span class="ah-char-name">${escapeHtml(name)}</span></div>
                        ${pillsHtml ? `<div class="ah-pills">${pillsHtml}</div>` : ''}
                        ${action ? `<div class="ah-char-action">${escapeHtml(action)}</div>` : ''}
                    </div>`;
                }
                bodyHtml += `<div class="ah-section"><div class="ah-section-title">${sec.title}</div>${cardsHtml}</div>`;
            } else if (sec.type === 'connection') {
                let connHtml = '';
                for (const line of sec.lines) {
                    const { fields, extras } = parsePipeFields(line);
                    const pair = pick(fields, ['пара', 'pair', 'связь', 'персонажи']);
                    const dyn = pick(fields, ['динамика', 'dynamic', 'статус', 'отношения']) || extras.join(' ');
                    connHtml += `<div class="ah-card">
                        ${pair ? `<div class="ah-pair-badge">${escapeHtml(pair)}</div>` : ''}
                        ${dyn ? `<div class="ah-conn-dynamic">${escapeHtml(dyn)}</div>` : `<div class="ah-conn-dynamic">${escapeHtml(line)}</div>`}
                    </div>`;
                }
                bodyHtml += `<div class="ah-section"><div class="ah-section-title">${sec.title}</div>${connHtml}</div>`;
            } else if (sec.type === 'timeline') {
                const items = sec.lines
                    .map(l => l.replace(/^[•\-–*]\s*/, ''))
                    .map(l => `<div class="ah-timeline-item">${escapeHtml(l)}</div>`)
                    .join('');
                bodyHtml += `<div class="ah-section"><div class="ah-section-title">${sec.title}</div><div class="ah-card"><div class="ah-timeline-list">${items}</div></div></div>`;
            }
        }

        for (const priv of privateSections) {
            if (!priv.lines.length) continue;
            let privCards = '';
            for (const line of priv.lines) {
                const { fields } = parsePipeFields(line);
                const name = pick(fields, ['персонаж', 'character', 'имя', 'name']);
                const thoughts = pick(fields, ['мысли', 'thoughts', 'думает']);
                const desires = pick(fields, ['желания', 'desires', 'цель', 'хочет', 'мотив']);

                if (name || thoughts || desires) {
                    privCards += `<div class="ah-card">
                        ${name ? `<div class="ah-char-name">${escapeHtml(name)}</div>` : ''}
                        ${thoughts ? `<div class="ah-secret-row"><span class="ah-secret-tag">💭 Мысли:</span>${escapeHtml(thoughts)}</div>` : ''}
                        ${desires ? `<div class="ah-secret-row"><span class="ah-secret-tag">🔥 Желания:</span>${escapeHtml(desires)}</div>` : ''}
                    </div>`;
                } else {
                    privCards += `<div class="ah-card"><div class="ah-secret-row">${escapeHtml(line)}</div></div>`;
                }
            }

            bodyHtml += `<details class="ah-private">
                <summary class="ah-private-summary">
                    <span><span class="ah-lock-closed">🔒</span><span class="ah-lock-open">🔓</span> PRIVATE ACCESS</span>
                    <span class="ah-chevron">⌄</span>
                </summary>
                <div class="ah-private-body">${privCards}</div>
            </details>`;
        }

        return `<details class="ah-root" data-ah-theme="${escapeHtml(theme)}"${isOpen ? ' open' : ''}>
            <summary class="ah-summary">
                <span class="ah-title-left"><span class="ah-moon">☾</span> AFTER HOURS</span>
                <span class="ah-status-right">
                    ${timePreview ? `<span class="ah-time-preview">${escapeHtml(timePreview)}</span>` : ''}
                    <span class="ah-pulse-dot"></span>
                    <span>STATUS</span>
                    <span class="ah-chevron">⌄</span>
                </span>
            </summary>
            <div class="ah-divider"></div>
            <div class="ah-content">${bodyHtml}</div>
        </details>`;
    }

    function processMessage(mesId) {
        const settings = getSettings();
        const ctx = SillyTavern.getContext();
        const id = Number(mesId);
        if (isNaN(id) || !ctx.chat || !ctx.chat[id]) return;

        const rawMes = String(ctx.chat[id].mes || '');
        const match = rawMes.match(/<AFTERHOURS>\s*([\s\S]*?)\s*<\/AFTERHOURS>\s*/i);
        const mesEl = document.querySelector(`.mes[mesid="${id}"] .mes_text`);
        if (!mesEl) return;

        // Если рендер выключен — мгновенно убираем инфоблок из сообщения, оставляя чистый текст поста
        if (!settings.enabled) {
            const existingRoot = mesEl.querySelector('.ah-root');
            if (existingRoot) {
                existingRoot.remove();
            }
            if (match && typeof ctx.messageFormatting === 'function') {
                const cleanProse = rawMes.replace(/<AFTERHOURS>[\s\S]*?<\/AFTERHOURS>\s*/i, '');
                const msg = ctx.chat[id];
                mesEl.innerHTML = ctx.messageFormatting(
                    cleanProse,
                    msg.name,
                    Boolean(msg.is_system),
                    Boolean(msg.is_user),
                    id
                );
            }
            return;
        }

        if (!match) return;

        const isLatest = id === ctx.chat.length - 1;
        const ahHtml = buildAfterHoursHtml(match[1], settings.openLatest && isLatest);

        if (typeof ctx.messageFormatting === 'function') {
            let cleanProse = rawMes
                .replace(/<AFTERHOURS>[\s\S]*?<\/AFTERHOURS>\s*/i, '')
                .replace(/<(?:think|thinking|thought)>[\s\S]*?<\/(?:think|thinking|thought)>\s*/gi, '')
                .replace(/(?:^|\n)\s*1\.\s*\*{0,2}Input\s*&\s*Anchor[\s\S]*?4\.\s*\*{0,2}Style\s*&\s*Modules[^\n]*(?:\r?\n)+/i, '\n');
            const msg = ctx.chat[id];
            const formattedProse = ctx.messageFormatting(
                cleanProse,
                msg.name,
                Boolean(msg.is_system),
                Boolean(msg.is_user),
                id
            );
            mesEl.innerHTML = ahHtml + formattedProse;
            return;
        }

        const existingRoot = mesEl.querySelector('.ah-root');
        if (existingRoot) {
            existingRoot.outerHTML = ahHtml;
            return;
        }
        const firstDetails = mesEl.querySelector('details');
        if (firstDetails && firstDetails.textContent.includes('AFTER HOURS')) {
            firstDetails.outerHTML = ahHtml;
            return;
        }
        mesEl.insertAdjacentHTML('afterbegin', ahHtml);
    }

    function processAllMessages() {
        document.querySelectorAll('.mes').forEach(el => {
            const id = el.getAttribute('mesid');
            if (id !== null) processMessage(id);
        });
    }

    function syncExtensionPrompt() {
        const ctx = SillyTavern.getContext();
        if (typeof ctx.setExtensionPrompt !== 'function') return;
        const settings = getSettings();
        if (settings.injectPrompt && settings.promptText.trim()) {
            const pos = Number(settings.promptPosition) === 1 ? 1 : 0; // 0 = IN_PROMPT, 1 = IN_CHAT
            const depth = Number(settings.promptDepth) || 2;
            ctx.setExtensionPrompt(
                PROMPT_KEY,
                settings.promptText.trim(),
                pos,
                depth
            );
        } else {
            ctx.setExtensionPrompt(PROMPT_KEY, '', 0, 0);
        }
    }

    function mountSettingsUi() {
        const container = document.getElementById('extensions_settings');
        if (!container || document.getElementById('ah_settings_block')) return;

        const settings = getSettings();
        const ctx = SillyTavern.getContext();

        const html = `
        <div id="ah_settings_block" class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>☾ AFTER HOURS — Core v4</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label" style="margin-top:8px;">
                    <input id="ah_enabled" type="checkbox" ${settings.enabled ? 'checked' : ''}>
                    <span>Включить Liquid Glass рендер</span>
                </label>
                <label class="checkbox_label" style="margin-top:6px;">
                    <input id="ah_open_latest" type="checkbox" ${settings.openLatest ? 'checked' : ''}>
                    <span>Раскрывать блок в последнем сообщении</span>
                </label>
                <div style="margin-top:8px;">
                    <small>Цветовая тема стекла: </small>
                    <select id="ah_theme_select" class="text_pole" style="margin-top:4px;width:100%;">
                        <option value="moonlight" ${(settings.theme || 'moonlight') === 'moonlight' ? 'selected' : ''}>❄️ Moonlight (Лунный лёд)</option>
                        <option value="crimson" ${settings.theme === 'crimson' ? 'selected' : ''}>🍷 Crimson Noir (Тёмный рубин)</option>
                        <option value="violet" ${settings.theme === 'violet' ? 'selected' : ''}>💜 Violet Afterglow (Ночной аметист)</option>
                        <option value="amber" ${settings.theme === 'amber' ? 'selected' : ''}>🍂 Amber Warmth (Тёплый янтарь)</option>
                        <option value="emerald" ${settings.theme === 'emerald' ? 'selected' : ''}>🌿 Emerald Mist (Изумрудный туман)</option>
                    </select>
                </div>
                <hr>
                <label class="checkbox_label">
                    <input id="ah_inject_prompt" type="checkbox" ${settings.injectPrompt ? 'checked' : ''}>
                    <span>Авто-инжект промпта AFTER HOURS</span>
                </label>
                <div style="margin-top:6px;">
                    <small>Позиция инжекта: </small>
                    <select id="ah_prompt_pos" class="text_pole" style="margin-top:4px;width:100%;">
                        <option value="0" ${Number(settings.promptPosition) === 0 ? 'selected' : ''}>В системном промпте (как тоггл пресета — не ломает думалку)</option>
                        <option value="1" ${Number(settings.promptPosition) === 1 ? 'selected' : ''}>В чате на глубине (In-Chat @ Depth)</option>
                    </select>
                </div>
                <div id="ah_depth_wrap" style="margin-top:6px;display:${Number(settings.promptPosition) === 1 ? 'block' : 'none'};">
                    <small>Глубина (Depth): </small>
                    <input id="ah_prompt_depth" class="text_pole" type="number" min="0" max="20" value="${settings.promptDepth}" style="width:70px;display:inline-block;">
                </div>
                <textarea id="ah_prompt_text" class="text_pole" rows="6" style="margin-top:8px;width:100%;font-size:12px;">${escapeHtml(settings.promptText)}</textarea>
            </div>
        </div>`;

        container.insertAdjacentHTML('beforeend', html);

        document.getElementById('ah_enabled')?.addEventListener('change', (e) => {
            settings.enabled = e.target.checked;
            ctx.saveSettingsDebounced?.();
            processAllMessages();
        });
        document.getElementById('ah_open_latest')?.addEventListener('change', (e) => {
            settings.openLatest = e.target.checked;
            ctx.saveSettingsDebounced?.();
            processAllMessages();
        });
        document.getElementById('ah_theme_select')?.addEventListener('change', (e) => {
            settings.theme = e.target.value || 'moonlight';
            ctx.saveSettingsDebounced?.();
            document.querySelectorAll('.ah-root').forEach(el => {
                el.setAttribute('data-ah-theme', settings.theme);
            });
        });
        document.getElementById('ah_inject_prompt')?.addEventListener('change', (e) => {
            settings.injectPrompt = e.target.checked;
            ctx.saveSettingsDebounced?.();
            syncExtensionPrompt();
        });
        document.getElementById('ah_prompt_pos')?.addEventListener('change', (e) => {
            settings.promptPosition = Number(e.target.value) || 0;
            const wrap = document.getElementById('ah_depth_wrap');
            if (wrap) wrap.style.display = settings.promptPosition === 1 ? 'block' : 'none';
            ctx.saveSettingsDebounced?.();
            syncExtensionPrompt();
        });
        document.getElementById('ah_prompt_depth')?.addEventListener('change', (e) => {
            settings.promptDepth = Number(e.target.value) || 2;
            ctx.saveSettingsDebounced?.();
            syncExtensionPrompt();
        });
        document.getElementById('ah_prompt_text')?.addEventListener('input', (e) => {
            settings.promptText = e.target.value;
            ctx.saveSettingsDebounced?.();
            syncExtensionPrompt();
        });
    }

    jQuery(() => {
        const ctx = SillyTavern.getContext();
        const { eventSource, event_types } = ctx;

        mountSettingsUi();
        syncExtensionPrompt();
        setTimeout(processAllMessages, 500);

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (id) => processMessage(id));
        eventSource.on(event_types.USER_MESSAGE_RENDERED, (id) => processMessage(id));
        eventSource.on(event_types.MESSAGE_UPDATED, (id) => processMessage(id));
        eventSource.on(event_types.MESSAGE_SWIPED, (id) => processMessage(id));
        eventSource.on(event_types.CHAT_CHANGED, () => {
            syncExtensionPrompt();
            setTimeout(processAllMessages, 150);
        });
    });
})();
