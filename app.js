(() => {
  'use strict';

  const { EXPENSE_CATEGORIES, INCOME_CATEGORIES } = HishabParser;
  const Store = HishabStore;

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const z2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate());
  const ym = (d) => d.getFullYear() + '-' + z2(d.getMonth() + 1);
  const uid = Store.uid;
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const PROFILES = [['personal', 'Personal'], ['professional', 'Professional']];
  const TABS = [['tx', 'Transactions'], ['dues', 'Dues & Debts'], ['budget', 'Budget'], ['goals', 'Savings'], ['insights', 'Insights'], ['settings', 'Settings']];

  const CAT = {
    Food: ['🍽️', '#f59e0b'], Groceries: ['🛒', '#84cc16'], Utilities: ['⚡', '#eab308'], Rent: ['🏠', '#a78bfa'],
    Transport: ['🚌', '#3b82f6'], Shopping: ['🛍️', '#f97316'], Health: ['💊', '#ef4444'], Education: ['📚', '#06b6d4'],
    Entertainment: ['🎬', '#ec4899'], Other: ['🧾', '#94a3b8'],
    Salary: ['💵', '#22c55e'], Business: ['💼', '#14b8a6'], Freelance: ['💻', '#8b5cf6'], Gift: ['🎁', '#f472b6'], 'Other income': ['💰', '#10b981']
  };
  const catInfo = (c) => CAT[c] || CAT.Other;

  const store = {
    get(k, d) { try { const v = localStorage.getItem('hk.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hk.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('hk.' + k); } catch (e) { /* ignore */ } }
  };

  // ---------- state ----------
  let session = store.get('session', null); // {mode:'sheets'|'local', url, token, email, sheets}
  let settings = Object.assign({ theme: 'dark', currency: '৳', review: true }, store.get('settings', {}));
  let profile = store.get('profile', 'personal');
  const data = {};
  const dirty = Object.assign({ personal: {}, professional: {} }, store.get('dirty', {})); // profile -> collection -> {id:1}
  const lastHash = store.get('hash', {});
  if (session && (session.mode === 'github' || (session.mode === 'sheets' && !session.token))) { session = null; store.del('session'); } // old builds
  let authMode = 'signin';
  PROFILES.forEach(([p]) => { data[p] = Object.assign(Store.emptyData(), store.get('data.' + p, {})); });

  let tab = 'tx';
  let scope = 'month';
  let month = ym(new Date());
  let q = '';
  let rowLimit = 150;
  let duesStatus = 'open';
  let duesDir = 'all';
  let insRange = 'month';
  let catMode = 'spent';
  let draft = null;
  let status = session && session.mode === 'sheets' ? 'sync' : 'local';
  let statusMsg = '';
  let lastSync = 0;
  let authFailed = false;
  let client = null;

  const D = () => data[profile];
  const live = (arr) => arr.filter((r) => !r.del);
  const persist = (p) => { store.set('data.' + p, data[p]); store.set('dirty', dirty); };
  const nowD = () => new Date();

  // ---------- money ----------
  const fmt = (n) => settings.currency + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const sgn = (n) => (n < 0 ? '-' : '+') + fmt(n);
  const short = (n) => (n >= 1e7 ? (n / 1e7).toFixed(1) + ' Cr' : n >= 1e5 ? (n / 1e5).toFixed(1) + ' L' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n)));
  const signed = (t) => (t.type === 'income' ? t.amount : -t.amount);
  const sum = (arr, type) => arr.filter((t) => t.type === type).reduce((a, t) => a + t.amount, 0);
  const monthLabel = (m) => MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
  const shiftMonth = (m, d) => ym(new Date(+m.slice(0, 4), +m.slice(5) - 1 + d, 1));
  const shortDate = (d) => { if (!d) return ''; const dt = new Date(d + 'T00:00:00'); return dt.getDate() + ' ' + MONTHS[dt.getMonth()].slice(0, 3); };
  function dayLabel(d) {
    const t = iso(nowD()); const y = nowD(); y.setDate(y.getDate() - 1);
    if (d === t) return 'Today'; if (d === iso(y)) return 'Yesterday';
    const dt = new Date(d + 'T00:00:00'); return dt.getDate() + ' ' + MONTHS[dt.getMonth()].slice(0, 3) + ', ' + DAYS[dt.getDay()];
  }

  // ---------- data ops ----------
  let pushTimer = null;
  const synced = () => !!session && session.mode === 'sheets';
  const hasPending = (p) => Store.COLLECTIONS.some((c) => Object.keys(dirty[p][c] || {}).length > 0);
  function markDirty(coll, id) { (dirty[profile][coll] = dirty[profile][coll] || {})[id] = 1; }
  function changed() {
    persist(profile);
    if (synced()) { setStatus('sync'); clearTimeout(pushTimer); pushTimer = setTimeout(() => runSync([profile]), 1200); }
  }
  function upsert(coll, rec) {
    rec.upd = Date.now(); const arr = D()[coll]; const i = arr.findIndex((x) => x.id === rec.id);
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    markDirty(coll, rec.id);
  }
  function removeRec(coll, id) { const r = D()[coll].find((x) => x.id === id); if (r) { r.del = 1; r.upd = Date.now(); markDirty(coll, id); } }
  function setBudget(cat, limit) {
    const id = 'b:' + cat; const r = D().budget.find((x) => x.id === id);
    if (limit > 0) upsert('budget', { id, category: cat, limit, del: 0 });
    else if (r) { r.del = 1; r.upd = Date.now(); markDirty('budget', id); }
  }

  // ---------- sync (Google Sheets through the Apps Script web app) ----------
  function setStatus(s, msg) {
    status = s; statusMsg = msg || '';
    const d = $('.dot'); if (d) { d.className = 'dot ' + s; d.title = statusText(); }
  }
  function statusText() {
    if (status === 'local') return 'This device only (not synced)';
    if (status === 'sync') return 'Syncing…';
    if (status === 'ok') return 'Synced' + (lastSync ? ' at ' + new Date(lastSync).toLocaleTimeString() : '');
    if (status === 'offline') return 'Offline. Will retry.';
    return statusMsg || 'Sync problem';
  }

  async function syncProfile(p) {
    const records = {}; const sent = {};
    Store.COLLECTIONS.forEach((c) => {
      Object.keys(dirty[p][c] || {}).forEach((id) => {
        const r = data[p][c].find((x) => x.id === id);
        if (!r) { delete dirty[p][c][id]; return; }
        (records[c] = records[c] || []).push(Store.toRow(c, r)); (sent[c] = sent[c] || {})[id] = r.upd;
      });
    });
    const res = await client.sync({ profile: p, schema: Store.schema(), records, h: lastHash[p] || '' });
    // what we sent is now on the server (or the server had something newer): stop tracking unless edited again meanwhile
    Store.COLLECTIONS.forEach((c) => Object.keys(sent[c] || {}).forEach((id) => {
      const cur = data[p][c].find((x) => x.id === id); if (!cur || cur.upd === sent[c][id]) delete dirty[p][c][id];
    }));
    if (res.data) {
      // the sheet is the source of truth; keep only local edits made after we sent
      const result = Store.emptyData();
      Store.COLLECTIONS.forEach((c) => (res.data[c] || []).forEach((row) => { const rec = Store.fromRow(c, row); if (rec) result[c].push(rec); }));
      Store.COLLECTIONS.forEach((c) => Object.keys(dirty[p][c] || {}).forEach((id) => {
        const l = data[p][c].find((x) => x.id === id); if (!l) return;
        const i = result[c].findIndex((x) => x.id === id);
        if (i < 0) result[c].push(l); else if (l.upd > result[c][i].upd) result[c][i] = l;
      }));
      data[p] = result;
    }
    lastHash[p] = res.h; store.set('hash', lastHash); persist(p);
  }

  let syncing = false; let again = null;
  async function runSync(ps) {
    if (!synced() || authFailed) return;
    if (syncing) { again = ps; return; }
    syncing = true; setStatus('sync');
    const before = JSON.stringify(data[profile]);
    try {
      client = client || HishabSheets.create(session);
      for (const p of ps) await syncProfile(p);
      lastSync = Date.now(); setStatus('ok');
    } catch (e) {
      if (e && e.status === 401) { authFailed = true; setStatus('err', 'Session expired'); render(); }
      else if (e instanceof TypeError) setStatus('offline');
      else setStatus('err', (e && e.message) || 'Sync problem');
    } finally {
      syncing = false;
      if (JSON.stringify(data[profile]) !== before) softRender();
      if (again) { const a = again; again = null; runSync(a); }
    }
  }
  function softRender() {
    if ($('#modal').classList.contains('open')) return;
    const ae = document.activeElement; if (ae && ae.closest && ae.closest('#app') && /INPUT|SELECT|TEXTAREA/.test(ae.tagName) && ae.id !== 'importFile') return;
    render();
  }

  // ---------- Excel / CSV ----------
  function saveBlob(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  function downloadExcel(p) {
    const bytes = Store.toBytes(XLSX, data[p]);
    saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'hisab-' + p + '.xlsx');
  }
  function downloadCsv() {
    const rows = ['Date,Type,Category,Description,Amount,Note'].concat(live(D().tx).slice().sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) =>
      [t.date, t.type, t.category, t.desc, t.amount, t.note].map((v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')));
    saveBlob(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }), 'hisab-' + profile + '.csv');
  }

  // ---------- ui helpers ----------
  let toastT;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2800);
  }
  function applyTheme() {
    const dark = settings.theme === 'dark' || (settings.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = dark ? '#0c1815' : '#f3f7f5';
  }

  function txRow(t) {
    const [ic, col] = catInfo(t.category);
    return `<button class="tx" data-act="edit" data-id="${esc(t.id)}">
      <div class="ico" style="background:${col}26">${ic}</div>
      <div class="mid"><b>${esc(t.desc)}</b><span>${esc(t.category)}${t.note ? ' · ' + esc(t.note) : ''}</span></div>
      <div class="val ${t.type === 'income' ? 'inc' : 'exp'}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</div></button>`;
  }

  // ---------- views ----------
  const API_URL = () => (window.HISAB_API_URL || '').trim();
  function loginView(err) {
    const signup = authMode === 'signup';
    const email = store.get('lastEmail', '');
    const url = (session && session.url) || store.get('lastUrl', '');
    return `<div class="login"><h1>Hisab Khata</h1>
      <p>${signup ? 'Create your account. Your data is saved in your own Google Sheets and stays in sync between phone and laptop.' : 'Sign in to open your Personal and Professional books on this device.'}</p>
      <form data-form="login" novalidate>
        ${API_URL() ? '' : `<div class="fieldrow"><label>Server URL (ends with /exec)</label><input class="field" id="l_url" value="${esc(url)}" placeholder="https://script.google.com/macros/s/.../exec" autocapitalize="off" autocomplete="off" spellcheck="false"></div>`}
        <div class="fieldrow"><label>Email</label><input class="field" id="l_email" type="email" value="${esc(email)}" placeholder="you@example.com" autocapitalize="off" autocomplete="username" spellcheck="false" inputmode="email"></div>
        <div class="fieldrow"><label>Password</label><input class="field" id="l_pass" type="password" placeholder="${signup ? 'At least 8 characters' : 'Your password'}" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>
        ${signup ? `<div class="fieldrow"><label>Confirm password</label><input class="field" id="l_pass2" type="password" placeholder="Type it again" autocomplete="new-password"></div>
        <div class="fieldrow"><label>Signup code (the SIGNUP_CODE you set in the script)</label><input class="field" id="l_code" type="password" autocomplete="off" placeholder="Signup code"></div>` : ''}
        <div class="btns"><button class="btn primary" id="l_btn">${signup ? 'Create account' : 'Sign in'}</button></div>
        <div class="err" id="l_err">${esc(err || '')}</div>
      </form>
      <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-start">
        <button class="link" style="color:var(--accent);font-weight:600" data-act="authmode">${signup ? 'I already have an account · Sign in' : 'New here? Create an account'}</button>
        <button class="link" style="color:var(--muted);font-weight:600" data-act="localmode">Use on this device only (no sync)</button>
      </div>
      ${API_URL() ? '' : '<ol class="steps"><b>One-time setup</b><li>Deploy <code>apps-script/Code.gs</code> as a Web app (see README), then paste its URL above. You can also put it in <code>config.js</code> so you never type it.</li></ol>'}</div>`;
  }

  function header() {
    return `<div class="top"><div class="head"><h1>Hisab Khata</h1><button class="dot ${status}" data-act="syncnow" aria-label="Sync status" title="${esc(statusText())}"></button><span class="sp"></span>
      <select class="profile" data-act="profile" aria-label="Profile">${PROFILES.map(([v, l]) => `<option value="${v}" ${profile === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="avatar ${synced() ? 'on' : ''}" data-act="account" aria-label="${synced() ? 'Account: ' + esc(session.email || '') : 'Sign in'}" title="${synced() ? esc(session.email || 'Account') : 'Sign in'}">${synced() ? esc(((session.email || '?').charAt(0) || '?').toUpperCase()) : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/></svg>'}</button></div>
      <div class="tabs">${TABS.map(([v, l]) => `<button class="tab ${tab === v ? 'on' : ''}" data-act="tab" data-v="${v}">${l}</button>`).join('')}</div></div>
      ${authFailed ? '<div class="banner"><span>Your session expired. Your changes are safe on this device.</span><button class="link" style="color:var(--expense);font-weight:700" data-act="relogin">Sign in again</button></div>' : ''}`;
  }

  // --- Transactions
  function scopeList() {
    const all = live(D().tx);
    if (scope === 'today') return all.filter((t) => t.date === iso(nowD()));
    if (scope === 'month') return all.filter((t) => t.date.startsWith(month));
    return all;
  }
  function txListHtml() {
    let list = scopeList();
    const s = q.trim().toLowerCase();
    if (s) list = list.filter((t) => (t.category + ' ' + t.desc + ' ' + (t.note || '') + ' ' + t.amount).toLowerCase().includes(s));
    list = list.slice().sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
    const shown = list.slice(0, rowLimit); const days = {};
    shown.forEach((t) => (days[t.date] = days[t.date] || []).push(t));
    const body = Object.keys(days).sort().reverse().map((d) => {
      const net = days[d].reduce((a, t) => a + signed(t), 0);
      return `<div class="day"><span>${esc(dayLabel(d))}</span><span class="${net < 0 ? 'exp' : 'inc'}">${sgn(net)}</span></div><div class="list">${days[d].map(txRow).join('')}</div>`;
    }).join('');
    return (body || '<div class="empty">Nothing here yet.</div>') + (list.length > rowLimit ? '<button class="more" data-act="more">Show more</button>' : '');
  }
  function viewTx() {
    const list = scopeList(); const inc = sum(list, 'income'); const exp = sum(list, 'expense'); const rem = inc - exp;
    const seg = (v, l) => `<button class="${scope === v ? 'on' : ''}" data-act="scope" data-v="${v}">${l}</button>`;
    const label = scope === 'month' ? monthLabel(month) : scope === 'today' ? dayLabel(iso(nowD())) + ', ' + shortDate(iso(nowD())) : 'All time';
    return `<div class="sumcard"><div class="seg">${seg('today', 'Today')}${seg('month', 'Month')}${seg('total', 'Total')}</div>
      <div class="mrow">${scope === 'month' ? '<button data-act="mprev" aria-label="Previous month">‹</button>' : '<span></span>'}<b>${esc(label)}</b>${scope === 'month' ? '<button data-act="mnext" aria-label="Next month">›</button>' : '<span></span>'}</div>
      <div class="cols"><div><small>Income</small><b>${fmt(inc)}</b></div><div><small>Expense</small><b>${fmt(exp)}</b></div><div><small>Remaining</small><b>${rem < 0 ? '-' : ''}${fmt(rem)}</b></div></div></div>
    <form class="quick" data-form="quick"><input id="quickInput" autocomplete="off" placeholder="Type it: lunch 250, rickshaw 60..." aria-label="Add entries"><button class="send" aria-label="Add">➜</button></form>
    <div class="hint">Bangla, English or Banglish: "ajke lunch 80 takar, wifi 500, salary pelam 80k"</div>
    <input class="search" id="search" placeholder="Search by category, note or name" value="${esc(q)}" autocomplete="off">
    <div id="txList">${txListHtml()}</div><button class="fab" data-act="add">+ Add</button>`;
  }

  // --- Dues & Debts
  const remaining = (d) => Math.max(0, d.amount - (d.paid || 0));
  function viewDues() {
    const all = live(D().dues);
    const open = all.filter((d) => remaining(d) > 0);
    const get = open.filter((d) => d.dir === 'get').reduce((a, d) => a + remaining(d), 0);
    const owe = open.filter((d) => d.dir === 'owe').reduce((a, d) => a + remaining(d), 0);
    let list = all.filter((d) => (duesStatus === 'all' ? true : duesStatus === 'open' ? remaining(d) > 0 : remaining(d) === 0));
    if (duesDir !== 'all') list = list.filter((d) => d.dir === duesDir);
    list.sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : 1));
    const today = iso(nowD());
    const chip = (k, v, l, cur) => `<button class="chip ${cur === v ? 'on' : ''}" data-act="${k}" data-v="${v}">${l}</button>`;
    const rows = list.map((d) => {
      const rem = remaining(d); const overdue = rem > 0 && d.due && d.due < today; const get = d.dir === 'get';
      return `<button class="tx ${rem === 0 ? 'done' : ''}" data-act="editdue" data-id="${esc(d.id)}">
        <div class="ico" style="background:${get ? '#22c55e' : '#ef4444'}26;color:${get ? 'var(--income)' : 'var(--expense)'}">${esc((d.person || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="mid"><b>${esc(d.person)}</b><span>${get ? "I'll get" : 'I owe'}${d.due ? ' · due ' + esc(shortDate(d.due)) : ''}${overdue ? ' · <span class="exp">overdue</span>' : ''}${d.note ? ' · ' + esc(d.note) : ''}</span></div>
        <div class="val ${get ? 'inc' : 'exp'}">${rem === 0 ? 'Settled' : fmt(rem)}${d.paid > 0 && rem > 0 ? `<small>of ${fmt(d.amount)}</small>` : ''}</div></button>`;
    }).join('');
    return `<div class="sumcard"><div class="cols cols2"><div><small>I'll get</small><b>${fmt(get)}</b></div><div><small>I owe</small><b>${fmt(owe)}</b></div></div>
      <div class="mrow" style="margin-bottom:0"><span>Net</span><b>${get - owe < 0 ? '-' : ''}${fmt(get - owe)}</b></div></div>
    <div class="chips">${chip('dstatus', 'open', 'Open', duesStatus)}${chip('dstatus', 'settled', 'Settled', duesStatus)}${chip('dstatus', 'all', 'All', duesStatus)}<span style="width:8px"></span>${chip('ddirf', 'all', 'Everyone', duesDir)}${chip('ddirf', 'get', "I'll get", duesDir)}${chip('ddirf', 'owe', 'I owe', duesDir)}</div>
    <div class="list" style="margin-top:8px">${rows || '<div class="empty">No dues here. Tap + Add to record money you will get or owe.</div>'}</div><button class="fab" data-act="adddue">+ Add</button>`;
  }

  // --- Budget
  function viewBudget() {
    const list = live(D().tx).filter((t) => t.date.startsWith(month) && t.type === 'expense');
    const spent = {}; list.forEach((t) => (spent[t.category] = (spent[t.category] || 0) + t.amount));
    const lim = {}; live(D().budget).forEach((b) => (lim[b.category] = b.limit));
    const budgeted = Object.keys(lim); const tl = budgeted.reduce((a, c) => a + lim[c], 0); const ts = budgeted.reduce((a, c) => a + (spent[c] || 0), 0);
    const cats = EXPENSE_CATEGORIES.slice().sort((a, b) => ((lim[b] ? 1 : 0) - (lim[a] ? 1 : 0)) || ((spent[b] || 0) - (spent[a] || 0)));
    const rows = cats.map((c) => {
      const [ic, col] = catInfo(c); const l = lim[c]; const s = spent[c] || 0; const pct = l ? s / l : 0;
      const bar = l ? `<div class="track"><i style="width:${Math.min(100, pct * 100)}%;background:${pct > 1 ? 'var(--expense)' : pct > 0.8 ? 'var(--warn)' : 'var(--income)'}"></i></div>` : '';
      return `<button class="tx" data-act="editbudget" data-v="${esc(c)}"><div class="ico" style="background:${col}26">${ic}</div>
        <div class="mid"><b>${esc(c)}</b><span>${l ? fmt(s) + ' of ' + fmt(l) + (pct > 1 ? ' · over by ' + fmt(s - l) : ' · ' + fmt(l - s) + ' left') : s ? fmt(s) + ' spent · tap to set a limit' : 'Tap to set a monthly limit'}</span>${bar}</div></button>`;
    }).join('');
    return `<div class="sumcard"><div class="mrow" style="margin-top:4px"><button data-act="mprev" aria-label="Previous month">‹</button><b>${monthLabel(month)}</b><button data-act="mnext" aria-label="Next month">›</button></div>
      <div class="cols"><div><small>Budget</small><b>${fmt(tl)}</b></div><div><small>Spent</small><b>${fmt(ts)}</b></div><div><small>Left</small><b>${ts > tl ? '-' : ''}${fmt(tl - ts)}</b></div></div></div>
    <div class="list" style="margin-top:12px">${rows}</div>`;
  }

  // --- Savings goals
  function viewGoals() {
    const goals = live(D().goals); const saved = goals.reduce((a, g) => a + g.saved, 0); const target = goals.reduce((a, g) => a + g.target, 0);
    const rows = goals.map((g) => {
      const pct = g.target > 0 ? Math.min(1, g.saved / g.target) : 0;
      return `<button class="tx" data-act="editgoal" data-id="${esc(g.id)}"><div class="ico" style="background:#22c55e26">🎯</div>
        <div class="mid"><b>${esc(g.name)}</b><span>${fmt(g.saved)} of ${fmt(g.target)} · ${Math.round(pct * 100)}%${g.deadline ? ' · by ' + esc(shortDate(g.deadline)) : ''}</span><div class="track"><i style="width:${pct * 100}%;background:var(--income)"></i></div></div></button>`;
    }).join('');
    return `<div class="sumcard"><div class="cols cols2"><div><small>Saved</small><b>${fmt(saved)}</b></div><div><small>Goal total</small><b>${fmt(target)}</b></div></div></div>
    <div class="list" style="margin-top:12px">${rows || '<div class="empty">No savings goals yet. Tap + Add to start one.</div>'}</div><button class="fab" data-act="addgoal">+ Add</button>`;
  }

  // --- Insights
  function insightsData() {
    const now = nowD(); const all = live(D().tx);
    if (insRange === 'month') {
      const list = all.filter((t) => t.date.startsWith(month)); const [y, m] = month.split('-').map(Number);
      const n = new Date(y, m, 0).getDate(); const bars = [];
      for (let d = 1; d <= n; d++) { const key = month + '-' + z2(d); const day = list.filter((t) => t.date === key); bars.push({ label: d % 5 === 0 || d === 1 ? String(d) : '', inc: sum(day, 'income'), exp: sum(day, 'expense') }); }
      return { list, bars };
    }
    const count = insRange === '6m' ? 6 : now.getMonth() + 1; const bars = []; let list = [];
    for (let i = count - 1; i >= 0; i--) {
      const m = shiftMonth(ym(now), -i); const l = all.filter((t) => t.date.startsWith(m)); list = list.concat(l);
      bars.push({ label: MONTHS[+m.slice(5) - 1].slice(0, 3), inc: sum(l, 'income'), exp: sum(l, 'expense') });
    }
    return { list, bars };
  }
  function barChart(bars) {
    const W = 320, H = 150, pad = 28; const max = Math.max(1, ...bars.map((b) => Math.max(b.inc, b.exp)));
    const slot = (W - pad) / bars.length; const bw = Math.max(2, Math.min(14, slot * 0.36));
    let s = `<svg viewBox="0 0 ${W} ${H + 16}" width="100%" role="img" aria-label="Trend">`;
    [0, .5, 1].forEach((f) => { const y = H - f * (H - 10); s += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="0" y="${y + 3}">${short(max * f)}</text>`; });
    bars.forEach((b, i) => {
      const x = pad + i * slot + slot / 2; const hi = (b.inc / max) * (H - 10); const he = (b.exp / max) * (H - 10);
      s += `<rect class="bar-i" x="${x - bw}" y="${H - hi}" width="${bw}" height="${hi}" rx="2"/><rect class="bar-e" x="${x}" y="${H - he}" width="${bw}" height="${he}" rx="2"/>`;
      if (b.label) s += `<text x="${x}" y="${H + 12}" text-anchor="middle">${esc(b.label)}</text>`;
    });
    return s + '</svg>';
  }
  function donut(items, total) {
    const R = 52, C = 2 * Math.PI * R; let off = 0;
    let s = `<svg viewBox="0 0 140 140" width="150" height="150" role="img" aria-label="By category"><g transform="rotate(-90 70 70)"><circle cx="70" cy="70" r="${R}" fill="none" stroke="var(--surface2)" stroke-width="16"/>`;
    items.forEach((it) => { const len = (it.v / total) * C; s += `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${catInfo(it.c)[1]}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}"/>`; off += len; });
    return s + `</g><text x="70" y="66" text-anchor="middle" style="font-size:9px">Total</text><text x="70" y="82" text-anchor="middle" style="font-size:13px;font-weight:700;fill:var(--text)">${esc(settings.currency + short(total))}</text></svg>`;
  }
  function viewInsights() {
    const { list, bars } = insightsData();
    const inc = sum(list, 'income'); const exp = sum(list, 'expense'); const saved = inc - exp; const pct = inc > 0 ? Math.max(0, Math.round((saved / inc) * 100)) : 0;
    const type = catMode === 'spent' ? 'expense' : 'income';
    const by = {}; list.filter((t) => t.type === type).forEach((t) => (by[t.category] = (by[t.category] || 0) + t.amount));
    const items = Object.keys(by).map((c) => ({ c, v: by[c] })).sort((a, b) => b.v - a.v); const total = items.reduce((a, i) => a + i.v, 0);
    const seg = (v, l) => `<button class="${insRange === v ? 'on' : ''}" data-act="range" data-v="${v}">${l}</button>`;
    const seg2 = (v, l) => `<button class="${catMode === v ? 'on' : ''}" data-act="catmode" data-v="${v}">${l}</button>`;
    return `<div class="seg">${seg('month', 'Month')}${seg('6m', '6 months')}${seg('year', 'This year')}</div>
    ${insRange === 'month' ? `<div class="mrow" style="margin:10px 0 0"><button class="chip" data-act="mprev">‹</button><b>${monthLabel(month)}</b><button class="chip" data-act="mnext">›</button></div>` : ''}
    <div class="card"><h4>Saved</h4><div style="display:flex;justify-content:space-between;align-items:center"><div class="big ${saved < 0 ? 'exp' : 'inc'}">${sgn(saved)}</div><span class="badge">${pct}% saved</span></div>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--muted);margin-top:8px"><span>↙ ${fmt(inc)}</span><span>↗ ${fmt(exp)}</span></div></div>
    <div class="card"><div style="display:flex;justify-content:space-between"><h4>${insRange === 'month' ? 'Daily trend' : 'Monthly trend'}</h4><div class="legend"><span><i style="background:var(--income)"></i>Income</span><span><i style="background:var(--expense)"></i>Expenses</span></div></div>${barChart(bars)}</div>
    <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h4>By category</h4><div class="seg" style="width:170px">${seg2('spent', 'Spent')}${seg2('earned', 'Earned')}</div></div>
      ${items.length ? `<div style="display:flex;justify-content:center;margin:6px 0">${donut(items, total)}</div>` + items.map((i) => `<div class="catrow"><div class="ico" style="width:32px;height:32px;font-size:15px;background:${catInfo(i.c)[1]}26">${catInfo(i.c)[0]}</div><div class="name">${esc(i.c)}<div class="track"><i style="width:${(i.v / total) * 100}%;background:${catInfo(i.c)[1]}"></i></div></div><div><b>${fmt(i.v)}</b> <span style="color:var(--muted)">${Math.round((i.v / total) * 100)}%</span></div></div>`).join('') : '<div class="empty">No data in this range.</div>'}</div>`;
  }

  // --- Settings
  function viewSettings() {
    const th = (v, l) => `<button class="${settings.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`;
    const cur = ['৳', '$', '₹', '€', '£'].map((c) => `<option ${settings.currency === c ? 'selected' : ''}>${c}</option>`).join('');
    const links = session && session.sheets ? PROFILES.map(([p, l]) => session.sheets[p] ? `<a class="setrow" href="${esc(session.sheets[p])}" target="_blank" rel="noopener"><div class="t"><b>Open ${l} Google Sheet</b><span>View or edit the data directly</span></div></a>` : '').join('') : '';
    const account = synced()
      ? `<div class="setrow"><div class="t"><b>${esc(session.email || 'Signed in')}</b><span>Google Sheets · ${esc(statusText())}</span></div></div>${links}
         <button class="setrow" data-act="syncnow"><div class="t"><b>Sync now</b><span>Pull the latest from your other devices</span></div></button>
         <button class="setrow" data-act="logout"><div class="t"><b class="danger">Log out</b><span>Removes the local copy from this device. Your data stays in Google Sheets.</span></div></button>
         <button class="setrow" data-act="logoutall"><div class="t"><b class="danger">Log out of all devices</b><span>Use this if a phone or laptop is lost</span></div></button>`
      : `<div class="setrow"><div class="t"><b>This device only</b><span>Not synced. Sign in to keep phone and laptop in sync.</span></div></div>
         <button class="setrow" data-act="relogin"><div class="t"><b>Sign in to sync</b><span>Your data on this device will be uploaded</span></div></button>
         <button class="setrow" data-act="logout"><div class="t"><b class="danger">Delete data and leave</b><span>Wipes everything stored on this device</span></div></button>`;
    return `<div class="group" style="margin-top:4px">Account</div><div class="card" style="margin-top:0">${account}</div>
    <div class="group">Appearance</div><div class="card" style="margin-top:0"><div class="seg">${th('system', 'System')}${th('light', 'Light')}${th('dark', 'Dark')}</div>
      <div class="setrow" style="margin-top:8px"><div class="t"><b>Currency symbol</b></div><div style="width:90px"><select data-act="currency">${cur}</select></div></div></div>
    <div class="group">Entry</div><div class="card" style="margin-top:0"><button class="setrow" data-act="togglereview"><div class="t"><b>Review before saving</b><span>See what was found before it is saved</span></div><span class="switch ${settings.review ? 'on' : ''}"></span></button>
      <div class="setrow"><div class="t"><b>Rules-based parser</b><span>Runs in your browser. No AI model, nothing extra to download.</span></div></div></div>
    <div class="group">Excel files (one per profile)</div><div class="card" style="margin-top:0">
      ${PROFILES.map(([p, l]) => `<button class="setrow" data-act="dl" data-v="${p}"><div class="t"><b>Download ${l} Excel</b><span>hisab-${p}.xlsx · ${live(data[p].tx).length} transactions, ${live(data[p].dues).length} dues</span></div></button>`).join('')}
      <button class="setrow" data-act="import"><div class="t"><b>Import Excel into ${PROFILES.find((x) => x[0] === profile)[1]}</b><span>Adds or updates rows from a hisab-*.xlsx file</span></div></button>
      <button class="setrow" data-act="csv"><div class="t"><b>Export transactions as CSV</b><span>Current profile</span></div></button>
      <button class="setrow" data-act="clearprofile"><div class="t"><b class="danger">Delete all data in ${PROFILES.find((x) => x[0] === profile)[1]}</b><span>Also removed on your other devices after sync</span></div></button></div>`;
  }

  // ---------- render ----------
  function render() {
    applyTheme();
    const app = $('#app'); const keep = app.scrollTop;
    if (!session) { app.innerHTML = loginView(); return; }
    const body = tab === 'tx' ? viewTx() : tab === 'dues' ? viewDues() : tab === 'budget' ? viewBudget() : tab === 'goals' ? viewGoals() : tab === 'insights' ? viewInsights() : viewSettings();
    const tabsEl = $('.tabs'); const tl = tabsEl ? tabsEl.scrollLeft : 0;
    app.innerHTML = header() + '<div id="body">' + body + '</div>';
    const t2 = $('.tabs'); if (t2) { t2.scrollLeft = tl; const on = $('.tab.on', t2); if (on && !tl && on.scrollIntoView) on.scrollIntoView({ inline: 'center', block: 'nearest' }); }
    app.scrollTop = keep;
  }

  // ---------- modals ----------
  const catOptions = (type, sel) => (type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  function openModal(html) { const m = $('#modal'); m.innerHTML = '<div class="sheet">' + html + '</div>'; m.classList.add('open'); }
  function closeModal() { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; draft = null; }
  const reopen = (html) => { $('#modal').innerHTML = '<div class="sheet">' + html + '</div>'; };
  const num = (id) => parseFloat($('#' + id).value) || 0;

  function reviewHtml() {
    return `<h3>Found ${draft.items.length} ${draft.items.length === 1 ? 'entry' : 'entries'}</h3>` + draft.items.map((it, i) => `<div class="rv">
      <div class="rtop"><div class="seg" style="width:150px"><button class="${it.type === 'expense' ? 'on' : ''}" data-act="rtype" data-i="${i}" data-v="expense">Expense</button><button class="${it.type === 'income' ? 'on' : ''}" data-act="rtype" data-i="${i}" data-v="income">Income</button></div>
        <input class="field" type="number" min="0" step="any" value="${it.amount}" data-f="amount" data-i="${i}" aria-label="Amount"><button class="x" data-act="rrm" data-i="${i}" aria-label="Remove">✕</button></div>
      <div class="grid2"><input class="field" value="${esc(it.desc)}" data-f="desc" data-i="${i}" aria-label="Description"><select data-f="category" data-i="${i}">${catOptions(it.type, it.category)}</select></div></div>`).join('')
      + `<div class="btns"><button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="rsave">Save</button></div>`;
  }

  function txHtml() {
    const it = draft.rec; const isEdit = draft.isEdit;
    return `<h3>${isEdit ? 'Edit entry' : 'Add entry'}</h3>
    <div class="seg"><button class="${it.type === 'expense' ? 'on' : ''}" data-act="etype" data-v="expense">Expense</button><button class="${it.type === 'income' ? 'on' : ''}" data-act="etype" data-v="income">Income</button></div>
    <div class="fieldrow"><label>Amount</label><input class="field" type="number" min="0" step="any" id="eAmount" value="${it.amount || ''}" inputmode="decimal"></div>
    <div class="fieldrow"><label>Description</label><input class="field" id="eDesc" value="${esc(it.desc)}"></div>
    <div class="grid2"><div class="fieldrow"><label>Category</label><select id="eCat">${catOptions(it.type, it.category)}</select></div><div class="fieldrow"><label>Date</label><input class="field" type="date" id="eDate" value="${esc(it.date)}"></div></div>
    <div class="fieldrow"><label>Note</label><input class="field" id="eNote" value="${esc(it.note || '')}"></div>
    <div class="btns">${isEdit ? '<button class="btn del" data-act="edel">Delete</button>' : ''}<button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="esave">Save</button></div>`;
  }
  const readTx = () => { const it = draft.rec; it.amount = num('eAmount'); it.desc = $('#eDesc').value.trim(); it.category = $('#eCat').value; it.date = $('#eDate').value; it.note = $('#eNote').value.trim(); };

  function dueHtml() {
    const d = draft.rec; const isEdit = draft.isEdit;
    return `<h3>${isEdit ? 'Edit due' : 'Add due'}</h3>
    <div class="seg"><button class="${d.dir === 'get' ? 'on' : ''}" data-act="ddir" data-v="get">I'll get</button><button class="${d.dir === 'owe' ? 'on' : ''}" data-act="ddir" data-v="owe">I owe</button></div>
    <div class="fieldrow"><label>Person</label><input class="field" id="dPerson" value="${esc(d.person)}" placeholder="Name"></div>
    <div class="grid2"><div class="fieldrow"><label>Amount</label><input class="field" type="number" min="0" step="any" id="dAmount" value="${d.amount || ''}" inputmode="decimal"></div><div class="fieldrow"><label>Paid so far</label><input class="field" type="number" min="0" step="any" id="dPaid" value="${d.paid || ''}" inputmode="decimal"></div></div>
    <div class="grid2"><div class="fieldrow"><label>Date</label><input class="field" type="date" id="dDate" value="${esc(d.date)}"></div><div class="fieldrow"><label>Due date (optional)</label><input class="field" type="date" id="dDue" value="${esc(d.due || '')}"></div></div>
    <div class="fieldrow"><label>Note</label><input class="field" id="dNote" value="${esc(d.note || '')}"></div>
    <div class="btns">${isEdit ? '<button class="btn del" data-act="ddel">Delete</button><button class="btn" data-act="dsettle">Settle fully</button>' : ''}</div>
    <div class="btns"><button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="dsave">Save</button></div>`;
  }
  const readDue = () => { const d = draft.rec; d.person = $('#dPerson').value.trim(); d.amount = num('dAmount'); d.paid = num('dPaid'); d.date = $('#dDate').value; d.due = $('#dDue').value; d.note = $('#dNote').value.trim(); };

  function goalHtml() {
    const g = draft.rec; const isEdit = draft.isEdit;
    return `<h3>${isEdit ? 'Edit goal' : 'New savings goal'}</h3>
    <div class="fieldrow"><label>Name</label><input class="field" id="gName" value="${esc(g.name)}" placeholder="e.g. New laptop"></div>
    <div class="grid2"><div class="fieldrow"><label>Target</label><input class="field" type="number" min="0" step="any" id="gTarget" value="${g.target || ''}" inputmode="decimal"></div><div class="fieldrow"><label>Saved so far</label><input class="field" type="number" min="0" step="any" id="gSaved" value="${g.saved || ''}" inputmode="decimal"></div></div>
    ${isEdit ? '<div class="fieldrow"><label>Add money now</label><input class="field" type="number" min="0" step="any" id="gAdd" placeholder="0" inputmode="decimal"></div>' : ''}
    <div class="fieldrow"><label>Deadline (optional)</label><input class="field" type="date" id="gDeadline" value="${esc(g.deadline || '')}"></div>
    <div class="fieldrow"><label>Note</label><input class="field" id="gNote" value="${esc(g.note || '')}"></div>
    <div class="btns">${isEdit ? '<button class="btn del" data-act="gdel">Delete</button>' : ''}<button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="gsave">Save</button></div>`;
  }

  function budgetHtml() {
    return `<h3>${esc(draft.cat)} budget</h3><div class="fieldrow"><label>Monthly limit (${esc(settings.currency)})</label><input class="field" type="number" min="0" step="any" id="bLimit" value="${draft.limit || ''}" inputmode="decimal" placeholder="0 to remove"></div>
    <div class="btns">${draft.limit ? '<button class="btn del" data-act="bdel">Remove</button>' : ''}<button class="btn" data-act="mclose">Cancel</button><button class="btn primary" data-act="bsave">Save</button></div>`;
  }

  function accountHtml() {
    if (synced()) {
      const email = esc(session.email || 'Signed in'); const links = session.sheets || {};
      if (draft && draft.confirmAll) {
        return `<h3>Log out of all devices?</h3><p style="color:var(--muted);margin:0">Every phone and laptop signed in as ${email}, including this one, will need to sign in again. Your data stays in Google Sheets.</p>
        <div class="btns"><button class="btn" data-act="accback">Cancel</button><button class="btn del" style="flex:1" data-act="accall">Log out everywhere</button></div>`;
      }
      return `<div style="display:flex;gap:12px;align-items:center;margin-bottom:6px"><div class="avatar on" style="width:48px;height:48px;font-size:20px">${esc((session.email || '?').charAt(0).toUpperCase())}</div>
        <div style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis">${email}</b><span style="color:var(--muted);font-size:13px">${esc(statusText())}</span></div></div>
      <div class="card" style="margin-top:10px;padding-block:4px">
        ${PROFILES.map(([p, l]) => links[p] && links[p] !== '#' ? `<a class="setrow" href="${esc(links[p])}" target="_blank" rel="noopener"><div class="t"><b>Open ${l} Google Sheet</b></div></a>` : '').join('')}
        <button class="setrow" data-act="accsync"><div class="t"><b>Sync now</b><span>Pull the latest from your other devices</span></div></button>
        <button class="setrow" data-act="accall-ask"><div class="t"><b>Log out of all devices</b><span>Use this if a phone or laptop is lost</span></div></button></div>
      <div class="btns"><button class="btn" data-act="mclose">Close</button><button class="btn del" style="flex:1" data-act="accout">Log out</button></div>`;
    }
    return `<h3>Not signed in</h3><p style="color:var(--muted);margin:0 0 4px">You are using Hisab Khata on this device only. Sign in to keep your Personal and Professional books in sync between phone and laptop.</p>
      <div class="btns"><button class="btn primary" data-act="gologin" data-v="signin">Sign in</button><button class="btn" data-act="gologin" data-v="signup">Create account</button></div>
      <div class="btns" style="margin-top:8px"><button class="btn" data-act="mclose">Keep using this device only</button></div>`;
  }

  // ---------- auth ----------
  async function doAuth() {
    const err = $('#l_err'); const btn = $('#l_btn'); const signup = authMode === 'signup';
    const url = API_URL() || ($('#l_url') ? $('#l_url').value.trim() : '');
    const email = $('#l_email').value.trim().toLowerCase(); const pass = $('#l_pass').value;
    if (!HishabSheets.URL_RE.test(url)) { err.textContent = API_URL() ? 'The server URL in config.js is not valid. It must start with https://script.google.com/macros/s/ and end with /exec' : 'Paste the server URL. It starts with https://script.google.com/macros/s/ and ends with /exec'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Enter a valid email address.'; return; }
    if (!pass) { err.textContent = 'Enter your password.'; return; }
    let code = '';
    if (signup) {
      if (pass.length < 8) { err.textContent = 'Use a password of at least 8 characters.'; return; }
      if (pass !== $('#l_pass2').value) { err.textContent = 'The two passwords do not match.'; return; }
      code = $('#l_code').value; if (!code) { err.textContent = 'Enter the signup code.'; return; }
    }
    btn.disabled = true; btn.textContent = signup ? 'Creating…' : 'Signing in…'; err.textContent = '';
    try {
      const info = await HishabSheets.authenticate(url, signup ? 'register' : 'login', email, pass, code);
      // a different account on this device: do not mix its data into the new one
      const owner = store.get('owner', null);
      if (owner && owner !== email) {
        if (PROFILES.some(([p]) => hasPending(p)) && !confirm('This device has unsynced changes from ' + owner + '. Signing in as someone else will discard them. Continue?')) { btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in'; return; }
        ['dirty', 'hash', 'data.personal', 'data.professional'].forEach((k) => store.del(k));
        PROFILES.forEach(([p]) => { data[p] = Store.emptyData(); dirty[p] = {}; delete lastHash[p]; });
      }
      session = { mode: 'sheets', url, token: info.token, email, sheets: info.sheets || {} };
      store.set('session', session); store.set('lastUrl', url); store.set('lastEmail', email); store.set('owner', email);
      client = HishabSheets.create(session); authFailed = false; lastSync = 0; setStatus('sync');
      // first time on this device: upload whatever is already here (e.g. entries made in "this device only" mode)
      PROFILES.forEach(([p]) => { if (!lastHash[p]) Store.COLLECTIONS.forEach((col) => data[p][col].forEach((r) => { (dirty[p][col] = dirty[p][col] || {})[r.id] = 1; })); persist(p); });
      tab = 'tx'; render(); runSync(PROFILES.map((p) => p[0]));
    } catch (e) {
      btn.disabled = false; btn.textContent = signup ? 'Create account' : 'Sign in';
      err.textContent = e instanceof TypeError
        ? 'Could not reach the server. Open the server URL in a private browser window: it should show {"ok":true,...}. If Google asks you to sign in, redeploy the script with "Who has access: Anyone".'
        : e.message;
    }
  }
  async function doLogout() {
    const sync_ = synced();
    if (sync_ && PROFILES.some(([p]) => hasPending(p)) && !authFailed) {
      toast('Saving your changes first…'); await runSync(PROFILES.map((p) => p[0]));
      while (syncing) await new Promise((r) => setTimeout(r, 100));
      if (PROFILES.some(([p]) => hasPending(p)) && !confirm('Some changes could not be synced and will be lost. Log out anyway?')) return;
    } else if (sync_ && authFailed && PROFILES.some(([p]) => hasPending(p)) && !confirm('Unsynced changes on this device will be lost. Log out anyway?')) return;
    else if (!sync_ && !confirm('This deletes all data stored on this device (it is not synced anywhere). Download the Excel files first if you need them. Continue?')) return;
    clearTimeout(pushTimer);
    ['session', 'owner', 'dirty', 'hash', 'data.personal', 'data.professional', 'profile'].forEach((k) => store.del(k));
    session = null; client = null; authFailed = false; tab = 'tx'; profile = 'personal';
    PROFILES.forEach(([p]) => { data[p] = Store.emptyData(); dirty[p] = {}; delete lastHash[p]; });
    setStatus('local'); render();
  }

  // ---------- actions ----------
  function submitQuick(text) {
    const items = HishabParser.parse(text).map((e) => ({ id: uid(), date: e.date, type: e.type, category: e.category, desc: e.description, amount: e.amount, note: '', del: 0 }));
    if (!items.length) { toast('No amount found. Try: lunch 250, rickshaw 60'); return; }
    if (settings.review) { draft = { kind: 'review', items }; openModal(reviewHtml()); return; }
    items.forEach((t) => upsert('tx', t)); changed(); render(); toast('Saved ' + items.length + (items.length === 1 ? ' entry' : ' entries'));
  }

  document.addEventListener('submit', (e) => {
    const f = e.target.dataset.form;
    if (f === 'quick') { e.preventDefault(); const inp = $('#quickInput'); const v = inp.value.trim(); if (v) { submitQuick(v); if (!settings.review) inp.value = ''; } }
    else if (f === 'login') { e.preventDefault(); doAuth(); }
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'search') { q = t.value; rowLimit = 150; const l = $('#txList'); if (l) l.innerHTML = txListHtml(); return; }
    if (draft && draft.kind === 'review' && t.dataset.f) { const it = draft.items[+t.dataset.i]; it[t.dataset.f] = t.dataset.f === 'amount' ? parseFloat(t.value) || 0 : t.value; }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'importFile') {
      const f = t.files[0]; if (!f) return; const r = new FileReader();
      r.onload = () => {
        try {
          const parsed = Store.parseWorkbook(XLSX, new Uint8Array(r.result)).data; let n = 0;
          Store.COLLECTIONS.forEach((c) => parsed[c].forEach((rec) => { upsert(c, rec); n++; }));
          changed(); render(); toast('Imported ' + n + ' rows');
        } catch (err) { toast('Could not read that Excel file'); }
      };
      r.readAsArrayBuffer(f); t.value = '';
    } else if (t.dataset.act === 'profile') { profile = t.value; store.set('profile', profile); q = ''; render(); runSync([profile]); }
    else if (t.dataset.act === 'currency') { settings.currency = t.value; store.set('settings', settings); render(); }
    else if (draft && draft.kind === 'review' && t.dataset.f === 'category') { draft.items[+t.dataset.i].category = t.value; }
  });

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act; const v = el.dataset.v; const i = +el.dataset.i; const today = iso(nowD());
    if (a === 'profile') return;
    switch (a) {
      case 'tab': tab = v; render(); $('#app').scrollTop = 0; break;
      case 'scope': scope = v; rowLimit = 150; render(); break;
      case 'mprev': month = shiftMonth(month, -1); render(); break;
      case 'mnext': month = shiftMonth(month, 1); render(); break;
      case 'more': rowLimit += 150; $('#txList').innerHTML = txListHtml(); break;
      case 'range': insRange = v; render(); break;
      case 'catmode': catMode = v; render(); break;
      case 'dstatus': duesStatus = v; render(); break;
      case 'ddirf': duesDir = v; render(); break;
      case 'theme': settings.theme = v; store.set('settings', settings); render(); break;
      case 'togglereview': settings.review = !settings.review; store.set('settings', settings); render(); break;
      case 'syncnow':
        if (!synced()) { toast('Not signed in. This device only.'); break; }
        if (authFailed) { toast('Sign-in expired. Please sign in again.'); break; }
        toast(statusText()); runSync(PROFILES.map((p) => p[0])); break;
      case 'localmode': session = { mode: 'local' }; store.set('session', session); setStatus('local'); tab = 'tx'; render(); break;
      case 'relogin': session = null; client = null; authFailed = false; authMode = 'signin'; $('#app').innerHTML = loginView(); break;
      case 'authmode': authMode = authMode === 'signin' ? 'signup' : 'signin'; $('#app').innerHTML = loginView(); break;
      case 'logoutall': if (confirm('Log out of every device you are signed in on, including this one?')) { try { await client.logoutAll(); } catch (e) { /* offline or already expired */ } doLogout(); } break;
      case 'logout': doLogout(); break;
      case 'account': draft = { kind: 'account' }; openModal(accountHtml()); break;
      case 'gologin': closeModal(); session = null; client = null; authFailed = false; authMode = v === 'signup' ? 'signup' : 'signin'; $('#app').innerHTML = loginView(); break;
      case 'accout': closeModal(); doLogout(); break;
      case 'accsync': closeModal(); if (authFailed) toast('Session expired. Please sign in again.'); else runSync(PROFILES.map((p) => p[0])); break;
      case 'accall-ask': draft = { kind: 'account', confirmAll: true }; reopen(accountHtml()); break;
      case 'accback': draft = { kind: 'account' }; reopen(accountHtml()); break;
      case 'accall': closeModal(); try { await client.logoutAll(); } catch (e) { /* offline or already expired */ } doLogout(); break;
      case 'dl': downloadExcel(v); break;
      case 'import': $('#importFile').click(); break;
      case 'csv': downloadCsv(); break;
      case 'clearprofile':
        if (confirm('Delete ALL data in this profile? This also removes it from your other devices after sync.')) {
          Store.COLLECTIONS.forEach((c) => D()[c].forEach((r) => { r.del = 1; r.upd = Date.now(); markDirty(c, r.id); })); changed(); render(); toast('Profile cleared');
        } break;

      // transactions
      case 'add': draft = { kind: 'tx', isEdit: false, rec: { id: uid(), date: today, type: 'expense', category: 'Food', desc: '', amount: 0, note: '', del: 0 } }; openModal(txHtml()); break;
      case 'edit': { const t = D().tx.find((x) => x.id === el.dataset.id); if (t) { draft = { kind: 'tx', isEdit: true, rec: Object.assign({}, t) }; openModal(txHtml()); } break; }
      case 'etype': readTx(); draft.rec.type = v; draft.rec.category = v === 'income' ? 'Other income' : 'Other'; reopen(txHtml()); break;
      case 'esave': {
        readTx(); const it = draft.rec;
        if (!(it.amount > 0)) { toast('Enter an amount'); break; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date)) { toast('Pick a date'); break; }
        if (!it.desc) it.desc = it.category;
        upsert('tx', it); changed(); closeModal(); render(); toast('Saved'); break;
      }
      case 'edel': removeRec('tx', draft.rec.id); changed(); closeModal(); render(); toast('Deleted'); break;
      case 'rtype': { const it = draft.items[i]; it.type = v; it.category = v === 'income' ? 'Other income' : 'Other'; reopen(reviewHtml()); break; }
      case 'rrm': draft.items.splice(i, 1); if (!draft.items.length) closeModal(); else reopen(reviewHtml()); break;
      case 'rsave': {
        const items = draft.items.filter((x) => x.amount > 0).map((x) => Object.assign({}, x, { desc: x.desc || x.category }));
        items.forEach((t) => upsert('tx', t)); changed(); closeModal(); const qi = $('#quickInput'); if (qi) qi.value = ''; render(); toast('Saved ' + items.length + (items.length === 1 ? ' entry' : ' entries')); break;
      }

      // dues
      case 'adddue': draft = { kind: 'due', isEdit: false, rec: { id: uid(), date: today, dir: 'get', person: '', amount: 0, paid: 0, due: '', note: '', del: 0 } }; openModal(dueHtml()); break;
      case 'editdue': { const d = D().dues.find((x) => x.id === el.dataset.id); if (d) { draft = { kind: 'due', isEdit: true, rec: Object.assign({}, d) }; openModal(dueHtml()); } break; }
      case 'ddir': readDue(); draft.rec.dir = v; reopen(dueHtml()); break;
      case 'dsettle': readDue(); if (draft.rec.amount > 0) draft.rec.paid = draft.rec.amount; reopen(dueHtml()); break;
      case 'dsave': {
        readDue(); const d = draft.rec;
        if (!d.person) { toast('Enter a name'); break; }
        if (!(d.amount > 0)) { toast('Enter an amount'); break; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) d.date = today;
        upsert('dues', d); changed(); closeModal(); render(); toast('Saved'); break;
      }
      case 'ddel': removeRec('dues', draft.rec.id); changed(); closeModal(); render(); toast('Deleted'); break;

      // budget
      case 'editbudget': { const b = live(D().budget).find((x) => x.category === v); draft = { kind: 'budget', cat: v, limit: b ? b.limit : 0 }; openModal(budgetHtml()); break; }
      case 'bsave': setBudget(draft.cat, num('bLimit')); changed(); closeModal(); render(); toast('Saved'); break;
      case 'bdel': setBudget(draft.cat, 0); changed(); closeModal(); render(); break;

      // goals
      case 'addgoal': draft = { kind: 'goal', isEdit: false, rec: { id: uid(), name: '', target: 0, saved: 0, deadline: '', note: '', del: 0 } }; openModal(goalHtml()); break;
      case 'editgoal': { const g = D().goals.find((x) => x.id === el.dataset.id); if (g) { draft = { kind: 'goal', isEdit: true, rec: Object.assign({}, g) }; openModal(goalHtml()); } break; }
      case 'gsave': {
        const g = draft.rec; g.name = $('#gName').value.trim(); g.target = num('gTarget'); g.saved = num('gSaved') + (draft.isEdit ? num('gAdd') : 0); g.deadline = $('#gDeadline').value; g.note = $('#gNote').value.trim();
        if (!g.name) { toast('Give the goal a name'); break; }
        if (!(g.target > 0)) { toast('Enter a target amount'); break; }
        upsert('goals', g); changed(); closeModal(); render(); toast('Saved'); break;
      }
      case 'gdel': removeRec('goals', draft.rec.id); changed(); closeModal(); render(); toast('Deleted'); break;
      case 'mclose': closeModal(); break;
    }
  });

  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
  if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });

  // ---------- keep devices fresh ----------
  const syncActive = () => { if (!document.hidden) runSync([profile]); };
  document.addEventListener('visibilitychange', syncActive);
  window.addEventListener('focus', syncActive);
  window.addEventListener('online', syncActive);
  setInterval(syncActive, 30000);
  window.addEventListener('beforeunload', (e) => {
    if (synced() && PROFILES.some(([p]) => hasPending(p))) { e.preventDefault(); e.returnValue = ''; }
  });

  // ---------- boot ----------
  applyTheme();
  render();
  if (synced()) runSync(PROFILES.map((p) => p[0]));
  window.__hk = { runSync, data, getSession: () => session }; // used by tests
})();
