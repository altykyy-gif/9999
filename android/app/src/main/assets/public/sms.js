/**
 * sms.js
 * صفحة الرسائل النصية: قراءة الوارد، إرسال رسالة جديدة، حذف، والتنبيه عند
 * وصول رسالة جديدة (بمقارنة عدد الرسائل بين كل تحديث والذي يليه).
 */

import * as api from './api.js';
import { t } from './i18n.js';
import { notify } from './notifications.js';

let container = null;
let lastKnownCount = null;

export function render(el) {
  container = el;
  container.innerHTML = `
    <div class="card">
      <h3 class="card-title">${t('sms_compose')}</h3>
      <form data-form="compose">
        <label class="field">
          <span>${t('sms_recipient')}</span>
          <input type="tel" name="phone" placeholder="${t('sms_recipient_placeholder')}" required />
        </label>
        <label class="field">
          <span>${t('sms_message')}</span>
          <textarea name="content" rows="3" maxlength="480" placeholder="${t('sms_message_placeholder')}" required></textarea>
          <small class="hint"><span data-char-count>0</span>/480 ${t('sms_char_count')}</small>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn">${t('sms_send')}</button>
        </div>
        <p class="form-status" data-form-status></p>
      </form>
    </div>

    <div class="card">
      <h3 class="card-title">${t('sms_inbox')}</h3>
      <div class="sms-list" data-list="sms">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
      </div>
    </div>
  `;

  const textarea = container.querySelector('textarea[name="content"]');
  textarea.addEventListener('input', () => {
    container.querySelector('[data-char-count]').textContent = textarea.value.length;
  });
  container.querySelector('[data-form="compose"]').addEventListener('submit', onSend);

  refresh();
}

function setStatus(msg) {
  const el = container?.querySelector('[data-form-status]');
  if (el) el.textContent = msg;
}

async function onSend(e) {
  e.preventDefault();
  const form = e.target;
  const phone = form.elements.phone.value.trim();
  const content = form.elements.content.value.trim();
  if (!phone || !content) return;

  setStatus(t('sms_sending'));
  const res = await api.sendSms(phone, content);
  if (res === null) {
    setStatus(t('unsupported'));
  } else {
    setStatus(t('sms_sent'));
    form.reset();
    container.querySelector('[data-char-count]').textContent = '0';
    refresh();
  }
}

function smsRow(msg) {
  const phone = msg.Phone || msg.phone || t('not_available');
  const content = msg.Content || msg.content || '';
  const date = msg.Date || msg.date || '';
  const index = msg.Index ?? msg.index;
  return `
    <div class="sms-row" data-index="${index}">
      <div class="sms-meta">
        <span class="sms-phone">${phone}</span>
        <span class="sms-date">${date}</span>
      </div>
      <p class="sms-content">${escapeHtml(content)}</p>
      <button class="icon-btn sms-delete" data-delete="${index}" aria-label="${t('sms_delete')}">🗑</button>
    </div>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export async function refresh() {
  if (!container) return;
  const [list, count] = await Promise.all([api.getSmsList(1, 30, 1), api.getSmsCount()]);
  const listEl = container.querySelector('[data-list="sms"]');

  if (!list) {
    listEl.innerHTML = `<p class="empty-state">${t('unsupported')}</p>`;
    return;
  }
  if (list.length === 0) {
    listEl.innerHTML = `<p class="empty-state">${t('sms_no_messages')}</p>`;
  } else {
    listEl.innerHTML = list.map(smsRow).join('');
    listEl.querySelectorAll('[data-delete]').forEach((btn) => {
      btn.addEventListener('click', () => onDelete(btn.dataset.delete));
    });
  }

  const totalUnread = Number(count?.LocalUnread ?? count?.unread ?? NaN);
  if (Number.isFinite(totalUnread) && lastKnownCount !== null && totalUnread > lastKnownCount) {
    notify('alert_new_sms');
  }
  if (Number.isFinite(totalUnread)) lastKnownCount = totalUnread;
}

async function onDelete(index) {
  if (!window.confirm(t('sms_confirm_delete'))) return;
  await api.deleteSms(index);
  refresh();
}
