(() => {
    const EXT_ID = 'st_after_hours';
    const PROMPT_KEY = 'after_hours_core_v4';

    const DEFAULT_PROMPT = `You are AFTER HOURS, a compact universal roleplay state tracker.

At the beginning of every in-character response, output exactly one status block before the roleplay prose.

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
- Output exactly one <AFTERHOURS> block at the beginning of every in-character response. Continue normal roleplay prose after its closing tag.`;

    const defaultSettings = {
        enabled: true,
        openLatest: false,
        injectPrompt: false,
        promptDepth: 1,
        promptText: DEFAULT_PROMPT
    };

    function getSettings() {
        const ctx = SillyTavern.getContext();
        if (!ctx.extensionSettings[EXT_ID]) {
            ctx.extensionSettings[EXT_ID] = Object.assign({}, defaultSettings);
        }
        for (const k of Object.keys(defaultSettings)) {
            if (ctx.extensionSettings[EXT_ID][k] === undefined) {
                ctx.extensionSettings[EXT_ID][k] = defaultSettings[k];
            }
        }
        return ctx.extensionSettings[EXT_ID];
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
        const sections = parseAfterHours(rawInner);
        const mainSections = sections.filter(s => s.type !== 'private');
        const privateSections = sections.filter(s => s.type === 'private');

        let bodyHtml = '';

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
                    <span>🔒 PRIVATE ACCESS</span>
                    <span class="ah-chevron">⌄</span>
                </summary>
                <div class="ah-private-body">${privCards}</div>
            </details>`;
        }

        return `<details class="ah-root"${isOpen ? ' open' : ''}>
            <summary class="ah-summary">
                <span>☾ AFTER HOURS</span>
                <span class="ah-status-right">STATUS <span class="ah-chevron">⌄</span></span>
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
            const cleanProse = rawMes.replace(/<AFTERHOURS>[\s\S]*?<\/AFTERHOURS>\s*/i, '');
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
            ctx.setExtensionPrompt(
                PROMPT_KEY,
                settings.promptText.trim(),
                1,
                Number(settings.promptDepth) || 1
            );
        } else {
            ctx.setExtensionPrompt(PROMPT_KEY, '', 1, 1);
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
                <hr>
                <label class="checkbox_label">
                    <input id="ah_inject_prompt" type="checkbox" ${settings.injectPrompt ? 'checked' : ''}>
                    <span>Авто-инжект промпта AFTER HOURS</span>
                </label>
                <div style="margin-top:6px;">
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
        document.getElementById('ah_inject_prompt')?.addEventListener('change', (e) => {
            settings.injectPrompt = e.target.checked;
            ctx.saveSettingsDebounced?.();
            syncExtensionPrompt();
        });
        document.getElementById('ah_prompt_depth')?.addEventListener('change', (e) => {
            settings.promptDepth = Number(e.target.value) || 1;
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
