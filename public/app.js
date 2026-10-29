import { markdown } from './markdown.js';

const $ = selector => document.querySelector(selector);
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const input = $('#message-input');
const messages = $('#messages');
const sendButton = $('#send-button');
let conversation = [];
let pending = false;
let started = 0;
let elapsedTimer;
let toastTimer;

function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3000);
}

async function copy(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const original = button.innerHTML;
    button.innerHTML = icon('check') + '<span>Copied</span>';
    setTimeout(() => { if (button.isConnected) button.innerHTML = original; }, 1700);
  } catch { toast('Select the text to copy it manually.'); }
}

function header() {
  return `<div class="assistant-header"><span class="assistant-avatar">${icon('spark')}</span><span class="assistant-name">Blaze</span><span class="assistant-label">AOSP ASSISTANT</span></div>`;
}

function messageElement(message) {
  const element = document.createElement('article');
  element.className = 'message message-' + message.role;
  if (message.role === 'user') {
    const bubble = document.createElement('div');
    bubble.className = 'user-bubble'; bubble.textContent = message.text;
    element.append(bubble); return element;
  }
  element.innerHTML = header();
  const content = document.createElement('div');
  content.className = 'message-content';
  if (message.role === 'error') {
    const box = document.createElement('div');
    box.className = 'error-box'; box.textContent = message.text;
    const retry = document.createElement('button');
    retry.className = 'retry-button'; retry.textContent = 'Try again'; retry.type = 'button'; retry.disabled = pending;
    retry.addEventListener('click', () => send(message.question, true));
    box.append(retry); content.append(box);
  } else {
    content.innerHTML = markdown(message.text);
    for (const button of content.querySelectorAll('.code-copy')) button.addEventListener('click', () => copy(button.closest('.code-block').querySelector('pre').textContent, button));
    if (Array.isArray(message.citations) && message.citations.length) {
      const details = document.createElement('details'); details.className = 'native-references';
      const summary = document.createElement('summary'); summary.textContent = 'Cited references';
      const list = document.createElement('ul');
      for (const citation of message.citations) {
        const item = document.createElement('li');
        if (typeof citation.url === 'string' && /^https?:\/\//i.test(citation.url)) {
          const link = document.createElement('a'); link.href = citation.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = citation.title;
          item.append(link);
        } else item.textContent = citation.title;
        list.append(item);
      }
      details.append(summary, list); content.append(details);
    }
  }
  element.append(content);
  if (message.role === 'assistant') {
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const button = document.createElement('button'); button.className = 'copy-answer'; button.type = 'button';
    button.innerHTML = icon('copy') + '<span>Copy answer</span>';
    button.addEventListener('click', () => copy(message.text, button));
    actions.append(button); element.append(actions);
  }
  return element;
}

function render() {
  const empty = conversation.length === 0;
  $('#welcome').hidden = !empty; messages.hidden = empty;
  messages.replaceChildren(...conversation.map(messageElement));
  if (pending) {
    const waiting = document.createElement('article'); waiting.className = 'message message-assistant';
    waiting.innerHTML = header() + '<div class="message-content pending-content" role="status"><span class="typing-dots" aria-hidden="true"><span></span><span></span><span></span></span><span>Finding your answer…</span><span class="elapsed" id="elapsed"></span></div>';
    messages.append(waiting);
  }
  updateInput(); updateElapsed();
  $('#new-chat').disabled = pending;
  requestAnimationFrame(() => { $('#chat-scroll').scrollTop = $('#chat-scroll').scrollHeight; });
}

function updateInput() {
  sendButton.disabled = pending || !input.value.trim();
  sendButton.classList.toggle('busy', pending);
  sendButton.setAttribute('aria-label', pending ? 'Waiting for answer' : 'Send message');
  input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 150) + 'px';
  $('#character-count').textContent = input.value.length > 3500 ? `${input.value.length}/4000` : '';
}

function updateElapsed() {
  const seconds = Math.floor((Date.now() - started) / 1000);
  if ($('#elapsed')) $('#elapsed').textContent = seconds > 2 ? `${seconds}s` : '';
}

async function send(question, retry = false) {
  const text = (question ?? input.value).trim();
  if (!text || pending) return;
  if (text.length > 4000) { toast('Please keep your question under 4,000 characters.'); return; }
  if (retry && conversation.at(-1)?.role === 'error') conversation.pop();
  else conversation.push({ role: 'user', text });
  input.value = ''; pending = true; started = Date.now();
  elapsedTimer = setInterval(updateElapsed, 1000); render();
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'The workflow could not complete the answer.');
    if (typeof body.answer !== 'string' || !body.answer.trim()) throw new Error('No answer was returned. Please check the workflow.');
    conversation.push({ role: 'assistant', text: body.answer, citations: body.citations });
  } catch (error) {
    conversation.push({ role: 'error', text: error.message === 'Failed to fetch' ? 'Could not reach the chat server. Check your connection and try again.' : error.message, question: text });
  } finally {
    clearInterval(elapsedTimer); pending = false; render(); input.focus({ preventScroll: true });
  }
}

$('#chat-form').addEventListener('submit', event => { event.preventDefault(); send(); });
input.addEventListener('input', updateInput);
input.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
});
$('#new-chat').addEventListener('click', () => { if (!pending) { conversation = []; input.value = ''; render(); input.focus(); } });
for (const suggestion of document.querySelectorAll('.suggestion')) suggestion.addEventListener('click', () => {
  if (!pending) { input.value = suggestion.dataset.question; updateInput(); input.focus(); }
});
render();
