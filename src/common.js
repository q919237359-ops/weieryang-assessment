export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export { api } from './firebase-api.js';
export function formatTime(seconds) { const n = Math.max(0, Math.floor(Number(seconds)||0)); return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`; }
export function formatDate(iso) { if (!iso) return '—'; const d = new Date(iso); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}); }
export function toast(message, isError = false) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div'); el.className = `toast${isError?' toast-error':''}`; el.setAttribute('role','status'); el.textContent=message;
  document.body.appendChild(el); setTimeout(()=>el.remove(),4000);
}
