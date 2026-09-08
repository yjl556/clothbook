/* 服装记账 - 前端逻辑（原生 JS，无构建） */
(function () {
  'use strict';

  var state = {
    user: null,
    users: [],
    products: [],
    records: [],
    stats: null,
    logs: [],
    filters: { user: '', type: '', status: '', month: '' },
    editId: null,
    editType: 'ship',
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(cents) { return '¥' + (cents / 100).toFixed(2); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(s) { return s || '-'; }
  function uid() { return state.user ? (state.user.display_name || state.user.username) : ''; }
  function isAdmin() { return state.user && state.user.role === 'admin'; }

  // ---------- Toast ----------
  var toastTimer = null;
  function toast(msg, isError) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast hidden'; }, 2600);
  }

  // ---------- API ----------
  function api(path, opts) {
    opts = opts || {};
    return fetch(path, Object.assign({
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
    }, opts, { headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}) }))
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (res.status === 401) { showLogin(); throw new Error('未登录'); }
          if (!res.ok) throw new Error(data.error || '请求失败(' + res.status + ')');
          return data;
        });
      });
  }

  // ---------- 视图切换 ----------
  function showLogin() {
    state.user = null;
    $('#view-login').classList.remove('hidden');
    $('#view-main').classList.add('hidden');
    $('#login-username').value = '';
    $('#login-password').value = '';
    $('#login-msg').textContent = '';
    setTimeout(function () { $('#login-username').focus(); }, 50);
  }

  function showMain() {
    $('#view-login').classList.add('hidden');
    $('#view-main').classList.remove('hidden');
    $('#whoami').textContent = (state.user.display_name || state.user.username) + (isAdmin() ? '（管理员）' : '');
    var navAdmin = $('#nav-admin');
    if (isAdmin()) navAdmin.classList.remove('hidden'); else navAdmin.classList.add('hidden');
    switchTab(state.currentTab || 'add');
  }

  var TABS = ['add', 'records', 'stats', 'admin', 'me'];
  function switchTab(name) {
    state.currentTab = name;
    TABS.forEach(function (t) {
      var panel = $('#panel-' + t);
      if (panel) panel.classList.toggle('hidden', t !== name);
    });
    $$('#bottom-nav .tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    if (name === 'records') renderRecords();
    if (name === 'stats') renderStats();
    if (name === 'admin') { renderAdmin(); }
    if (name === 'me') renderMe();
    if (name === 'add') renderAddForm();
    window.scrollTo(0, 0);
  }

  // ---------- 数据加载 ----------
  function loadAll() {
    return Promise.all([
      api('/api/products'),
      api('/api/users').catch(function () { return { users: [] }; }), // 普通用户无权限时给空
      api('/api/records'),
      api('/api/stats'),
    ]).then(function (res) {
      state.products = res[0].products;
      state.users = res[1].users;
      state.records = res[2].records;
      state.stats = res[3];
      if (isAdmin()) {
        api('/api/logs').then(function (d) { state.logs = d.logs; }).catch(function () {});
      }
    });
  }

  function refresh(parts) {
    parts = parts || ['records', 'stats'];
    var ps = [];
    if (parts.indexOf('products') > -1) ps.push(api('/api/products').then(function (d) { state.products = d.products; }));
    if (parts.indexOf('users') > -1) ps.push(api('/api/users').catch(function () { return { users: [] }; }).then(function (d) { state.users = d.users; }));
    if (parts.indexOf('records') > -1) ps.push(api('/api/records').then(function (d) { state.records = d.records; }));
    if (parts.indexOf('stats') > -1) ps.push(api('/api/stats').then(function (d) { state.stats = d; }));
    if (parts.indexOf('logs') > -1) ps.push(api('/api/logs').catch(function () { return { logs: [] }; }).then(function (d) { state.logs = d.logs; }));
    return Promise.all(ps);
  }

  // ---------- 登录 ----------
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#login-btn');
    btn.disabled = true; btn.textContent = '登录中…';
    api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#login-username').value.trim(), password: $('#login-password').value }),
    }).then(function (d) {
      state.user = d.user;
      return loadAll();
    }).then(function () {
      showMain();
      toast('欢迎，' + uid());
    }).catch(function (err) {
      $('#login-msg').textContent = err.message;
      toast(err.message, true);
    }).finally(function () {
      btn.disabled = false; btn.textContent = '登 录';
    });
  });

  // ---------- 退出 ----------
  $('#logout-btn').addEventListener('click', function () {
    api('/api/logout', { method: 'POST' }).catch(function () {}).finally(function () { showLogin(); });
  });

  // ---------- 底部导航 ----------
  $('#bottom-nav').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (btn) switchTab(btn.getAttribute('data-tab'));
  });

  // ---------- 记账表单 ----------
  var addType = 'ship';
  $('#type-seg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn');
    if (!b) return;
    addType = b.getAttribute('data-type');
    $$('#type-seg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    updateAmountPreview();
  });

  function productPrice(code) {
    var p = state.products.filter(function (x) { return x.product_code === code; })[0];
    return p ? p.price_cents : null;
  }

  function updateAmountPreview(editMode) {
    var isEdit = !!editMode;
    var qtyEl = isEdit ? $('#e-qty') : $('#f-qty');
    var prodEl = isEdit ? $('#e-product') : $('#f-product');
    var hintEl = isEdit ? $('#e-price-hint') : $('#price-hint');
    var amountEl = isEdit ? $('#e-amount') : $('#amount-value');
    var detailEl = isEdit ? $('#e-amount-detail') : $('#amount-detail');
    var labelEl = $('#amount-label');
    var type = isEdit ? state.editType : addType;

    var code = prodEl.value;
    var qty = parseInt(qtyEl.value, 10);
    if (!qty || qty < 1) qty = 1;
    var price = productPrice(code);
    var label = type === 'ship' ? '应收金额（含运费）' : '退款金额（不退运费）';
    if (labelEl) labelEl.textContent = label;

    if (price === null) {
      hintEl.textContent = code ? '请先在「管理-货号」中添加该货号' : '暂无货号，请管理员先在「管理-货号」中添加';
      amountEl.textContent = '¥0.00';
      detailEl.textContent = '';
      return;
    }
    hintEl.textContent = '单价 ¥' + (price / 100).toFixed(2);
    var shipping = type === 'ship' ? 500 : 0;
    var amount = qty * price + shipping;
    amountEl.textContent = money(amount);
    detailEl.textContent = type === 'ship'
      ? (qty + ' 条 × ¥' + (price / 100).toFixed(2) + ' + 运费 ¥5.00')
      : (qty + ' 条 × ¥' + (price / 100).toFixed(2) + '（退货不退运费）');
  }

  function renderAddForm() {
    var userSel = $('#f-user');
    var prodSel = $('#f-product');
    var curU = userSel.value;
    var curP = prodSel.value;
    var curQ = $('#f-qty').value;
    var curN = $('#f-note').value;
    var curD = $('#f-date').value;
    userSel.innerHTML = state.users.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.display_name || u.username) + (u.role === 'admin' ? '（管理员）' : '') + '</option>';
    }).join('');
    if (curU) userSel.value = curU;
    if (!userSel.value && state.user) {
      var me = state.users.filter(function (u) { return u.id === state.user.id; })[0];
      if (me) userSel.value = me.id;
    }
    prodSel.innerHTML = state.products.map(function (p) {
      return '<option value="' + esc(p.product_code) + '">' + esc(p.product_code) + (p.name ? ' ' + esc(p.name) : '') + '（¥' + (p.price_cents / 100).toFixed(2) + '）</option>';
    }).join('');
    if (curP) prodSel.value = curP;
    if (curQ) $('#f-qty').value = curQ;
    if (curN) $('#f-note').value = curN;
    if (curD) $('#f-date').value = curD;
    if (!$('#f-date').value) $('#f-date').value = todayStr();
    updateAmountPreview(false);
  }

  $('#add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#add-submit');
    btn.disabled = true;
    var body = {
      type: addType,
      user_id: Number($('#f-user').value),
      product_code: $('#f-product').value,
      quantity: Number($('#f-qty').value),
      record_date: $('#f-date').value || todayStr(),
      note: $('#f-note').value.trim(),
    };
    api('/api/records', { method: 'POST', body: JSON.stringify(body) })
      .then(function () {
        toast(addType === 'ship' ? '发货记录已保存' : '退货记录已保存');
        $('#f-qty').value = '1';
        $('#f-note').value = '';
        $('#add-msg').textContent = '';
        return refresh(['records', 'stats']);
      })
      .catch(function (err) { $('#add-msg').textContent = err.message; toast(err.message, true); })
      .finally(function () { btn.disabled = false; });
  });

  // ---------- 记录列表 ----------
  function typeLabel(t) { return t === 'ship' ? '发货' : '退货'; }
  function statusLabel(r) {
    return r.status === 'settled' ? (r.type === 'ship' ? '已结算' : '已退款') : (r.type === 'ship' ? '未结算' : '未退款');
  }

  function recordCard(r) {
    var canEdit = isAdmin() || (state.user && r.created_by === state.user.id);
    var canToggle = isAdmin();
    var actions = '';
    if (canToggle) {
      var next = r.status === 'settled' ? 'unsettled' : 'settled';
      var nextLabel = r.type === 'ship' ? (next === 'settled' ? '结算' : '取消结算') : (next === 'settled' ? '退款' : '取消退款');
      actions += '<button class="primary" data-act="toggle" data-id="' + r.id + '">' + nextLabel + '</button>';
    }
    if (canEdit) {
      actions += '<button data-act="edit" data-id="' + r.id + '">编辑</button>';
      actions += '<button class="del" data-act="del" data-id="' + r.id + '">删除</button>';
    }
    var shipDetail = r.type === 'ship' ? '（含运费 ¥5）' : '';
    return '' +
      '<div class="item">' +
      '  <div class="row">' +
      '    <div class="left">' +
      '      <div class="date">' + fmtDate(r.record_date) + ' · 记录人：' + esc(r.creator_name || '—') + '</div>' +
      '      <div class="main">' + esc(r.product_code) + (r.note ? ' <small>' + esc(r.note) + '</small>' : '') + '</div>' +
      '      <div class="sub">' + esc(r.user_name || '（已删除成员）') + ' · ' + typeLabel(r.type) + ' ×' + r.quantity + '条</div>' +
      '    </div>' +
      '    <div class="right">' +
      '      <div class="amount ' + (r.type === 'return' ? 'return' : '') + '">' + money(r.amount_cents) + '</div>' +
      '      <div><span class="badge ' + r.type + '">' + typeLabel(r.type) + '</span> <span class="badge ' + r.status + '">' + statusLabel(r) + '</span></div>' +
      '    </div>' +
      '  </div>' +
      (shipDetail ? '<div class="sub" style="margin-top:4px;">' + shipDetail + '</div>' : '') +
      (actions ? '<div class="actions">' + actions + '</div>' : '') +
      '</div>';
  }

  function renderRecords() {
    var list = state.records;
    var f = state.filters;
    if (f.user) list = list.filter(function (r) { return String(r.user_id) === f.user; });
    if (f.type) list = list.filter(function (r) { return r.type === f.type; });
    if (f.status) list = list.filter(function (r) { return r.status === f.status; });
    if (f.month) list = list.filter(function (r) { return r.record_date.indexOf(f.month) === 0; });

    var usersSel = $('#r-user');
    var prevUser = usersSel.value;
    usersSel.innerHTML = '<option value="">全部成员</option>' + state.users.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.display_name || u.username) + '</option>';
    }).join('');
    if (prevUser) usersSel.value = prevUser;
    else if (f.user && state.users.some(function (u) { return String(u.id) === f.user; })) usersSel.value = f.user;
    $('#records-list').innerHTML = list.length
      ? list.map(recordCard).join('')
      : '<div class="empty">暂无记录</div>';
  }

  // 记录操作（事件委托）
  $('#records-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-act]');
    if (!btn) return;
    var id = Number(btn.getAttribute('data-id'));
    var act = btn.getAttribute('data-act');
    var rec = state.records.filter(function (r) { return r.id === id; })[0];
    if (!rec) return;

    if (act === 'toggle') {
      var next = rec.status === 'settled' ? 'unsettled' : 'settled';
      var label = rec.type === 'ship' ? (next === 'settled' ? '标记已结算' : '标记未结算') : (next === 'settled' ? '标记已退款' : '标记未退款');
      if (!confirm('确定把该记录「' + label + '」？')) return;
      api('/api/records/' + id, { method: 'PUT', body: JSON.stringify({ status: next }) })
        .then(function () { toast('已更新'); return refresh(['records', 'stats', 'logs']); })
        .catch(function (err) { toast(err.message, true); });
    } else if (act === 'edit') {
      openEditModal(rec);
    } else if (act === 'del') {
      if (!confirm('确定删除这条记录？此操作不可恢复。')) return;
      api('/api/records/' + id, { method: 'DELETE' })
        .then(function () { toast('已删除'); return refresh(['records', 'stats', 'logs']); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  // ---------- 记录筛选 ----------
  ['r-user', 'r-type', 'r-status'].forEach(function (id) {
    $('#' + id).addEventListener('change', function () {
      state.filters[id.replace('r-', '')] = this.value;
      renderRecords();
    });
  });
  $('#r-month').addEventListener('change', function () { state.filters.month = this.value; renderRecords(); });
  $('#r-reset').addEventListener('click', function () {
    state.filters = { user: '', type: '', status: '', month: '' };
    $('#r-user').value = ''; $('#r-type').value = ''; $('#r-status').value = ''; $('#r-month').value = '';
    renderRecords();
  });

  // ---------- 编辑弹窗 ----------
  function openEditModal(rec) {
    state.editId = rec.id;
    state.editType = rec.type;
    $('#modal').classList.remove('hidden');
    $('#modal-title').textContent = '编辑记录 #' + rec.id;
    $('#e-id').value = rec.id;
    $('#e-user').innerHTML = state.users.map(function (u) {
      return '<option value="' + u.id + '">' + esc(u.display_name || u.username) + '</option>';
    }).join('');
    $('#e-user').value = rec.user_id;
    var opts = state.products.map(function (p) {
      return '<option value="' + esc(p.product_code) + '">' + esc(p.product_code) + '（¥' + (p.price_cents / 100).toFixed(2) + '）</option>';
    });
    if (!state.products.some(function (p) { return p.product_code === rec.product_code; })) {
      opts.push('<option value="' + esc(rec.product_code) + '">' + esc(rec.product_code) + '（原单价 ¥' + (rec.unit_price_cents / 100).toFixed(2) + '，已停用）</option>');
    }
    $('#e-product').innerHTML = opts.join('');
    $('#e-product').value = rec.product_code;
    $('#e-qty').value = rec.quantity;
    $('#e-date').value = rec.record_date;
    $('#e-note').value = rec.note;
    $$('#edit-type-seg .seg-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-type') === rec.type);
    });
    updateAmountPreview(true);
    $('#edit-msg').textContent = '';
  }

  $('#edit-type-seg').addEventListener('click', function (e) {
    var b = e.target.closest('.seg-btn');
    if (!b) return;
    state.editType = b.getAttribute('data-type');
    $$('#edit-type-seg .seg-btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    updateAmountPreview(true);
  });
  $('#e-qty').addEventListener('input', function () { updateAmountPreview(true); });
  $('#e-product').addEventListener('change', function () { updateAmountPreview(true); });

  $('#modal-cancel').addEventListener('click', function () {
    $('#modal').classList.add('hidden');
    state.editId = null;
  });

  $('#edit-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = state.editId;
    var body = {
      type: state.editType,
      user_id: Number($('#e-user').value),
      product_code: $('#e-product').value,
      quantity: Number($('#e-qty').value),
      record_date: $('#e-date').value,
      note: $('#e-note').value.trim(),
    };
    api('/api/records/' + id, { method: 'PUT', body: JSON.stringify(body) })
      .then(function () {
        toast('已保存修改');
        $('#modal').classList.add('hidden');
        state.editId = null;
        return refresh(['records', 'stats', 'logs']);
      })
      .catch(function (err) { $('#edit-msg').textContent = err.message; toast(err.message, true); });
  });

  // ---------- 统计 ----------
  function sumItem(k, v, cls) {
    return '<div class="sum-item"><div class="k">' + k + '</div><div class="v ' + (cls || '') + '">' + v + '</div></div>';
  }

  function renderStats() {
    if (!state.stats) return;
    var t = state.stats.total;
    $('#team-summary').innerHTML =
      '<h3 style="font-size:15px;margin-bottom:10px;">团队合计</h3>' +
      '<div class="summary-grid">' +
      sumItem('发货条数', t.ship_qty + ' 条') +
      sumItem('发货金额', money(t.ship_amount)) +
      sumItem('已结算', money(t.ship_settled), 'ok') +
      sumItem('未结算', money(t.ship_unsettled), 'warn') +
      sumItem('退货条数', t.return_qty + ' 条') +
      sumItem('退货金额', money(t.return_amount)) +
      sumItem('已退货款', money(t.return_settled), 'ok') +
      sumItem('未退货款', money(t.return_unsettled), 'warn') +
      sumItem('还没收回的钱', money(t.outstanding), 'warn') +
      '</div>' +
      '<p style="font-size:12px;color:var(--text2);margin-top:8px;">还没收回的钱 = 未结算货款 + 未退款的退货金额</p>';

    $('#stats-list').innerHTML = state.stats.users.map(function (u) {
      return '' +
        '<div class="user-card">' +
        '  <div class="head">' +
        '    <span class="name">' + esc(u.display_name) + '</span>' +
        '    <span class="out">还没收回：<b>' + money(u.outstanding) + '</b></span>' +
        '  </div>' +
        '  <div class="stats">' +
        '    <div>发货 <b>' + u.ship_qty + '</b> 条（' + u.ship_count + ' 笔）</div>' +
        '    <div>发货金额 <b>' + money(u.ship_amount) + '</b></div>' +
        '    <div>已结算 <b class="ok" style="color:var(--green);">' + money(u.ship_settled) + '</b></div>' +
        '    <div>未结算 <b style="color:var(--red);">' + money(u.ship_unsettled) + '</b></div>' +
        '    <div>退货 <b>' + u.return_qty + '</b> 条（' + u.return_count + ' 笔）</div>' +
        '    <div>退款金额 <b>' + money(u.return_amount) + '</b></div>' +
        '    <div>已退款 <b style="color:var(--green);">' + money(u.return_settled) + '</b></div>' +
        '    <div>未退款 <b style="color:var(--red);">' + money(u.return_unsettled) + '</b></div>' +
        '  </div>' +
        '  <button type="button" class="link" data-user="' + u.user_id + '">查看 ' + esc(u.display_name) + ' 的发退货记录 →</button>' +
        '</div>';
    }).join('') || '<div class="empty">暂无成员</div>';
  }

  // 统计页：查看某人记录 → 跳到记录页并筛选
  $('#stats-list').addEventListener('click', function (e) {
    var link = e.target.closest('button[data-user]');
    if (!link) return;
    var uid2 = link.getAttribute('data-user');
    state.filters = { user: uid2, type: '', status: '', month: '' };
    $('#r-user').value = uid2;
    $('#r-type').value = ''; $('#r-status').value = ''; $('#r-month').value = '';
    switchTab('records');
  });

  // ---------- 管理 ----------
  $('#admin-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('.atab');
    if (!b) return;
    var at = b.getAttribute('data-atab');
    $$('#admin-tabs .atab').forEach(function (x) { x.classList.toggle('active', x === b); });
    ['products', 'users', 'logs'].forEach(function (t) {
      $('#apanel-' + t).classList.toggle('hidden', t !== at);
    });
  });

  function renderAdmin() {
    if (!isAdmin()) return;
    renderProducts();
    renderUsers();
    renderLogs();
  }

  // 货号
  function renderProducts() {
    $('#product-list').innerHTML = state.products.map(function (p) {
      return '' +
        '<div class="table-row">' +
        '  <div class="info"><div class="t">' + esc(p.product_code) + (p.name ? ' · ' + esc(p.name) : '') + '</div>' +
        '  <div class="s">单价 ¥' + (p.price_cents / 100).toFixed(2) + '</div></div>' +
        '  <div class="ops">' +
        '    <button data-pact="edit" data-id="' + p.id + '" data-code="' + esc(p.product_code) + '" data-name="' + esc(p.name) + '" data-price="' + (p.price_cents / 100).toFixed(2) + '">改价</button>' +
        '    <button class="del" data-pact="del" data-id="' + p.id + '">删除</button>' +
        '  </div>' +
        '</div>';
    }).join('') || '<div class="empty">还没有货号，先在上面添加</div>';
  }

  $('#product-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        product_code: $('#p-code').value.trim(),
        name: $('#p-name').value.trim(),
        price: $('#p-price').value,
      }),
    }).then(function () {
      $('#p-code').value = ''; $('#p-name').value = ''; $('#p-price').value = '';
      $('#product-msg').textContent = ''; $('#product-msg').className = 'msg';
      toast('货号已添加');
      return refresh(['products', 'logs']);
    }).catch(function (err) {
      $('#product-msg').textContent = err.message; $('#product-msg').className = 'msg';
      toast(err.message, true);
    });
  });

  $('#product-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-pact]');
    if (!btn) return;
    var id = Number(btn.getAttribute('data-id'));
    var pact = btn.getAttribute('data-pact');
    if (pact === 'edit') {
      var price = prompt('修改单价（元），例如 39.9：', btn.getAttribute('data-price'));
      if (price === null) return;
      api('/api/products/' + id, { method: 'PUT', body: JSON.stringify({ price: price }) })
        .then(function () { toast('单价已更新'); return refresh(['products', 'logs']); })
        .catch(function (err) { toast(err.message, true); });
    } else if (pact === 'del') {
      if (!confirm('确定删除货号 ' + btn.getAttribute('data-code') + '？（历史记录不受影响）')) return;
      api('/api/products/' + id, { method: 'DELETE' })
        .then(function () { toast('已删除'); return refresh(['products', 'logs']); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  // 用户
  function renderUsers() {
    $('#user-list').innerHTML = state.users.map(function (u) {
      var isMe = state.user && u.id === state.user.id;
      return '' +
        '<div class="table-row">' +
        '  <div class="info"><div class="t">' + esc(u.display_name || u.username) + (u.role === 'admin' ? '（管理员）' : '') + (isMe ? '（我）' : '') + '</div>' +
        '  <div class="s">账号 ' + esc(u.username) + ' · 记录 ' + (u.record_count || 0) + ' 条</div></div>' +
        '  <div class="ops">' +
        '    <button data-uct="pwd" data-id="' + u.id + '" data-name="' + esc(u.display_name || u.username) + '">重置密码</button>' +
        (isMe ? '' : '    <button class="del" data-uct="del" data-id="' + u.id + '" data-name="' + esc(u.display_name || u.username) + '">删除</button>') +
        '  </div>' +
        '</div>';
    }).join('') || '<div class="empty">还没有成员</div>';
  }

  $('#user-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('#u-name').value.trim(),
        display_name: $('#u-disp').value.trim(),
        password: $('#u-pass').value,
        role: $('#u-role').value,
      }),
    }).then(function () {
      $('#u-name').value = ''; $('#u-disp').value = ''; $('#u-pass').value = '';
      $('#user-msg').textContent = ''; $('#user-msg').className = 'msg';
      toast('用户已添加');
      return refresh(['users', 'logs']);
    }).catch(function (err) {
      $('#user-msg').textContent = err.message; $('#user-msg').className = 'msg';
      toast(err.message, true);
    });
  });

  $('#user-list').addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-uct]');
    if (!btn) return;
    var id = Number(btn.getAttribute('data-id'));
    var uct = btn.getAttribute('data-uct');
    var name = btn.getAttribute('data-name');
    if (uct === 'pwd') {
      var pw = prompt('为 ' + name + ' 设置新密码（至少 6 位）：');
      if (!pw) return;
      api('/api/users/' + id, { method: 'PUT', body: JSON.stringify({ password: pw }) })
        .then(function () { toast('密码已重置'); return refresh(['logs']); })
        .catch(function (err) { toast(err.message, true); });
    } else if (uct === 'del') {
      if (!confirm('确定删除用户 ' + name + '？其历史记录会保留但显示为「已删除成员」。')) return;
      api('/api/users/' + id, { method: 'DELETE' })
        .then(function () { toast('已删除'); return refresh(['users', 'records', 'stats', 'logs']); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  // 日志
  function renderLogs() {
    $('#log-list').innerHTML = state.logs.map(function (l) {
      return '<div class="log-item">' +
        '<div class="t">' + esc(l.username || '系统') + ' · ' + esc(l.action) + '</div>' +
        '<div class="d">' + esc(l.detail) + ' · ' + esc(fmtDate(l.created_at ? l.created_at.slice(0, 19).replace('T', ' ').replace(/-/g, '-') : '')) + '</div>' +
        '</div>';
    }).join('') || '<div class="empty">暂无日志</div>';
  }

  // ---------- 我的 ----------
  function renderMe() {
    $('#me-info').textContent = '账号：' + state.user.username + ' ｜ 角色：' + (isAdmin() ? '管理员' : '普通用户');
  }

  $('#pwd-form').addEventListener('submit', function (e) {
    e.preventDefault();
    api('/api/password', {
      method: 'PUT',
      body: JSON.stringify({ old_password: $('#pw-old').value, new_password: $('#pw-new').value }),
    }).then(function () {
      $('#pw-old').value = ''; $('#pw-new').value = '';
      $('#pwd-msg').textContent = '密码已修改'; $('#pwd-msg').className = 'msg ok';
      toast('密码已修改');
      return refresh(['logs']);
    }).catch(function (err) {
      $('#pwd-msg').textContent = err.message; $('#pwd-msg').className = 'msg';
      toast(err.message, true);
    });
  });

  // 弹窗关闭（点遮罩）
  $('#modal').addEventListener('click', function (e) {
    if (e.target === this) { this.classList.add('hidden'); state.editId = null; }
  });

  // ---------- 初始化 ----------
  api('/api/me').then(function (d) {
    if (!d.user) { showLogin(); return; }
    state.user = d.user;
    return loadAll();
  }).then(function () {
    if (state.user) showMain();
  }).catch(function (err) {
    showLogin();
  });

  // 首次进入表单输入框联动
  $('#f-product').addEventListener('change', function () { updateAmountPreview(false); });
  $('#f-qty').addEventListener('input', function () { updateAmountPreview(false); });
})();
