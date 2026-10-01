(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const main = $('#main');
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

  let persona = store.get('crm-genie.persona') || 'admin';
  let META = null;
  let LOOKUPS = null;

  // ---------------------------------------------------------------- api
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Persona': persona, ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 204) return null;
    if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`; return new Promise(() => {}); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error?.message || res.statusText), { info: data.error || {}, status: res.status });
    return data;
  }

  // ---------------------------------------------------------------- formatting (US locale, as the trial org)
  const money = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  const num = (v) => (v === null || v === undefined || v === '' ? '' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
  const date = (v) => { if (!v) return ''; const [y, m, d] = String(v).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
  const dt = (v) => (v ? new Date(v).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' }) : '');
  function show(f, row) {
    const v = row[f.col];
    if (f.type === 'currency') return esc(money(v));
    if (f.type === 'number') return esc(num(v));
    if (f.type === 'date') return esc(date(v));
    if (f.type === 'datetime') return esc(dt(v));
    if (f.type === 'checkbox') return v ? '☑' : '☐';
    if (f.type === 'picklist' && v) return `<span class="pill ${esc(v)}">${esc(v)}</span>`;
    if (f.type === 'lookup') {
      const name = row._names?.[f.col];
      if (!v) return '';
      if (f.ref === 'account') return `<a href="#/accounts/${esc(v)}">${esc(name || v)}</a>`;
      return esc(name || v);
    }
    return esc(v);
  }
  const locked = '<span class="lock" title="No access for this profile">🔒 No access</span>';

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  function errBox(e) {
    const rule = e.info?.rule ? `<span class="enf">Enforced by Postgres · ${esc(e.info.rule)}</span>` : e.info?.kind ? `<span class="enf">${esc(e.info.kind)}</span>` : '';
    return `<div class="errbox" role="alert"><b>We hit a snag.</b><span>${esc(e.message)}</span>${rule}</div>`;
  }

  // ---------------------------------------------------------------- shell
  async function loadMeta() {
    META = await api('/api/meta');
    const sel = $('#persona');
    sel.innerHTML = Object.entries(META.personas).map(([k, p]) => `<option value="${k}">${esc(p.label)} · ${esc(p.note)}</option>`).join('');
    sel.value = persona;
    const u = META.user.name || '';
    const init = u.split(/[.@\s_-]+/).filter(Boolean).slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '?';
    $('#user').textContent = init;
    $('#user').title = u;
    const b = $('#banner');
    if (persona !== 'admin') {
      b.hidden = false;
      b.textContent = `Viewing as ${META.personas[persona].label}. Field access, sharing and validation rules are enforced by the database role compiled from this ${META.personas[persona].note.toLowerCase().startsWith('permission') ? 'permission set' : 'profile'}.`;
    } else b.hidden = true;
  }
  $('#signout').addEventListener('click', async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/login';
  });
  $('#persona').addEventListener('change', async (e) => {
    persona = e.target.value;
    store.set('crm-genie.persona', persona);
    await loadMeta();
    route();
  });
  async function lookups() {
    if (!LOOKUPS) LOOKUPS = await api('/api/lookups');
    return LOOKUPS;
  }

  function setTab(name) {
    document.querySelectorAll('.tabs a[data-tab]').forEach((a) => {
      if (a.dataset.tab === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
  }

  async function route() {
    const h = location.hash.replace(/^#\/?/, '') || 'home';
    const [a, b] = h.split('/');
    try {
      if (a === 'home') { setTab('home'); return await home(); }
      if (a === 'accounts' && b) { setTab('accounts'); return await account(b); }
      if (a === 'accounts') { setTab('accounts'); return await accounts(); }
      if (a === 'subscriptions' && b === 'new') { setTab('subscriptions'); return await newSubscription(); }
      if (a === 'subscriptions' && b) { setTab('subscriptions'); return await record(b); }
      if (a === 'subscriptions') { setTab('subscriptions'); return await list(); }
      if (a === 'parity') { setTab('parity'); return await parity(); }
      location.hash = '#/home';
    } catch (e) {
      main.innerHTML = errBox(e);
    }
  }
  window.addEventListener('hashchange', route);

  // ---------------------------------------------------------------- home
  async function home() {
    const d = await api('/api/home');
    const max = Math.max(...d.byStatus.map((s) => s.n), 1);
    main.innerHTML = `
      <div class="phead"><span class="picon">CG</span><span class="kind">Home</span><span class="acts"><a class="btn primary" href="#/subscriptions/new">New Subscription</a></span><h1>Subscription overview</h1></div>
      <div class="kpis">
        <div class="kpi"><span class="v">${money(d.kpi.active_mrr)}</span><span class="k">Active MRR · ${d.kpi.active} active subscriptions</span></div>
        <div class="kpi"><span class="v">${money(d.kpi.active_arr)}</span><span class="k">Active annual value</span></div>
        <div class="kpi"><span class="v">${d.kpi.renewals_30}</span><span class="k">Renewals in the next 30 days</span></div>
        <div class="kpi"><span class="v">${d.kpi.at_risk}</span><span class="k">Active and at risk (health below 50)</span></div>
      </div>
      <div class="grid2">
        <section class="card"><div class="card-head"><h2>Subscriptions by status</h2><span class="count">${d.kpi.total} total</span></div>
          <div class="card-body bars">${d.byStatus.map((s) => `<div class="bar"><span class="pill ${esc(s.status)}">${esc(s.status)}</span><span class="track"><span class="fill" style="display:block;width:${(s.n / max) * 100}%"></span></span><span class="n">${s.n} · ${money(s.mrr)}</span></div>`).join('')}</div></section>
        <section class="card"><div class="card-head"><h2>Upcoming renewals</h2></div>
          <div class="tablewrap"><table><thead><tr><th>Subscription</th><th>Account</th><th>End Date</th><th class="num">Days</th></tr></thead><tbody>
          ${d.renewals.map((r) => `<tr><td><a href="#/subscriptions/${esc(r.id)}">${esc(r.subscription_number)}</a></td><td>${esc(r.account)}</td><td>${date(r.end_date)}</td><td class="num">${num(r.days_to_renewal)}</td></tr>`).join('') || '<tr><td colspan="4" class="count">No upcoming renewals</td></tr>'}
          </tbody></table></div></section>
      </div>
      <section class="card"><div class="card-head"><h2>Recently modified</h2></div>
        <div class="tablewrap"><table><thead><tr><th>Subscription</th><th>Account</th><th>Status</th><th class="num">MRR</th><th>Last Modified</th></tr></thead><tbody>
        ${d.recent.map((r) => `<tr><td><a href="#/subscriptions/${esc(r.id)}">${esc(r.subscription_number)}</a></td><td>${esc(r.account)}</td><td><span class="pill ${esc(r.status)}">${esc(r.status)}</span></td><td class="num">${money(r.monthly_recurring_revenue)}</td><td>${dt(r.last_modified_date)}</td></tr>`).join('')}
        </tbody></table></div></section>`;
  }

  // ---------------------------------------------------------------- accounts
  async function accounts() {
    const d = await api('/api/accounts');
    main.innerHTML = `
      <div class="phead"><span class="picon">ACC</span><span class="kind">Accounts</span><span class="acts"></span><h1>All Accounts</h1></div>
      <section class="card"><div class="card-head"><span class="count">${d.rows.length} items</span></div>
        <div class="tablewrap"><table><thead><tr><th>Account Name</th><th class="num">Subscriptions</th><th class="num">Active</th><th class="num">Total Active MRR</th></tr></thead><tbody>
        ${d.rows.map((r) => `<tr><td><a href="#/accounts/${esc(r.id)}">${esc(r.name)}</a></td><td class="num">${r.subscriptions}</td><td class="num">${r.active}</td><td class="num">${money(r.total_active_mrr)}</td></tr>`).join('')}
        </tbody></table></div></section>`;
  }
  async function account(id) {
    const [a, subs] = await Promise.all([api(`/api/accounts/${encodeURIComponent(id)}`), api(`/api/subscriptions?account=${encodeURIComponent(id)}`)]);
    const sfLink = META.sfInstanceUrl ? `<a class="btn" href="${esc(META.sfInstanceUrl)}/lightning/r/Account/${esc(id)}/view" target="_blank" rel="noopener">Open in Salesforce ↗</a>` : '';
    main.innerHTML = `
      <p class="crumbs"><a href="#/accounts">Accounts</a><span>›</span><span>${esc(a.record.name)}</span></p>
      <div class="phead"><span class="picon">ACC</span><span class="kind">Account</span><span class="acts">${sfLink}</span><h1>${esc(a.record.name)}</h1>
        <div class="highlights"><div><span class="k">Salesforce Id</span><span class="v mono">${esc(id)}</span></div><div><span class="k">Subscriptions</span><span class="v">${subs.rows.length}</span></div></div></div>
      ${subsTable(subs, `Subscriptions (${subs.rows.length})`, `#/subscriptions/new?account=${encodeURIComponent(id)}`)}`;
  }

  // ---------------------------------------------------------------- subscriptions list
  const LIST_COLS = ['subscription_number', 'account_id', 'status', 'monthly_recurring_revenue', 'annual_value', 'days_to_renewal', 'line_count', 'total_line_value'];
  function subsTable(d, title, newHref = '#/subscriptions/new') {
    const fields = LIST_COLS.map((c) => META.subscription.fields.find((f) => f.col === c));
    const numeric = (f) => ['currency', 'number'].includes(f.type);
    return `<section class="card"><div class="card-head"><h2>${esc(title)}</h2><a class="btn sm" href="${newHref}">New</a></div>
      <div class="tablewrap"><table><thead><tr>${fields.map((f) => `<th class="${numeric(f) ? 'num' : ''}">${esc(f.label)}</th>`).join('')}</tr></thead><tbody>
      ${d.rows.map((r) => `<tr>${fields.map((f, k) => {
        const cell = d.fls[f.col].read ? (k === 0 ? `<a href="#/subscriptions/${esc(r.id)}">${show(f, r)}</a>` : show(f, r)) : locked;
        return `<td class="${numeric(f) ? 'num' : ''}">${cell}</td>`;
      }).join('')}</tr>`).join('') || `<tr><td colspan="${fields.length}" class="count">No records</td></tr>`}
      </tbody></table></div></section>`;
  }
  let listState = { status: '', q: '' };
  async function list() {
    const qs = new URLSearchParams();
    if (listState.status) qs.set('status', listState.status);
    if (listState.q) qs.set('q', listState.q);
    const d = await api(`/api/subscriptions?${qs}`);
    const statuses = META.subscription.fields.find((f) => f.col === 'status').values;
    main.innerHTML = `
      <div class="phead"><span class="picon">SUB</span><span class="kind">Subscriptions</span><span class="acts"><a class="btn primary" href="#/subscriptions/new">New</a></span><h1>${listState.status ? `${esc(listState.status)} Subscriptions` : 'All Subscriptions'}</h1></div>
      <section class="card">
        <div class="toolbar">
          <div class="chips" role="group" aria-label="Filter by status">
            <button type="button" data-st="" aria-pressed="${!listState.status}">All</button>
            ${statuses.map((s) => `<button type="button" data-st="${esc(s)}" aria-pressed="${listState.status === s}">${esc(s)}</button>`).join('')}
          </div>
          <input type="search" id="q" placeholder="Search number or account" value="${esc(listState.q)}" aria-label="Search subscriptions">
          <span class="count">${d.rows.length} items</span>
        </div>
      </section>
      ${subsTable(d, 'Subscriptions')}`;
    main.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => { listState.status = b.dataset.st; list(); }));
    const q = $('#q');
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') { listState.q = q.value.trim(); list(); } });
  }

  // ---------------------------------------------------------------- record page
  const DETAIL_ORDER = ['subscription_number', 'account_id', 'status', 'monthly_recurring_revenue', 'annual_value', 'start_date', 'end_date',
    'term_months', 'days_to_renewal', 'health_score', 'auto_renew', 'cancellation_reason', 'primary_contact_id', 'source_opportunity_id',
    'line_count', 'total_line_value', 'created_date', 'last_modified_date'];

  function input(f, value, lk) {
    const id = `f-${f.col}`;
    if (f.type === 'picklist') return `<select id="${id}" data-col="${f.col}">${f.values.map((v) => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
    if (f.type === 'checkbox') return `<input id="${id}" data-col="${f.col}" type="checkbox" ${value ? 'checked' : ''}>`;
    if (f.type === 'lookup') {
      const opts = lk[f.ref] || [];
      return `<select id="${id}" data-col="${f.col}"><option value="">--None--</option>${opts.map((o) => `<option value="${esc(o.id)}" ${o.id === value ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>`;
    }
    const type = f.type === 'date' ? 'date' : ['currency', 'number'].includes(f.type) ? 'number' : 'text';
    const step = f.type === 'currency' ? ' step="0.01"' : f.type === 'number' ? ' step="1"' : '';
    return `<input id="${id}" data-col="${f.col}" type="${type}"${step} value="${esc(value ?? '')}">`;
  }
  function fieldHtml(f, row, fls, editing, lk, errField) {
    const a = fls[f.col];
    const tag = f.formula ? '<span class="tag">Formula</span>' : f.rollup ? '<span class="tag">Roll-up</span>' : '';
    const lbl = `<label class="lbl" for="f-${f.col}">${f.required ? '<span class="req">*</span>' : ''}${esc(f.label)}${tag}</label>`;
    let val;
    if (!a.read) val = locked;
    else if (editing && a.edit) val = input(f, row[f.col], lk);
    else val = show(f, row) || '<span class="lock">&nbsp;</span>';
    const err = errField === f.col;
    return `<div class="field ${err ? 'err' : ''}">${lbl}<div class="val">${val}</div>${err ? '<span class="msg" id="field-msg"></span>' : ''}</div>`;
  }

  async function record(id, opts = {}) {
    const [d, lk] = await Promise.all([api(`/api/subscriptions/${encodeURIComponent(id)}`), lookups()]);
    const r = d.record;
    const F = (c) => META.subscription.fields.find((f) => f.col === c);
    const editing = !!opts.editing;
    const canEdit = Object.values(d.fls).some((x) => x.edit);
    const sfLink = META.sfInstanceUrl ? `<a class="btn" href="${esc(META.sfInstanceUrl)}/lightning/r/Subscription__c/${esc(r.id)}/view" target="_blank" rel="noopener">Open in Salesforce ↗</a>` : '';
    const statuses = F('status').values;
    const cur = r.status;
    const hl = (c) => (d.fls[c].read ? show(F(c), r) : locked);
    main.innerHTML = `
      <p class="crumbs"><a href="#/subscriptions">Subscriptions</a><span>›</span><span>${esc(r.subscription_number ?? r.id)}</span></p>
      <div class="phead"><span class="picon">SUB</span><span class="kind">Subscription</span>
        <span class="acts">${sfLink}${canEdit && !editing ? '<button class="btn" type="button" id="edit">Edit</button>' : ''}<button class="btn danger" type="button" id="del">Delete</button></span>
        <h1>${esc(r.subscription_number ?? r.id)}</h1>
        <div class="highlights">
          <div><span class="k">Account</span><span class="v">${hl('account_id')}</span></div>
          <div><span class="k">Status</span><span class="v">${hl('status')}</span></div>
          <div><span class="k">MRR</span><span class="v">${hl('monthly_recurring_revenue')}</span></div>
          <div><span class="k">Annual Value</span><span class="v">${hl('annual_value')}</span></div>
          <div><span class="k">Days To Renewal</span><span class="v">${hl('days_to_renewal')}</span></div>
          <div><span class="k">Salesforce Id</span><span class="v mono">${esc(r.id)}</span></div>
        </div>
      </div>
      ${d.fls.status.read ? `<div class="path" aria-label="Status path">${statuses.map((s) => `<span class="${s === cur ? `cur ${s === 'Cancelled' ? 'bad' : ''}` : ''}">${esc(s)}</span>`).join('')}</div>` : ''}
      <div id="err"></div>
      <div class="rec">
        <section class="card" aria-label="Details">
          <div class="card-head"><h2>Details</h2>${editing ? '<span class="count">Editing</span>' : ''}</div>
          <div class="card-body"><div class="fields">${DETAIL_ORDER.map((c) => fieldHtml(F(c), r, d.fls, editing, lk, opts.errField)).join('')}</div></div>
          ${editing ? '<div class="formactions"><button class="btn" type="button" id="cancel">Cancel</button><button class="btn primary" type="button" id="save">Save</button></div>' : ''}
        </section>
        <div class="side">${linesCard(d, lk)}</div>
      </div>`;
    if (opts.error) {
      $('#err').innerHTML = errBox(opts.error);
      const m = $('#field-msg');
      if (m) m.textContent = opts.error.message;
    }

    $('#edit')?.addEventListener('click', () => record(id, { editing: true }));
    $('#cancel')?.addEventListener('click', () => record(id));
    $('#save')?.addEventListener('click', async () => {
      const body = {};
      main.querySelectorAll('.fields [data-col]').forEach((el) => {
        const col = el.dataset.col;
        const v = el.type === 'checkbox' ? el.checked : el.value;
        const before = r[col];
        const norm = (x) => (x === null || x === undefined ? '' : String(x));
        if (el.type === 'checkbox' ? v !== !!before : norm(v) !== norm(before) && !(el.type === 'number' && Number(v) === Number(before) && v !== '')) body[col] = v;
      });
      try {
        await api(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'PATCH', body });
        toast(`Subscription "${r.subscription_number}" was saved.`);
        record(id);
      } catch (e) {
        // keep the user's edits visible: re-render in edit mode with the values they typed
        const draft = { ...r, ...body };
        await recordWithDraft(id, draft, e);
      }
    });
    $('#del').addEventListener('click', async () => {
      const b = $('#del');
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm delete'; return; }
      try {
        await api(`/api/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
        toast(`Subscription "${r.subscription_number}" was deleted.`);
        location.hash = '#/subscriptions';
      } catch (e) { $('#err').innerHTML = errBox(e); }
    });
    wireLines(id, d);
  }
  async function recordWithDraft(id, draft, error) {
    await record(id, { editing: true, error, errField: error.info?.field });
    main.querySelectorAll('.fields [data-col]').forEach((el) => {
      const v = draft[el.dataset.col];
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
  }

  function linesCard(d, lk) {
    const L = META.line.fields;
    const F = (c) => L.find((f) => f.col === c);
    const cols = ['line_number', 'product_id', 'quantity', 'unit_price', 'line_total'].map(F);
    const fl = d.lineFls;
    const canAdd = fl.quantity.create && fl.unit_price.create;
    const canEdit = fl.quantity.edit;
    return `<section class="card related" aria-label="Subscription Lines">
      <div class="card-head"><h2>Subscription Lines (${d.lines.length})</h2></div>
      <div id="lerr" style="padding:0 16px"></div>
      <div class="tablewrap"><table><thead><tr>${cols.map((f) => `<th class="${['currency', 'number'].includes(f.type) ? 'num' : ''}">${esc(f.label)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${d.lines.map((l) => `<tr>${cols.map((f) => `<td class="${['currency', 'number'].includes(f.type) ? 'num' : ''}">${fl[f.col].read ? show(f, l) : locked}</td>`).join('')}
        <td class="num">${canEdit ? `<button class="btn sm" type="button" data-inc="${esc(l.id)}" data-q="${esc(l.quantity)}" aria-label="Add one to quantity of ${esc(l.line_number)}">+1</button>` : ''}<button class="btn sm danger" type="button" data-ldel="${esc(l.id)}" aria-label="Delete ${esc(l.line_number)}">Delete</button></td></tr>`).join('') || `<tr><td colspan="${cols.length + 1}" class="count">No lines</td></tr>`}
      </tbody></table></div>
      ${canAdd ? `<div class="addline">
        <label>Product<select id="l-product"><option value="">--None--</option>${(lk.product2 || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label>
        <label>Quantity<input id="l-qty" type="number" step="1" value="1"></label>
        <label>Unit Price<input id="l-price" type="number" step="0.01" value="100"></label>
        <button class="btn" type="button" id="l-add">Add line</button></div>` : ''}
    </section>`;
  }
  function wireLines(id, d) {
    const fail = (e) => { $('#lerr').innerHTML = errBox(e); };
    $('#l-add')?.addEventListener('click', async () => {
      try {
        await api(`/api/subscriptions/${encodeURIComponent(id)}/lines`, { method: 'POST', body: { product_id: $('#l-product').value, quantity: $('#l-qty').value, unit_price: $('#l-price').value } });
        toast('Subscription line was created.');
        record(id);
      } catch (e) { fail(e); }
    });
    main.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/lines/${encodeURIComponent(b.dataset.inc)}`, { method: 'PATCH', body: { quantity: Number(b.dataset.q) + 1 } });
        toast('Subscription line was saved.');
        record(id);
      } catch (e) { fail(e); }
    }));
    main.querySelectorAll('[data-ldel]').forEach((b) => b.addEventListener('click', async () => {
      if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Confirm'; return; }
      try {
        await api(`/api/lines/${encodeURIComponent(b.dataset.ldel)}`, { method: 'DELETE' });
        toast('Subscription line was deleted.');
        record(id);
      } catch (e) { fail(e); }
    }));
  }

  // ---------------------------------------------------------------- new subscription
  async function newSubscription() {
    const lk = await lookups();
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const fls = META.subscription.fls;
    const fields = META.subscription.fields.filter((f) => fls[f.col].create);
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);
    const draft = { status: 'Draft', account_id: params.get('account') || '', start_date: today, end_date: nextYear, term_months: 12, auto_renew: false };
    main.innerHTML = `
      <p class="crumbs"><a href="#/subscriptions">Subscriptions</a><span>›</span><span>New</span></p>
      <div class="phead"><span class="picon">SUB</span><span class="kind">Subscription</span><span class="acts"></span><h1>New Subscription</h1></div>
      <div id="err"></div>
      <section class="card">
        ${fields.length ? `<div class="card-body"><div class="fields">${fields.map((f) => `<div class="field" data-f="${f.col}"><label class="lbl" for="f-${f.col}">${f.required ? '<span class="req">*</span>' : ''}${esc(f.label)}</label><div class="val">${input(f, draft[f.col] ?? f.dflt ?? '', lk)}</div></div>`).join('')}</div></div>
        <div class="formactions"><a class="btn" href="#/subscriptions">Cancel</a><button class="btn primary" type="button" id="save">Save</button></div>`
        : '<div class="card-body"><p class="count">This profile cannot create subscriptions.</p></div>'}
      </section>`;
    $('#save')?.addEventListener('click', async () => {
      const body = {};
      main.querySelectorAll('.fields [data-col]').forEach((el) => { body[el.dataset.col] = el.type === 'checkbox' ? el.checked : el.value; });
      main.querySelectorAll('.field').forEach((x) => x.classList.remove('err'));
      try {
        const r = await api('/api/subscriptions', { method: 'POST', body });
        toast('Subscription was created.');
        location.hash = `#/subscriptions/${r.id}`;
      } catch (e) {
        $('#err').innerHTML = errBox(e);
        if (e.info?.field) main.querySelector(`[data-f="${e.info.field}"]`)?.classList.add('err');
      }
    });
  }

  // ---------------------------------------------------------------- parity
  async function parity() {
    const d = await api('/api/parity');
    const total = d.fields.reduce((a, f) => a + f.total, 0);
    const matched = d.fields.reduce((a, f) => a + f.matched, 0);
    main.innerHTML = `
      <div class="phead"><span class="picon">=</span><span class="kind">Parity</span><span class="acts"></span><h1>Salesforce vs CRM Genie</h1>
        <div class="highlights">
          <div><span class="k">Values matched</span><span class="v">${matched} / ${total}</span></div>
          <div><span class="k">Loaded</span><span class="v">${d.run ? dt(d.run.loaded_at) : '—'}</span></div>
          <div><span class="k">Blueprint</span><span class="v mono">${d.run ? esc(d.run.blueprint_hash.slice(0, 12)) : '—'}</span></div>
          <div><span class="k">TODAY() evaluated as of</span><span class="v">${d.asOf ? date(d.asOf) : '—'}</span></div>
        </div></div>
      <section class="card"><div class="card-head"><h2>Formula and roll-up values: stored by Salesforce at export, computed live by this database</h2></div>
        <div class="tablewrap"><table><thead><tr><th>Object</th><th>Field</th><th>Compiled as</th><th class="num">Matched</th></tr></thead><tbody>
        ${d.fields.map((f) => `<tr><td class="mono">${esc(f.sobject)}</td><td class="mono">${esc(f.api)}</td><td>${esc(f.strategy)}</td><td class="num"><span class="match ${f.matched === f.total ? 'ok' : 'no'}">${f.matched} / ${f.total}</span></td></tr>`).join('')}
        </tbody></table></div></section>
      ${d.run ? `<section class="card"><div class="card-head"><h2>Data loaded from the org export</h2></div><div class="card-body"><p class="mono">${esc(Object.entries(d.run.loaded).map(([k, v]) => `${k} ${v}`).join(' · '))}</p></div></section>` : ''}`;
  }

  // ---------------------------------------------------------------- boot
  (async () => {
    try {
      await loadMeta();
      route();
    } catch (e) {
      main.innerHTML = errBox(e);
    }
  })();
})();
