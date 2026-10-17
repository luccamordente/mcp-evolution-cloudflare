import { WAPILOT_LOGO_SVG } from './wapilot-logo';

/**
 * The administrative document deliberately contains no operational mutation
 * controls. It loads one server-produced snapshot and keeps search/filtering
 * local to that snapshot so a refresh is an explicit operator action.
 */
export function adminPage(): string {
  return PAGE;
}

const PAGE = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WaPilot · Admin</title>
  <meta name="theme-color" content="#25D366">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap">
  <style>
    :root { color-scheme:light; --ink:#0f1b25; --muted:#667789; --line:#dfe9e6; --canvas:#f7faf9; --surface:#fff; --mint:#e9f8f0; --mint-strong:#d3f3e0; --green:#25d366; --green-deep:#108b45; --amber:#a56b0b; --amber-soft:#fff5df; --red:#b53d42; --red-soft:#fff0f0; --blue:#496b91; --blue-soft:#edf4fb; --shadow:0 18px 48px rgba(20,61,39,.08); --radius:20px; font-family:"DM Sans",system-ui,sans-serif; }
    * { box-sizing:border-box; }
    html { min-width:320px; background:var(--canvas); }
    body { margin:0; min-height:100vh; color:var(--ink); background:var(--canvas); font-size:15px; }
    button,input,select { font:inherit; }
    button,a { -webkit-tap-highlight-color:transparent; }
    button { cursor:pointer; }
    button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible { outline:3px solid rgba(32,200,102,.42); outline-offset:3px; }
    .app { min-height:100vh; display:flex; flex-direction:column; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:20px; min-height:80px; padding:0 52px; background:var(--surface); border-bottom:1px solid var(--line); }
    .brand { display:inline-flex; align-items:center; width:142px; color:var(--ink); text-decoration:none; }
    .brand > svg { display:block; width:100%; height:auto; }
    .topbar-meta { display:flex; align-items:center; gap:12px; color:var(--muted); font-size:13px; }
    .mode-chip { display:inline-flex; align-items:center; gap:7px; padding:8px 11px; color:#795b16; background:#fff2c7; border:1px solid #eed998; border-radius:999px; font-size:11px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
    .mode-dot { width:8px; height:8px; border-radius:50%; background:#e5a71e; box-shadow:0 0 0 4px rgba(229,167,30,.14); }
    .page { width:min(1180px,calc(100% - 64px)); margin:0 auto; padding:48px 0 80px; }
    .page-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:28px; margin-bottom:25px; }
    .eyebrow { margin:0 0 10px; color:var(--green-deep); font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1,h2,h3 { margin:0; font-family:"Manrope","DM Sans",sans-serif; letter-spacing:-.04em; }
    h1 { font-size:clamp(36px,5vw,60px); line-height:1; }
    h2 { font-size:26px; line-height:1.05; }
    h3 { font-size:19px; }
    .lede { max-width:680px; margin:13px 0 0; color:var(--muted); line-height:1.55; }
    .refresh { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:12px 16px; color:#063c22; background:var(--green); border:1px solid var(--green); border-radius:999px; box-shadow:0 8px 18px rgba(32,200,102,.18); font-weight:800; }
    .refresh:hover { background:#18b65b; }
    .refresh[aria-busy="true"] { cursor:wait; opacity:.7; }
    .snapshot-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px 18px; margin:0 0 25px; color:var(--muted); font-size:13px; }
    .snapshot-meta strong { color:var(--ink); }
    .summary { display:grid; grid-template-columns:repeat(5,1fr); margin-bottom:25px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
    .summary-item { min-height:108px; display:flex; flex-direction:column; justify-content:center; gap:7px; padding:20px 22px; }
    .summary-item + .summary-item { border-left:1px solid var(--line); }
    .summary-label { color:var(--muted); font-size:12px; font-weight:700; }
    .summary-value { font-size:28px; font-weight:800; letter-spacing:-.04em; }
    .summary-item.attention .summary-value { color:var(--amber); }
    .controls { display:grid; grid-template-columns:minmax(0,1fr) 230px; gap:12px; margin-bottom:25px; }
    .control-label { display:grid; gap:7px; color:var(--muted); font-size:12px; font-weight:700; }
    .control-label input,.control-label select { width:100%; min-height:46px; padding:10px 13px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:12px; }
    .control-label input::placeholder { color:#8b9aa5; }
    .state { margin-bottom:20px; padding:15px 17px; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:14px; }
    .state[hidden] { display:none; }
    .state.error { color:var(--red); background:var(--red-soft); border-color:#f2c7c7; }
    .state.warning { color:var(--amber); background:var(--amber-soft); border-color:#f2d69d; }
    .users { display:grid; gap:18px; }
    .user-card { overflow:hidden; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:0 5px 16px rgba(16,32,25,.035); }
    .user-head { display:flex; align-items:flex-start; justify-content:space-between; gap:18px; padding:22px 24px; background:linear-gradient(100deg,#f2fbf5,#fff); border-bottom:1px solid var(--line); }
    .user-heading { display:flex; align-items:center; gap:12px; min-width:0; }
    .user-avatar { display:grid; place-items:center; width:42px; height:42px; flex:0 0 auto; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:13px; font-weight:800; }
    .user-heading h2 { overflow:hidden; font-size:21px; text-overflow:ellipsis; white-space:nowrap; }
    .user-date { margin:5px 0 0; color:var(--muted); font-size:12px; }
    .attention-badge,.source-badge,.state-badge { display:inline-flex; align-items:center; gap:6px; padding:6px 9px; border-radius:999px; font-size:11px; font-weight:800; white-space:nowrap; }
    .attention-badge { color:var(--amber); background:var(--amber-soft); border:1px solid #f2d69d; }
    .source-badge { color:var(--blue); background:var(--blue-soft); border:1px solid #d2e0ef; }
    .state-badge.connected { color:var(--green-deep); background:var(--mint); border:1px solid #bce8cc; }
    .state-badge.attention { color:var(--amber); background:var(--amber-soft); border:1px solid #f2d69d; }
    .state-badge.unknown { color:var(--muted); background:#f2f5f6; border:1px solid var(--line); }
    .user-body { display:grid; gap:20px; padding:22px 24px 25px; }
    .subsection { display:grid; gap:11px; }
    .subsection-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .subsection-heading h3 { font-size:16px; }
    .muted { color:var(--muted); }
    .connection-list,.authorization-list,.activity-list { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
    .connection-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; padding:15px 16px; background:#fbfdfc; border:1px solid var(--line); border-radius:13px; }
    .connection-row.attention { background:#fffdf8; border-color:#f2d69d; }
    .connection-name { display:flex; align-items:center; flex-wrap:wrap; gap:8px; font-weight:800; }
    .connection-meta { margin:5px 0 0; color:var(--muted); font-size:12px; line-height:1.45; }
    .connection-states { display:flex; flex-wrap:wrap; justify-content:flex-end; align-content:start; gap:6px; }
    .source-detail { margin:2px 0 0; color:var(--muted); font-size:12px; }
    .authorization-row { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:16px; align-items:center; padding:14px 16px; background:#fbfdfc; border:1px solid var(--line); border-radius:13px; }
    .authorization-row strong { display:block; font-size:14px; }
    .authorization-row p { margin:4px 0 0; color:var(--muted); font-size:12px; line-height:1.4; }
    .activity-row { display:grid; grid-template-columns:27px minmax(0,1fr) auto; gap:9px; align-items:center; min-height:48px; padding:8px 10px; border-bottom:1px solid #edf2f0; }
    .activity-row:last-child { border-bottom:0; }
    .activity-icon { display:grid; place-items:center; width:25px; height:25px; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:13px; font-weight:800; }
    .activity-icon.failure { color:var(--red); background:var(--red-soft); }
    .activity-row strong { font-size:13px; }
    .activity-row p { margin:2px 0 0; color:var(--muted); font-size:11px; }
    .activity-time { color:var(--muted); font-size:11px; white-space:nowrap; }
    .empty { padding:42px 24px; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); text-align:center; }
    .empty h2 { color:var(--ink); font-size:26px; }
    .empty p { max-width:480px; margin:11px auto 0; line-height:1.5; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media (max-width:1080px) { .summary { grid-template-columns:repeat(3,1fr); } .summary-item:nth-child(4),.summary-item:nth-child(5) { border-top:1px solid var(--line); } .summary-item:nth-child(4) { border-left:0; } }
    @media (max-width:860px) { .topbar { padding:18px 24px; } .page { width:min(calc(100% - 36px),660px); padding-top:38px; } .page-heading { align-items:flex-start; flex-direction:column; } .refresh { width:100%; } .summary { grid-template-columns:repeat(2,1fr); } .summary-item:nth-child(3) { border-left:0; border-top:1px solid var(--line); } .summary-item:nth-child(4) { border-left:1px solid var(--line); } .controls { grid-template-columns:1fr; } }
    @media (max-width:520px) { .topbar { align-items:flex-start; flex-direction:column; gap:12px; padding:16px; } .topbar-meta { width:100%; justify-content:space-between; } .brand { width:126px; } .page { width:min(calc(100% - 28px),520px); padding-top:30px; } h1 { font-size:40px; } .summary { grid-template-columns:1fr 1fr; } .summary-item { min-height:92px; padding:16px 14px; } .summary-value { font-size:24px; } .user-head { padding:18px; } .user-body { padding:18px; } .user-head,.subsection-heading { align-items:flex-start; flex-direction:column; } .connection-row,.authorization-row { grid-template-columns:1fr; } .connection-states { justify-content:flex-start; } .activity-time { grid-column:2 / 4; } }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important; } }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <a class="brand" href="/connections" aria-label="WaPilot, ir para conexões">${WAPILOT_LOGO_SVG}</a>
      <div class="topbar-meta"><span class="mode-chip"><span class="mode-dot" aria-hidden="true"></span>Modo administrativo</span><span>Somente leitura</span></div>
    </header>
    <main class="page">
      <section class="page-heading" aria-labelledby="admin-title">
        <div><p class="eyebrow">Operação agregada</p><h1 id="admin-title">Painel administrativo.</h1><p class="lede">Acompanhe usuários, conexões e autorizações em um snapshot produzido no servidor. Os dados abaixo não oferecem ações de alteração.</p></div>
        <button class="refresh" id="refresh-snapshot" type="button"><span aria-hidden="true">↻</span> Atualizar snapshot</button>
      </section>
      <p class="snapshot-meta" id="snapshot-meta" aria-live="polite"><span>Snapshot: <strong id="snapshot-generated-at">aguardando consulta</strong></span><span id="snapshot-source-status">Nenhuma consulta feita</span></p>
      <section class="summary" aria-label="Resumo operacional">
        <div class="summary-item"><span class="summary-label">Usuários</span><strong class="summary-value" id="summary-users">—</strong></div>
        <div class="summary-item"><span class="summary-label">Conexões</span><strong class="summary-value" id="summary-connections">—</strong></div>
        <div class="summary-item"><span class="summary-label">Autorizações ativas</span><strong class="summary-value" id="summary-authorizations">—</strong></div>
        <div class="summary-item"><span class="summary-label">Autorizações expiradas</span><strong class="summary-value" id="summary-expired">—</strong></div>
        <div class="summary-item attention"><span class="summary-label">Atenção operacional</span><strong class="summary-value" id="summary-attention">—</strong></div>
      </section>
      <div class="controls" aria-label="Filtros do painel">
        <label class="control-label" for="admin-search">Buscar usuário ou conexão<input id="admin-search" type="search" autocomplete="off" placeholder="E-mail ou nome da conexão"></label>
        <label class="control-label" for="attention-filter">Exibir<select id="attention-filter"><option value="all">Todos os registros</option><option value="attention">Somente com atenção</option></select></label>
      </div>
      <section class="state" id="snapshot-error" role="alert" hidden></section>
      <section class="state warning" id="snapshot-partial" role="status" hidden></section>
      <section id="users-list" class="users" aria-live="polite"><div class="empty"><h2>Carregando snapshot.</h2><p>Aguardando a primeira consulta administrativa.</p></div></section>
    </main>
  </div>
  <script>
    (() => {
      const state = { snapshot: null, query: '', attentionOnly: false, loading: false };
      const refreshButton = document.querySelector('#refresh-snapshot');
      const searchInput = document.querySelector('#admin-search');
      const attentionFilter = document.querySelector('#attention-filter');
      const usersList = document.querySelector('#users-list');
      const errorBox = document.querySelector('#snapshot-error');
      const partialBox = document.querySelector('#snapshot-partial');
      const generatedAt = document.querySelector('#snapshot-generated-at');
      const sourceStatus = document.querySelector('#snapshot-source-status');
      const summaryUsers = document.querySelector('#summary-users');
      const summaryConnections = document.querySelector('#summary-connections');
      const summaryAuthorizations = document.querySelector('#summary-authorizations');
      const summaryExpired = document.querySelector('#summary-expired');
      const summaryAttention = document.querySelector('#summary-attention');
      const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char] || char));
      const text = (value, fallback = '—') => value === undefined || value === null || value === '' ? fallback : esc(value);
      const array = (value) => Array.isArray(value) ? value : [];
      const date = (value) => { if (!value) return '—'; const numeric = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN; const parsed = new Date(Number.isFinite(numeric) ? (numeric < 1e12 ? numeric * 1000 : numeric) : value); return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toLocaleString('pt-BR', { dateStyle:'medium', timeStyle:'short' }); };
      const initial = (value) => { const letters = String(value || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]); return esc(letters.join('').toUpperCase() || '?'); };
      const stateLabel = (value) => ({ connected:'Conectada', offline:'Offline', qr:'QR pendente', provisioning:'Provisionando', error:'Falha', disabled:'Desativada', active:'Ativa' }[String(value || '').toLowerCase()] || text(value, 'Desconhecido'));
      const stateClass = (value) => String(value || '').toLowerCase() === 'connected' || String(value || '').toLowerCase() === 'active' ? 'connected' : ['offline','qr','provisioning','error','disabled'].includes(String(value || '').toLowerCase()) ? 'attention' : 'unknown';
      const operationLabel = (value) => ({ connection_create:'Conexão cadastrada', connection_provision:'Instância criada', connection_qr_refresh:'QR renovado', connection_status:'Conexão verificada', connection_default:'Conexão padrão atualizada', connection_update:'Conexão atualizada' }[value] || text(value, 'Operação'));
      const hasAttention = (user) => Boolean(user && (user.attention || user.attentionReasons?.length || user.authorizations?.status === 'unavailable' || sourceUnavailable(user.authorizations) || array(user.connections).some(connectionHasAttention)));
      const connectionState = (connection, kind) => { const source = kind === 'live' ? connection?.live : connection?.persistedState; if (source && typeof source === 'object') return source.state ?? source.status ?? source.value; return source ?? (kind === 'live' ? connection?.liveState : connection?.persistedStatus); };
      const sourceUnavailable = (source) => source && typeof source === 'object' && (source.available === false || source.status === 'unavailable' || source.error);
      const connectionHasAttention = (connection) => Boolean(connection && (connection.attention || connection.attentionReasons?.length || connection.live?.state === 'unavailable' || connection.live?.error || (connection.live && connection.live.state && connection.live.state !== 'connected') || (connection.persistedState && !['active','connected'].includes(String(connection.persistedState).toLowerCase())) || (connection.persistedStatus && connection.persistedStatus !== 'active')));
      function renderSummary(snapshot) { const summary = snapshot?.summary || {}; const users = array(snapshot?.users); const expired = summary.expiredAuthorizations ?? users.reduce((total, user) => total + Number(user.authorizations?.expiredCount || 0), 0); summaryUsers.textContent = String(summary.users ?? users.length); summaryConnections.textContent = String(summary.connections ?? users.reduce((total, user) => total + array(user.connections).length, 0)); summaryAuthorizations.textContent = String(summary.activeAuthorizations ?? summary.authorizations ?? users.reduce((total, user) => total + array(user.authorizations?.authorizations || user.authorizations?.items || user.authorizations?.active).length, 0)); summaryExpired.textContent = String(expired); summaryAttention.textContent = String(summary.attentionUsers ?? summary.attention ?? users.filter(hasAttention).length); }
      function renderConnection(connection) { const persisted = connectionState(connection, 'persisted'); const live = connectionState(connection, 'live'); const liveUnavailable = sourceUnavailable(connection?.live) || live === 'unavailable'; const attention = Boolean(connection.attention || connection.attentionReasons?.length || liveUnavailable || (live && live !== 'connected') || (persisted && !['active','connected'].includes(String(persisted).toLowerCase()))); const reason = array(connection.attentionReasons).join(' · '); return '<li class="connection-row' + (attention ? ' attention' : '') + '"><div><div class="connection-name">' + text(connection.friendlyName, 'Conexão sem nome') + (connection.isDefault ? '<span class="source-badge">Padrão</span>' : '') + '</div><p class="connection-meta">' + text(connection.live?.phoneNumber || connection.phoneNumber || connection.instanceId, 'Número não identificado') + (reason ? ' · ' + esc(reason) : '') + '</p></div><div class="connection-states"><span class="state-badge ' + stateClass(persisted) + '">Cadastro: ' + stateLabel(persisted) + '</span><span class="state-badge ' + (liveUnavailable || attention ? 'attention' : stateClass(live)) + '">Live: ' + (liveUnavailable ? 'Indisponível' : stateLabel(live)) + '</span></div></li>'; }
      function renderAuthorizations(user) { const auth = user.authorizations || {}; if (auth.status === 'unavailable' || sourceUnavailable(auth)) return '<div class="state error">OAuth indisponível' + (auth.error ? ': ' + text(auth.error) : '') + '</div>'; const active = array(auth.authorizations || auth.items || auth.active || (Array.isArray(user.authorizations) ? user.authorizations : [])); const expired = Number(auth.expiredCount || 0); if (!active.length) return '<div class="state">Nenhuma autorização ativa' + (expired ? ' · ' + expired + ' expirada' + (expired === 1 ? '' : 's') + ' contabilizada' + (expired === 1 ? '' : 's') : '') + '.</div>'; return '<ul class="authorization-list">' + active.map((grant) => '<li class="authorization-row"><div><strong>' + text(grant.clientName || grant.client || grant.name, 'Cliente sem nome') + '</strong><p>Escopos: ' + text(array(grant.scopes).join(', '), 'não informados') + ' · Criada: ' + date(grant.createdAt) + ' · Recurso: ' + text(grant.resource, 'não informado') + '<br>Redirect: ' + text(grant.redirectHost || grant.redirectUriHost, 'redigido') + '</p></div><span class="source-badge">Expira ' + date(grant.expiresAt) + '</span></li>').join('') + '</ul>' + (expired ? '<p class="source-detail">' + expired + ' autorização' + (expired === 1 ? '' : 'ões') + ' expirada' + (expired === 1 ? '' : 's') + ' contabilizada' + (expired === 1 ? '' : 's') + ' separadamente.</p>' : ''); }
      function renderActivity(connection) { if (connection.activityStatus === 'unavailable') return '<div class="state error">Auditoria indisponível. Não foi possível consultar as três últimas operações.</div>'; const items = array(connection.activity).slice(0, 3); if (!items.length) return '<p class="muted">Nenhuma atividade recente registrada.</p>'; return '<ul class="activity-list">' + items.map((item) => '<li class="activity-row"><span class="activity-icon ' + (item.outcome === 'failure' ? 'failure' : '') + '">' + (item.outcome === 'failure' ? '!' : '✓') + '</span><div><strong>' + operationLabel(item.operation) + '</strong><p>' + (item.outcome === 'failure' ? 'Falha registrada' : 'Operação concluída') + '</p></div><span class="activity-time">' + date(item.createdAt || item.time) + '</span></li>').join('') + '</ul>'; }
      function renderUser(user) { const attention = hasAttention(user); const allConnections = array(user.connections); const connections = state.attentionOnly ? allConnections.filter(connectionHasAttention) : allConnections; const status = String(user.status || 'active'); return '<article class="user-card' + (attention ? ' attention' : '') + '"><header class="user-head"><div class="user-heading"><span class="user-avatar" aria-hidden="true">' + initial(user.email || user.name) + '</span><div><h2>' + text(user.email || user.name, 'Usuário sem e-mail') + '</h2><p class="user-date">Status: ' + stateLabel(status) + ' · Cadastro: ' + date(user.createdAt || user.created_at) + ' · Atualizado: ' + date(user.updatedAt || user.updated_at) + '</p></div></div>' + (attention ? '<span class="attention-badge">Atenção operacional</span>' : '<span class="state-badge connected">Sem alertas</span>') + '</header><div class="user-body"><section class="subsection" aria-labelledby="connections-' + esc(user.id || user.email) + '"><div class="subsection-heading"><h3 id="connections-' + esc(user.id || user.email) + '">Conexões</h3><span class="source-badge">' + connections.length + '</span></div>' + (connections.length ? '<ul class="connection-list">' + connections.map(renderConnection).join('') + '</ul>' : '<p class="muted">Nenhuma conexão cadastrada.</p>') + (connections.length ? '<div class="subsection"><h3>Atividade recente</h3>' + connections.map((connection) => renderActivity(connection)).join('') + '</div>' : '') + '</section><section class="subsection" aria-labelledby="authorizations-' + esc(user.id || user.email) + '"><div class="subsection-heading"><h3 id="authorizations-' + esc(user.id || user.email) + '">Autorizações OAuth</h3></div>' + renderAuthorizations(user) + '</section></div></article>'; }
      function render() { const users = array(state.snapshot?.users); const query = state.query.trim().toLocaleLowerCase(); const filtered = users.filter((user) => { const haystack = [user.email, user.name, ...array(user.connections).flatMap((connection) => [connection.friendlyName, connection.phoneNumber, connection.instanceId])].filter(Boolean).join(' ').toLocaleLowerCase(); return (!query || haystack.includes(query)) && (!state.attentionOnly || hasAttention(user)); }); if (!filtered.length) { usersList.innerHTML = '<div class="empty"><h2>Nenhum usuário encontrado.</h2><p>' + (users.length ? 'Ajuste a busca ou o filtro de atenção para continuar.' : 'O D1 ainda não possui usuários registrados neste snapshot.') + '</p></div>'; return; } usersList.innerHTML = filtered.map(renderUser).join(''); }
      async function loadSnapshot(manual) { if (state.loading) return; state.loading = true; refreshButton.setAttribute('aria-busy','true'); refreshButton.disabled = true; if (manual) { errorBox.hidden = true; sourceStatus.textContent = 'Consultando fontes…'; } try { const response = await fetch('/admin/data', { headers: { accept:'application/json' }, cache:'no-store' }); if (!response.ok) throw new Error('Não foi possível carregar o snapshot (' + response.status + ').'); state.snapshot = await response.json(); const snapshot = state.snapshot || {}; const sources = snapshot.sources || {}; const failures = array(snapshot.sourceFailures); const partial = snapshot.partial || failures.length > 0 || Object.values(sources).some((source) => source === 'partial' || source === 'unavailable' || source?.available === false || source?.status === 'unavailable'); generatedAt.textContent = date(snapshot.generatedAt || snapshot.createdAt); sourceStatus.textContent = partial ? 'Snapshot parcial · uma ou mais fontes indisponíveis' : 'Snapshot completo'; errorBox.hidden = true; partialBox.hidden = !partial; if (partial) { const sourceNames = [...new Set(failures.map((failure) => ({ evolution:'Evolution Go', oauth:'OAuth Provider', audit:'auditoria' }[failure.source] || 'fonte administrativa')))]; partialBox.textContent = snapshot.partialMessage || (sourceNames.length ? 'Fontes indisponíveis: ' + sourceNames.join(', ') + '. Os demais dados permanecem visíveis.' : 'Uma fonte está indisponível. Os demais dados permanecem visíveis.'); } renderSummary(snapshot); render(); } catch (error) { errorBox.textContent = error instanceof Error ? error.message : 'Não foi possível carregar o snapshot.'; errorBox.hidden = false; sourceStatus.textContent = state.snapshot ? 'Mantendo snapshot anterior' : 'Consulta indisponível'; if (!state.snapshot) { usersList.innerHTML = '<div class="empty"><h2>Snapshot indisponível.</h2><p>Atualize manualmente quando a fonte estiver disponível.</p></div>'; } } finally { state.loading = false; refreshButton.removeAttribute('aria-busy'); refreshButton.disabled = false; } }
      refreshButton.addEventListener('click', () => loadSnapshot(true));
      searchInput.addEventListener('input', (event) => { state.query = event.target.value; render(); });
      attentionFilter.addEventListener('change', (event) => { state.attentionOnly = event.target.value === 'attention'; render(); });
      loadSnapshot(false);
    })();
  </script>
</body>
</html>`;
