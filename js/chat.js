/* benduffey.com — Chat client
   - Multi-conversation, persisted to localStorage
   - Calls POST /api/chat (Cloudflare Worker) with full message history
   - Reads SSE response from Gemini, appends `text` deltas to current message
   - No external dependencies; markdown rendering is intentionally lightweight */
const Chat = (() => {
  const STORE_KEY = 'benduffey-chats';
  const ACTIVE_KEY = 'benduffey-active-chat';

  /** @type {{ id, title, createdAt, updatedAt, messages: {role, content, error?}[] }[]} */
  let conversations = [];
  let activeId = null;
  let inflight = null;       // AbortController for in-progress request

  // ─── Storage ─────────────────────────────────────────────────────────
  function _load() {
    try {
      conversations = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      activeId = localStorage.getItem(ACTIVE_KEY) || null;
    } catch {
      conversations = []; activeId = null;
    }
    if (!Array.isArray(conversations)) conversations = [];
  }
  function _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(conversations));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
      else localStorage.removeItem(ACTIVE_KEY);
    } catch {}
  }

  // ─── Conversation management ─────────────────────────────────────────
  function _uuid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }
  function _newConversation() {
    const c = { id: _uuid(), title: 'New chat', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    conversations.unshift(c);
    activeId = c.id;
    _save();
    return c;
  }
  function active() {
    if (!activeId) return null;
    return conversations.find((c) => c.id === activeId) || null;
  }
  function selectChat(id) {
    activeId = id;
    _save();
    _renderList();
    _renderMessages();
  }
  function newChat() {
    _abort();
    _newConversation();
    _renderList();
    _renderMessages();
    document.getElementById('prompt-input')?.focus();
  }
  function deleteChat(id) {
    conversations = conversations.filter((c) => c.id !== id);
    if (activeId === id) activeId = conversations[0]?.id || null;
    _save();
    _renderList();
    _renderMessages();
  }

  // ─── Rendering: sidebar list ─────────────────────────────────────────
  function _dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date(); today.setHours(0,0,0,0);
    const yest = new Date(today.getTime() - 86400000);
    const wk = new Date(today.getTime() - 7 * 86400000);
    if (d >= today) return 'Today';
    if (d >= yest) return 'Yesterday';
    if (d >= wk) return 'Previous 7 days';
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function _renderList() {
    const list = document.getElementById('chat-list');
    if (!list) return;
    if (conversations.length === 0) {
      list.innerHTML = '<div class="chat-item-day" style="text-align:center; padding:24px 8px;">No chats yet</div>';
      return;
    }
    let lastDay = null;
    list.innerHTML = conversations.map((c) => {
      const day = _dayLabel(c.updatedAt);
      const showDay = day !== lastDay;
      lastDay = day;
      return `${showDay ? `<div class="chat-item-day">${escapeHtml(day)}</div>` : ''}
        <div class="chat-item ${c.id === activeId ? 'is-active' : ''}" data-id="${c.id}" role="listitem">
          <div class="chat-item-row">
            <span class="chat-item-label">${escapeHtml(c.title || 'Untitled')}</span>
            <button class="chat-item-menu" data-action="delete" data-id="${c.id}" aria-label="Delete chat" title="Delete chat">
              <i class="fa-solid fa-ellipsis"></i>
            </button>
          </div>
        </div>`;
    }).join('');
  }

  // ─── Rendering: messages ─────────────────────────────────────────────
  const STARTERS = [
    { text: 'What does Ben do?',            icon: 'fa-solid fa-user' },
    { text: 'Tell me about NICE SPACESHIP', icon: 'fa-solid fa-rocket' },
    { text: 'How can I hire Ben?',          icon: 'fa-solid fa-briefcase' },
    { text: 'What can you do?',             icon: 'fa-solid fa-wand-magic-sparkles' },
  ];

  function _renderMessages() {
    const wrap = document.getElementById('messages');
    const titleEl = document.getElementById('chat-title');
    const greetingEl = document.getElementById('welcome-greeting');
    const chipsEl = document.getElementById('welcome-chips');
    const inputEl = document.getElementById('prompt-input');
    if (!wrap) return;
    const c = active();
    const isEmpty = !c || c.messages.length === 0;

    // Empty state centers the greeting + prompt box + chips; conversation
    // state drops the prompt box to the bottom and shows the message log.
    document.body.classList.toggle('chat-empty', isEmpty);
    if (titleEl) titleEl.textContent = isEmpty ? '' : c.title;
    if (inputEl) {
      inputEl.placeholder = isEmpty
        ? 'Ask me about Ben, NICE SPACESHIP, or anything…'
        : 'Reply to Computer…';
    }

    if (isEmpty) {
      if (greetingEl) greetingEl.textContent = _greeting();
      if (chipsEl) {
        chipsEl.innerHTML = STARTERS.map((s) =>
          `<button type="button" class="chip" data-prompt="${escapeHtml(s.text)}"><i class="${s.icon}"></i>${escapeHtml(s.text)}</button>`
        ).join('');
      }
      wrap.innerHTML = '';
      return;
    }

    wrap.innerHTML = `<div class="messages-inner">${c.messages.map(_renderMsg).join('')}</div>`;
    _scrollToBottom();
  }

  function _renderMsg(m, idx) {
    const role = m.role === 'user' ? 'You' : 'Computer';
    const cls = m.role === 'user' ? 'user' : 'assistant';
    const streaming = m._streaming ? 'is-streaming' : '';
    const errorBlock = m.error ? `<div class="message-error">${escapeHtml(m.error)}</div>` : '';
    return `
      <div class="message ${cls} ${streaming}" data-idx="${idx}">
        <span class="message-role">${role}</span>
        <div class="message-body">${markdown(m.content || '')}</div>
        ${errorBlock}
      </div>`;
  }

  function _scrollToBottom() {
    const wrap = document.getElementById('messages');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  function _greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // ─── Sending a message ───────────────────────────────────────────────
  async function send(text) {
    const trimmed = (text || '').trim();
    if (!trimmed || inflight) return;

    let c = active();
    if (!c) c = _newConversation();

    c.messages.push({ role: 'user', content: trimmed });
    if (c.messages.length === 1) {
      c.title = trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
    }
    c.updatedAt = Date.now();

    const asst = { role: 'assistant', content: '', _streaming: true };
    c.messages.push(asst);
    _save();
    _renderList();
    _renderMessages();

    inflight = new AbortController();
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: c.messages.slice(0, -1).map(({ role, content }) => ({ role, content })) }),
        signal: inflight.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // SSE: split on double newline; keep trailing partial in buffer
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const ev of events) {
          const dataLines = ev.split(/\r?\n/).filter((l) => l.startsWith('data: '));
          for (const line of dataLines) {
            const payload = line.slice(6);
            if (!payload || payload === '[DONE]') continue;
            try {
              const obj = JSON.parse(payload);
              const text = obj?.candidates?.[0]?.content?.parts?.[0]?.text || '';
              if (text) {
                asst.content += text;
                _appendStream(asst.content);
              }
            } catch { /* ignore malformed chunk */ }
          }
        }
      }
    } catch (err) {
      asst.error = err.name === 'AbortError' ? 'Cancelled.' : (err.message || 'Network error');
    } finally {
      asst._streaming = false;
      inflight = null;
      c.updatedAt = Date.now();
      _save();
      _renderMessages();
    }
  }

  function _appendStream(content) {
    const wrap = document.getElementById('messages');
    if (!wrap) return;
    const last = wrap.querySelector('.message.assistant.is-streaming .message-body');
    if (last) {
      last.innerHTML = markdown(content);
      _scrollToBottom();
    } else {
      _renderMessages();
    }
  }

  function _abort() {
    if (inflight) inflight.abort();
    inflight = null;
  }

  // ─── Tiny markdown renderer (paragraphs, code, bold, links, lists) ──
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  }
  function markdown(src) {
    let s = escapeHtml(src);
    // Code fences
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => `<pre><code>${code}</code></pre>`);
    // Inline code
    s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    // Bold
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // Auto-link bare URLs
    s = s.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    // Lists (very simple — leading "- " or "* " becomes <li>)
    s = s.replace(/(^|\n)([-*] .+(?:\n[-*] .+)*)/g, (_m, lead, block) => {
      const items = block.split(/\n/).map((l) => l.replace(/^[-*] /, '')).map((t) => `<li>${t}</li>`).join('');
      return `${lead}<ul>${items}</ul>`;
    });
    // Paragraphs (split on double newline)
    s = s.split(/\n{2,}/).map((p) => /^<(ul|ol|pre|h\d)/.test(p.trim()) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return s;
  }

  // ─── Public init ─────────────────────────────────────────────────────
  function init() {
    _load();
    _renderList();
    _renderMessages();

    // Sidebar list interactions
    document.getElementById('chat-list')?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-action="delete"]');
      if (del) {
        e.stopPropagation();
        if (confirm('Delete this chat?')) deleteChat(del.dataset.id);
        return;
      }
      const item = e.target.closest('.chat-item');
      if (item) selectChat(item.dataset.id);
    });

    document.getElementById('btn-new-chat')?.addEventListener('click', newChat);

    // Welcome starter chips
    document.getElementById('welcome-chips')?.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip) {
        const input = document.getElementById('prompt-input');
        if (input) {
          input.value = chip.dataset.prompt;
          input.dispatchEvent(new Event('input'));
        }
        send(chip.dataset.prompt);
      }
    });

    // Prompt form
    const form = document.getElementById('prompt-form');
    const input = document.getElementById('prompt-input');
    const sendBtn = document.getElementById('btn-send');

    function syncSendState() {
      const has = input && input.value.trim().length > 0;
      if (sendBtn) sendBtn.disabled = !has || !!inflight;
    }
    function autoGrow() {
      if (!input) return;
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 200) + 'px';
    }
    input?.addEventListener('input', () => { syncSendState(); autoGrow(); });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form?.requestSubmit();
      }
    });
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input?.value || '';
      if (!text.trim()) return;
      input.value = '';
      autoGrow();
      syncSendState();
      send(text);
    });

    syncSendState();
  }

  return { init, send, newChat, selectChat, deleteChat, active };
})();
