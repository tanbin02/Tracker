/* Hishab data model: records, merge, and Excel (xlsx) import/export.
   Each profile = one Excel file with sheets: Transactions, Dues, Budget, Savings. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HishabStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const TOMBSTONE_DAYS = 30;

  // [Excel column, record key, kind]
  const SHEETS = {
    tx: { name: 'Transactions', sort: 'date', required: 'amount', fields: [['ID', 'id', 'str'], ['Date', 'date', 'date'], ['Type', 'type', 'type'], ['Category', 'category', 'str'], ['Description', 'desc', 'str'], ['Amount', 'amount', 'num'], ['Note', 'note', 'str'], ['Updated', 'upd', 'ts'], ['Deleted', 'del', 'del']] },
    dues: { name: 'Dues', sort: 'date', required: 'person', fields: [['ID', 'id', 'str'], ['Date', 'date', 'date'], ['Direction', 'dir', 'dir'], ['Person', 'person', 'str'], ['Amount', 'amount', 'num'], ['Paid', 'paid', 'num'], ['DueDate', 'due', 'date'], ['Note', 'note', 'str'], ['Updated', 'upd', 'ts'], ['Deleted', 'del', 'del']] },
    budget: { name: 'Budget', required: 'category', fields: [['ID', 'id', 'str'], ['Category', 'category', 'str'], ['MonthlyLimit', 'limit', 'num'], ['Updated', 'upd', 'ts'], ['Deleted', 'del', 'del']] },
    goals: { name: 'Savings', required: 'name', fields: [['ID', 'id', 'str'], ['Name', 'name', 'str'], ['Target', 'target', 'num'], ['Saved', 'saved', 'num'], ['Deadline', 'deadline', 'date'], ['Note', 'note', 'str'], ['Updated', 'upd', 'ts'], ['Deleted', 'del', 'del']] }
  };
  const COLLECTIONS = Object.keys(SHEETS);

  const emptyData = () => ({ tx: [], dues: [], budget: [], goals: [] });
  const z2 = (n) => String(n).padStart(2, '0');

  // ---- value encoders ----
  function encode(kind, v) {
    switch (kind) {
      case 'type': return v === 'income' ? 'Income' : 'Expense';
      case 'dir': return v === 'get' ? 'Receivable' : 'Payable';
      case 'ts': return new Date(v || 0).toISOString();
      case 'del': return v ? 1 : 0;
      case 'num': return Number(v) || 0;
      default: return v == null ? '' : v;
    }
  }
  function decode(kind, v) {
    switch (kind) {
      case 'type': return /^inc/i.test(String(v).trim()) ? 'income' : 'expense';
      case 'dir': return /^(rec|get|pabo|i will)/i.test(String(v).trim()) ? 'get' : 'owe';
      case 'ts': {
        if (v instanceof Date) return v.getTime();
        if (typeof v === 'number') return v;
        const t = Date.parse(String(v)); return isNaN(t) ? 0 : t;
      }
      case 'del': return Number(v) === 1 || /^(true|yes|y)$/i.test(String(v).trim()) ? 1 : 0;
      case 'num': { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; }
      case 'date': {
        if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return d.getUTCFullYear() + '-' + z2(d.getUTCMonth() + 1) + '-' + z2(d.getUTCDate()); }
        const t = String(v).trim();
        const dmy = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
        if (dmy) return dmy[3] + '-' + z2(dmy[2]) + '-' + z2(dmy[1]);
        const s = t.slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
      }
      default: return String(v == null ? '' : v).trim();
    }
  }

  // ---- xlsx ----
  const READ_ME = [
    ['Hisab Khata database'],
    ['One Excel file per profile. Sheets: Transactions, Dues, Budget, Savings.'],
    ['You may edit this file in Excel. Keep the sheet names and header rows. Dates: YYYY-MM-DD.'],
    ['Rows with Deleted = 1 are removed entries kept briefly so other devices learn about the deletion.'],
    ['The app keeps this file in sync between your devices.']
  ];

  function buildWorkbook(XLSX, data) {
    const wb = XLSX.utils.book_new();
    const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
    COLLECTIONS.forEach((c) => {
      const def = SHEETS[c];
      let recs = (data[c] || []).filter((r) => !(r.del && (r.upd || 0) < cutoff));
      if (def.sort) recs = recs.slice().sort((a, b) => (a[def.sort] < b[def.sort] ? -1 : a[def.sort] > b[def.sort] ? 1 : 0));
      const header = def.fields.map((f) => f[0]);
      const rows = recs.map((r) => { const o = {}; def.fields.forEach(([col, key, kind]) => { o[col] = encode(kind, r[key]); }); return o; });
      const ws = XLSX.utils.json_to_sheet(rows, { header });
      ws['!cols'] = header.map((h) => ({ wch: /Description|Note|Person|Name/.test(h) ? 26 : h === 'ID' ? 14 : h === 'Updated' ? 24 : 13 }));
      XLSX.utils.book_append_sheet(wb, ws, def.name);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(READ_ME), 'Readme');
    return wb;
  }
  function toBytes(XLSX, data) { return XLSX.write(buildWorkbook(XLSX, data), { type: 'array', bookType: 'xlsx' }); }

  // ---- rows <-> records (also used for the Google Sheets backend) ----
  function schema() {
    const o = {};
    COLLECTIONS.forEach((c) => {
      const d = SHEETS[c];
      o[c] = { sheet: d.name, cols: d.fields.map((f) => f[0]), text: d.fields.filter((f) => f[2] !== 'num' && f[2] !== 'del').map((f) => f[0]) };
    });
    return o;
  }
  function toRow(c, rec) { const o = {}; SHEETS[c].fields.forEach(([col, key, kind]) => { o[col] = encode(kind, rec[key]); }); return o; }
  function fromRow(c, row) {
    const def = SHEETS[c]; const rec = {};
    def.fields.forEach(([col, key, kind]) => { rec[key] = decode(kind, row[col]); });
    const ok = def.required === 'amount' ? rec.amount > 0 : !!rec[def.required];
    if (!ok) return null;
    if ((c === 'tx' || c === 'dues') && !rec.date) { const n = new Date(); rec.date = n.getFullYear() + '-' + z2(n.getMonth() + 1) + '-' + z2(n.getDate()); }
    return rec;
  }

  // returns { data, fixed } ; fixed=true when rows had to be completed (missing ID/Updated)
  function parseWorkbook(XLSX, bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    const data = emptyData(); let fixed = false;
    COLLECTIONS.forEach((c) => {
      const ws = wb.Sheets[SHEETS[c].name]; if (!ws) return;
      XLSX.utils.sheet_to_json(ws, { defval: '' }).forEach((row) => {
        const rec = fromRow(c, row); if (!rec) return;
        if (!rec.id) { rec.id = uid(); fixed = true; }
        if (!rec.upd) { rec.upd = Date.now(); fixed = true; }
        data[c].push(rec);
      });
    });
    return { data, fixed };
  }

  // ---- merge (newest `upd` wins; tie => remote wins) ----
  function mergeList(local, remote) {
    const map = new Map(); (remote || []).forEach((r) => map.set(r.id, r));
    let push = false;
    (local || []).forEach((l) => {
      const r = map.get(l.id);
      if (!r) { map.set(l.id, l); push = true; }
      else if ((l.upd || 0) > (r.upd || 0)) { map.set(l.id, l); push = true; }
    });
    return { list: Array.from(map.values()), push };
  }
  function mergeData(local, remote) {
    const out = emptyData(); let push = false;
    COLLECTIONS.forEach((c) => { const m = mergeList(local[c], remote[c]); out[c] = m.list; push = push || m.push; });
    return { data: out, push };
  }

  return { SHEETS, COLLECTIONS, emptyData, uid, schema, toRow, fromRow, toBytes, buildWorkbook, parseWorkbook, mergeData };
});
