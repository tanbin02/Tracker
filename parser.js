/* Hishab parser: natural-language (Bangla / English / Banglish) -> transactions.
   Rule-based, runs fully in the browser. No server, no AI API. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HishabParser = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EXPENSE_CATEGORIES = ['Food', 'Groceries', 'Utilities', 'Rent', 'Transport', 'Shopping', 'Health', 'Education', 'Entertainment', 'Other'];
  const INCOME_CATEGORIES = ['Salary', 'Business', 'Freelance', 'Gift', 'Other income'];

  // ---------- number words ----------
  const NUM_WORDS = {
    // Banglish
    ek: 1, dui: 2, du: 2, tin: 3, char: 4, panch: 5, pach: 5, choy: 6, chhoy: 6, saat: 7, aat: 8, noy: 9, dosh: 10, dos: 10,
    egaro: 11, baro: 12, tero: 13, choddo: 14, ponero: 15, pondro: 15, sholo: 16, shotero: 17, satero: 17, atharo: 18, unish: 19,
    bish: 20, ekush: 21, baish: 22, teish: 23, chobbish: 24, pochish: 25, tish: 30, trish: 30, challish: 40, pochash: 50, ponchash: 50,
    shath: 60, saath: 60, sotor: 70, ashi: 80, nobboi: 90,
    // Bangla script
    'এক': 1, 'দুই': 2, 'তিন': 3, 'চার': 4, 'পাঁচ': 5, 'ছয়': 6, 'সাত': 7, 'আট': 8, 'নয়': 9, 'দশ': 10,
    'এগারো': 11, 'বারো': 12, 'তেরো': 13, 'চৌদ্দ': 14, 'পনেরো': 15, 'ষোলো': 16, 'সতেরো': 17, 'আঠারো': 18, 'উনিশ': 19,
    'বিশ': 20, 'পঁচিশ': 25, 'ত্রিশ': 30, 'চল্লিশ': 40, 'পঞ্চাশ': 50, 'ষাট': 60, 'সত্তর': 70, 'আশি': 80, 'নব্বই': 90,
    // English
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20, thirty: 30, forty: 40, fifty: 50
  };
  const SPECIAL = { der: 1.5, 'দেড়': 1.5, arai: 2.5, aray: 2.5, 'আড়াই': 2.5 };
  const HALF = { sare: 1, 'সাড়ে': 1 };
  const MULT = {
    hajar: 1000, hazar: 1000, hajaar: 1000, 'হাজার': 1000, thousand: 1000,
    shoto: 100, sho: 100, 'শত': 100, 'শ': 100, hundred: 100,
    lakh: 1e5, lac: 1e5, lakhs: 1e5, lokkho: 1e5, 'লাখ': 1e5, 'লক্ষ': 1e5,
    koti: 1e7, 'কোটি': 1e7, million: 1e6
  };
  const CURRENCY_WORDS = new Set(['taka', 'takar', 'takay', 'tk', 'টাকা', 'টাকার', 'টাকায়', '৳', 'bdt']);

  // ---------- keyword tables ----------
  const INCOME_WORDS = ['salary', 'beton', 'বেতন', 'pelam', 'pailam', 'paisi', 'peyechi', 'পেলাম', 'পেয়েছি', 'পাইলাম', 'income', 'received',
    'receive', 'bonus', 'earn', 'refund', 'freelance', 'bikri', 'bikree', 'বিক্রি', 'credited', 'cashback', 'profit', 'লাভ', 'commission',
    'got paid', 'ay holo', 'আয়', 'sold'];
  const STRONG_INCOME = ['salary', 'beton', 'বেতন', 'bonus', 'income', 'freelance', 'bikri', 'বিক্রি'];
  const EXPENSE_VERBS = ['korlam', 'kinlam', 'dilam', 'diyechi', 'kinechi', 'korechi', 'bought', 'spent', 'paid', 'khoroch', 'খরচ', 'কিনলাম',
    'করলাম', 'দিলাম', 'দিয়েছি', 'কিনেছি'];

  const EXPENSE_RULES = [
    ['Rent', ['basha', 'bashar', 'বাসা', 'house rent', 'bari vara', 'bari bhara', 'বাড়ি ভাড়া', 'বাড়ী ভাড়া', 'rent', 'mess']],
    ['Groceries', ['bazar', 'bajar', 'বাজার', 'grocery', 'groceries', 'sobji', 'shobji', 'সবজি', 'mach', 'মাছ', 'mangsho', 'মাংস', 'chal', 'চাল',
      'dal', 'ডাল', 'tel', 'ডিম', 'dim', 'egg', 'supermarket', 'shwapno', 'agora']],
    ['Food', ['lunch', 'dinner', 'breakfast', 'nasta', 'nashta', 'naasta', 'khabar', 'khawa', 'khaowa', 'chips', 'biryani', 'biriyani', 'cha ',
      ' cha', 'tea', 'coffee', 'restaurant', 'pizza', 'burger', 'snack', 'fruit', 'juice', 'icecream', 'ice cream', 'cake', 'fuchka', 'chotpoti',
      'kacchi', 'tehari', 'চা', 'খাবার', 'লাঞ্চ', 'ডিনার', 'নাস্তা', 'নাশতা', 'বিরিয়ানি', 'food', 'eat', 'meal', 'cafe', 'hotel']],
    ['Utilities', ['wifi', 'wi-fi', 'internet', 'electric', 'bidyut', 'বিদ্যুৎ', 'current bill', 'gas', 'গ্যাস', 'water', 'pani bill', 'পানি',
      'bill', 'বিল', 'recharge', 'রিচার্জ', 'flexiload', 'mobile data', 'data pack', 'broadband', 'utility', 'utilities', 'মোবাইল']],
    ['Transport', ['rickshaw', 'rikshaw', 'রিকশা', 'রিক্সা', 'bus', 'বাস', 'cng', 'uber', 'pathao', 'obhai', 'train', 'ট্রেন', 'launch', 'লঞ্চ', 'fare',
      'vara', 'bhara', 'ভাড়া', 'ticket', 'টিকিট', 'petrol', 'octane', 'fuel', 'taxi', 'bike', 'metro', 'transport', 'ride']],
    ['Shopping', ['watch', 'shirt', 'shoes', 'shoe', 'jama', 'জামা', 'kapor', 'কাপড়', 'cloth', 'dress', 'pant', 'jeans', 'shopping', 'daraz', 'kinlam',
      'কিনলাম', 'bag', 'gift', 'phone', 'headphone', 'laptop', 'sandal', 'jutar', 'juta', 'জুতা']],
    ['Health', ['medicine', 'oshudh', 'oushodh', 'ওষুধ', 'doctor', 'ডাক্তার', 'hospital', 'হাসপাতাল', 'test', 'pharmacy', 'dental', 'checkup', 'health']],
    ['Education', ['book', 'boi', 'বই', 'tuition', 'fee', 'course', 'semester', 'exam', 'পরীক্ষা', 'khata', 'কলম', 'kolom', 'class', 'udemy', 'admission',
      'print', 'photocopy']],
    ['Entertainment', ['movie', 'cinema', 'game', 'netflix', 'subscription', 'youtube', 'spotify', 'ghurte', 'ghura', 'ঘুরতে', 'trip', 'tour', 'party',
      'entertainment', 'concert']]
  ];
  const INCOME_RULES = [
    ['Salary', ['salary', 'beton', 'বেতন', 'wage', 'payroll', 'bonus']],
    ['Freelance', ['freelance', 'fiverr', 'upwork', 'client', 'project payment']],
    ['Business', ['bikri', 'bikree', 'বিক্রি', 'sell', 'sold', 'business', 'profit', 'লাভ', 'sale']],
    ['Gift', ['gift', 'eid', 'salami', 'সালামি', 'উপহার', 'upohar', 'baba', 'ma ', 'mom', 'dad']]
  ];

  const FILLER = new Set(['ajke', 'aj', 'ajk', 'today', 'yesterday', 'gotokal', 'goto', 'kal', 'korlam', 'korechi', 'kinlam', 'kinechi', 'dilam',
    'diyechi', 'pelam', 'pailam', 'paisi', 'peyechi', 'holo', 'hoyeche', 'ase', 'ta', 'ti', 'e', 'te', 'er', 'ke', 'theke', 'spent', 'paid', 'bought',
    'got', 'received', 'for', 'on', 'the', 'a', 'an', 'my', 'i', 'of', 'to', 'from', 'with', 'khoroch', 'ami', 'amar', 'amake', 'dia', 'diye',
    'আজকে', 'আজ', 'গতকাল', 'করলাম', 'কিনলাম', 'দিলাম', 'পেলাম', 'পেয়েছি', 'দিয়েছি', 'খরচ', 'আমি', 'আমার', 'দিয়ে', 'টা', 'টি', 'এর', 'থেকে',
    'porshu', 'parshu']);

  // ---------- helpers ----------
  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  const toAscii = (s) => s.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  const z2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + z2(d.getMonth() + 1) + '-' + z2(d.getDate());
  const hasAny = (text, list) => list.some((k) => text.includes(k));

  function protectNumbers(s) {
    let prev;
    do {
      prev = s;
      s = s.replace(/(\d),(\d{2,3})(?=\D|$)/g, '$1$2');
    } while (s !== prev);
    return s;
  }

  function splitSegments(text) {
    const padded = ' ' + text + ' ';
    return padded
      .split(/\s*(?:[,;।\n&+]|\s(?:and|ar|ebong|ebom|tarpor|then|এবং|আর|ও|তারপর)\s)\s*/i)
      .map((s) => s.trim().replace(/^(?:and|ar|ebong|ebom|tarpor|then|এবং|আর|ও|তারপর)\s+/i, ''))
      .filter(Boolean);
  }

  const AMOUNT_RE = /(\d+(?:\.\d+)?)\s*((?:k|hajar|hazar|hajaar|হাজার|lakh|lakhs|lac|লাখ)(?![a-zA-Z]))?\s*(takar|takay|taka|tk|টাকার|টাকায়|টাকা|৳|\/-)?/gi;
  const QTY_AFTER = /^\s*(ta|ti|টা|টি|khana|jon|jn|pcs|piece|pieces|ta\b)(?![a-z])/i;

  function mulOf(suffix) {
    if (!suffix) return 1;
    const s = suffix.toLowerCase();
    if (s === 'k') return 1000;
    if (/^(hajar|hazar|hajaar|হাজার)$/.test(s)) return 1000;
    return 1e5;
  }

  function digitAmounts(seg) {
    const found = [];
    let m;
    AMOUNT_RE.lastIndex = 0;
    while ((m = AMOUNT_RE.exec(seg))) {
      const after = seg.slice(m.index + m[0].length);
      if (!m[2] && !m[3] && QTY_AFTER.test(after)) continue; // "3 ta rickshaw"
      const before = seg.slice(0, m.index);
      const cur = !!m[3] || /(tk|taka|৳|টাকা)\s*$/i.test(before);
      found.push({ value: parseFloat(m[1]) * mulOf(m[2]), start: m.index, end: m.index + m[0].length, cur, big: !!m[2] });
    }
    return found;
  }

  function evalRun(run) {
    let total = 0, cur = 0, half = 0;
    for (const t of run) {
      if (t in HALF) { half = 0.5; continue; }
      if (t in SPECIAL) { cur += SPECIAL[t]; continue; }
      if (t in NUM_WORDS) { cur += NUM_WORDS[t] + half; half = 0; continue; }
      if (t in MULT) {
        const m = MULT[t];
        if (m >= 1000) { total += (cur || 1) * m; cur = 0; } else cur = (cur || 1) * m;
      }
    }
    return total + cur;
  }

  function wordAmount(tokens) {
    const isNum = (t) => t in NUM_WORDS || t in SPECIAL || t in HALF || t in MULT;
    let best = null;
    for (let i = 0; i < tokens.length; i++) {
      if (!isNum(tokens[i])) continue;
      let j = i;
      while (j + 1 < tokens.length && isNum(tokens[j + 1])) j++;
      const run = tokens.slice(i, j + 1);
      const hasMult = run.some((t) => t in MULT);
      const value = evalRun(run);
      const adjCur = CURRENCY_WORDS.has(tokens[j + 1]) || CURRENCY_WORDS.has(tokens[i - 1]);
      if (value > 0 && (hasMult || value >= 10 || adjCur)) {
        if (!best || value > best.value) best = { value, i, j };
      }
      i = j;
    }
    return best;
  }

  function detectType(low) {
    const inc = hasAny(low, INCOME_WORDS);
    const exp = hasAny(low, EXPENSE_VERBS);
    if (inc && !exp) return 'income';
    if (inc && exp) return hasAny(low, STRONG_INCOME) ? 'income' : 'expense';
    return 'expense';
  }

  function detectCategory(low, type) {
    const padded = ' ' + low + ' ';
    const rules = type === 'income' ? INCOME_RULES : EXPENSE_RULES;
    for (const [cat, words] of rules) {
      if (words.some((w) => padded.includes(w))) return cat;
    }
    return type === 'income' ? 'Other income' : 'Other';
  }

  function detectDate(low, now) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (/gotokal|goto kal|yesterday|গতকাল/.test(low)) d.setDate(d.getDate() - 1);
    else if (/porshu|parshu|পরশু/.test(low)) d.setDate(d.getDate() - 2);
    return iso(d);
  }

  function describe(seg, category, numberTokens) {
    const tokens = (toAscii(seg).toLowerCase().match(/[a-z]+|[ঀ-৿]+/g) || []);
    const drop = new Set(numberTokens || []);
    const out = tokens.filter((t) => !FILLER.has(t) && !CURRENCY_WORDS.has(t) && !drop.has(t) && !(t === 'k') && !(t in MULT && !drop.size && false));
    const words = out.slice(0, 4).join(' ');
    if (!words) return category;
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  // ---------- main ----------
  function parse(input, opts) {
    const now = (opts && opts.now) || new Date();
    let text = toAscii(String(input || '')).replace(/[“”"']/g, ' ');
    text = protectNumbers(text);
    const low = text.toLowerCase();
    const date = detectDate(low, now);
    const results = [];

    const segments = [];
    splitSegments(text).forEach((seg) => {
      // several amounts glued together without a delimiter: "chips 35 taka lunch 250"
      const amts = digitAmounts(seg);
      if (amts.length >= 2 && !/^\s*\d/.test(seg)) {
        let from = 0;
        amts.forEach((a, idx) => {
          const to = idx === amts.length - 1 ? seg.length : a.end;
          const part = seg.slice(from, to).trim();
          if (part) segments.push(part);
          from = to;
        });
      } else segments.push(seg);
    });

    for (const seg of segments) {
      const segLow = seg.toLowerCase();
      let amount = null;
      let numberTokens = [];
      const amts = digitAmounts(seg);
      if (amts.length) {
        const pick = amts.slice().sort((a, b) => (b.cur - a.cur) || (b.start - a.start))[0];
        amount = pick.value;
      } else {
        const tokens = segLow.match(/[a-z]+|[ঀ-৿]+/g) || [];
        const w = wordAmount(tokens);
        if (w) { amount = w.value; numberTokens = tokens.slice(w.i, w.j + 1); }
      }
      if (!amount || amount <= 0) continue;
      const type = detectType(segLow);
      const category = detectCategory(segLow, type);
      const cleaned = seg.replace(AMOUNT_RE, ' ');
      results.push({
        type,
        category,
        description: describe(cleaned, category, numberTokens),
        amount: Math.round(amount * 100) / 100,
        date
      });
    }
    return results;
  }

  return { parse, EXPENSE_CATEGORIES, INCOME_CATEGORIES, iso };
});
