import type { AuthenticatedUser } from '../types';
import { WAPILOT_LOGO_SVG } from './wapilot-logo';

/** The connection workspace is intentionally served by the Worker so Access
 * protects the document and every same-origin request with the same audience. */
export function connectionsPage(user: AuthenticatedUser): string {
  return PAGE.replaceAll('__USER_EMAIL__', escapeHtml(user.email));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

const PAGE = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WaPilot · Conexões</title>
  <meta name="theme-color" content="#25D366">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="WaPilot">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="shortcut icon" href="/favicon.ico">
  <link rel="icon" href="/favicon-96x96.png" type="image/png" sizes="96x96">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
  <link rel="manifest" href="/site.webmanifest">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
  <style>
    :root { color-scheme: light; --ink:#0f1b25; --muted:#667789; --line:#dfe9e6; --canvas:#f7faf9; --surface:#fff; --mint:#e9f8f0; --mint-strong:#d3f3e0; --green:#25d366; --green-deep:#108b45; --amber:#a56b0b; --amber-soft:#fff5df; --red:#b53d42; --red-soft:#fff0f0; --blue:#496b91; --blue-soft:#edf4fb; --shadow:0 18px 48px rgba(20,61,39,.08); --radius:22px; font-family: "DM Sans", system-ui, sans-serif; }
    * { box-sizing:border-box; }
    html { min-width:320px; background:var(--canvas); }
    body { margin:0; min-height:100vh; color:var(--ink); background:var(--canvas); font-size:15px; }
    button, input { font:inherit; }
    button, a { -webkit-tap-highlight-color:transparent; }
    button { cursor:pointer; }
    button:focus-visible, a:focus-visible { outline:3px solid rgba(32,200,102,.4); outline-offset:3px; }
    .app { min-height:100vh; display:flex; flex-direction:column; }
    .topbar { position:relative; display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:24px; min-height:84px; padding:0 52px; background:var(--surface); border-bottom:1px solid var(--line); }
    .brand { display:inline-flex; align-items:center; width:142px; color:var(--ink); text-decoration:none; }
    .brand > svg { display:block; width:100%; height:auto; }
    .context-wrap { position:relative; grid-column:2; }
    .context-trigger { display:inline-flex; align-items:center; gap:11px; min-width:276px; padding:10px 14px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:0 6px 18px rgba(16,32,25,.05); text-align:left; }
    .context-trigger[aria-expanded="true"] { border-color:rgba(32,200,102,.75); }
    .context-avatar, .connection-avatar { display:grid; place-items:center; flex:0 0 auto; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-weight:800; }
    .context-avatar { width:30px; height:30px; font-size:11px; }
    .context-copy { display:grid; gap:2px; min-width:0; flex:1; }
    .context-label { overflow:hidden; color:var(--muted); font-size:10px; font-weight:800; letter-spacing:.12em; text-overflow:ellipsis; text-transform:uppercase; white-space:nowrap; }
    .context-number { overflow:hidden; font-size:13px; font-weight:700; text-overflow:ellipsis; white-space:nowrap; }
    .context-trigger .chevron { color:var(--muted); transition:transform .2s ease; }
    .context-trigger[aria-expanded="true"] .chevron { transform:rotate(180deg); }
    .context-menu { position:fixed; z-index:20; inset:auto; top:var(--context-menu-top, 0px); left:var(--context-menu-left, 0px); width:var(--context-menu-width, 276px); margin:0; display:none; padding:7px; background:var(--surface); border:1px solid var(--line); border-radius:15px; box-shadow:0 20px 44px rgba(16,32,25,.16); }
    .context-menu:is(:popover-open, .is-open) { display:block; }
    .context-option { width:100%; display:flex; align-items:center; gap:10px; padding:11px 10px; color:var(--ink); background:transparent; border:0; border-radius:10px; text-align:left; }
    .context-option:hover, .context-option:focus-visible { background:var(--mint); outline:0; }
    .context-option.is-active { background:#f2fbf5; }
    .context-option small { display:block; margin-top:2px; color:var(--muted); font-size:11px; }
    .context-option .check { margin-left:auto; color:var(--green-deep); }
    .context-option .state-dot { margin-left:auto; box-shadow:none; }
    .context-option .context-avatar { width:30px; height:30px; display:grid; place-items:center; flex:0 0 auto; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:11px; font-weight:800; }
    .context-option.default-action { color:var(--muted); font-size:12px; }
    .context-option.action { color:var(--green-deep); font-weight:800; }
    .context-option.action .plus { width:28px; height:28px; display:grid; place-items:center; color:#063c22; background:var(--green); border-radius:50%; font-size:18px; }
    .divider { height:1px; margin:5px 8px; background:var(--line); }
    .top-actions { display:contents; }
    .user { display:flex; justify-self:end; align-items:center; gap:9px; max-width:100%; min-width:0; color:var(--muted); font-size:13px; }
    .user > span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .user-avatar { display:grid; place-items:center; width:34px; height:34px; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:11px; font-weight:800; }
    .page { width:min(1180px, calc(100% - 64px)); margin:0 auto; padding:56px 0 80px; }
    .view[hidden] { display:none; }
    .page-heading { display:flex; justify-content:space-between; align-items:flex-end; gap:28px; margin-bottom:32px; }
    .eyebrow { margin:0 0 11px; color:var(--green-deep); font-size:11px; font-weight:800; letter-spacing:.14em; text-transform:uppercase; }
    h1, h2, h3 { margin:0; font-family:"Manrope", "DM Sans", sans-serif; letter-spacing:-.04em; }
    h1 { max-width:680px; font-size:clamp(38px, 5vw, 66px); line-height:1; }
    h2 { font-size:clamp(28px, 4vw, 44px); line-height:1.02; }
    h3 { font-size:21px; }
    .lede { max-width:570px; margin:14px 0 0; color:var(--muted); font-size:16px; line-height:1.55; }
    .primary, .secondary, .text-button { display:inline-flex; align-items:center; justify-content:center; gap:8px; border-radius:999px; font-weight:800; transition:transform .15s ease, box-shadow .15s ease, background .15s ease; }
    .primary { padding:13px 18px; color:#063c22; background:var(--green); border:1px solid var(--green); box-shadow:0 8px 18px rgba(32,200,102,.18); }
    .primary:hover { background:#18b65b; transform:translateY(-1px); }
    .secondary { padding:12px 16px; color:var(--ink); background:var(--surface); border:1px solid var(--line); }
    .secondary:hover { border-color:rgba(32,200,102,.7); background:#f8fffa; }
    .text-button { padding:8px 0; color:var(--green-deep); background:transparent; border:0; }
    .text-button:disabled { color:#93a39b; cursor:wait; }
    .connection-hero { overflow:hidden; min-height:262px; padding:38px 42px; background:var(--mint); border-radius:24px; }
    .hero-top { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:20px; min-height:186px; }
    .identity { display:grid; grid-template-columns:auto minmax(0, 1fr); align-items:center; gap:18px; }
    .identity-details { display:grid; align-content:start; gap:10px; min-width:0; }
    .connection-avatar { width:62px; height:62px; font-size:20px; border:1px solid rgba(16,139,69,.15); }
    .identity h2 { display:flex; align-items:center; flex-wrap:wrap; gap:7px; }
    .connection-meta { margin:0; color:var(--muted); font-size:15px; }
    .connection-meta strong { color:var(--ink); }
    .status-line, .default-badge { display:inline-flex; align-items:center; gap:8px; padding:7px 11px; border-radius:999px; font-size:12px; font-weight:800; }
    .status-line { color:var(--green-deep); background:rgba(255,255,255,.74); border:1px solid rgba(11,123,61,.15); }
    .default-badge { color:#795b16; background:#fff2c7; border:1px solid #eed998; }
    .state-dot { display:inline-block; width:8px; height:8px; flex:0 0 auto; border-radius:50%; background:var(--green); box-shadow:0 0 0 4px rgba(32,200,102,.14); }
    .state-warning .status-line { color:var(--amber); background:var(--amber-soft); border-color:#f2d69d; }
    .state-warning .state-dot { background:#e5a71e; box-shadow:0 0 0 4px rgba(229,167,30,.14); }
    .state-danger .status-line { color:var(--red); background:var(--red-soft); border-color:#f2c7c7; }
    .state-danger .state-dot { background:#e45c5c; box-shadow:0 0 0 4px rgba(228,92,92,.14); }
    .state-neutral .status-line { color:var(--blue); background:var(--blue-soft); border-color:#d2e0ef; }
    .state-neutral .state-dot { background:#7695b9; box-shadow:0 0 0 4px rgba(118,149,185,.14); }
    .hero-actions { display:grid; justify-items:end; align-content:start; gap:18px; }
    .hero-buttons { display:flex; flex-wrap:wrap; gap:9px; }
    .stats { display:grid; grid-template-columns:repeat(3, 1fr); border-bottom:1px solid var(--line); }
    .stat { min-height:116px; display:flex; flex-direction:column; justify-content:center; gap:8px; padding:22px 24px 22px 0; }
    .stat + .stat { padding-left:24px; border-left:1px solid var(--line); }
    .stat-label { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:13px; font-weight:700; }
    .stat-label .stat-icon { color:var(--green-deep); }
    .stat strong { font-size:21px; }
    .stat small { color:var(--muted); font-size:12px; }
    .activity { padding-top:33px; }
    .section-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; margin-bottom:14px; }
    .activity-list { display:grid; gap:10px; margin:0; padding:0; list-style:none; }
    .activity-item { display:grid; grid-template-columns:38px 1fr auto; align-items:center; gap:13px; min-height:72px; padding:13px 18px; background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:0 5px 16px rgba(16,32,25,.035); }
    .activity-icon { display:grid; place-items:center; width:34px; height:34px; color:var(--green-deep); background:var(--mint-strong); border-radius:50%; font-size:18px; }
    .activity-item strong { display:block; font-size:14px; }
    .activity-item > div span { display:block; color:var(--muted); font-size:13px; }
    .activity-time { color:var(--muted); font-size:12px; }
    .empty { padding:40px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); text-align:center; box-shadow:var(--shadow); }
    .empty h2 { font-size:30px; }
    .empty p { max-width:460px; margin:12px auto 22px; color:var(--muted); line-height:1.55; }
    .onboarding-grid { display:grid; grid-template-columns:.9fr 1.1fr; gap:58px; align-items:center; }
    .step-summary { display:flex; flex-wrap:wrap; gap:8px; margin-top:32px; }
    .step-chip { padding:7px 10px; color:var(--muted); background:var(--surface); border:1px solid var(--line); border-radius:999px; font-size:11px; font-weight:800; }
    .step-chip.is-active { color:var(--green-deep); background:var(--mint); border-color:rgba(32,200,102,.45); }
    .step-list { display:grid; gap:26px; margin:38px 0 0; padding:0; list-style:none; }
    .step { display:grid; grid-template-columns:42px 1fr; gap:16px; align-items:start; }
    .step-number { display:grid; place-items:center; width:38px; height:38px; color:var(--muted); border:2px solid var(--line); border-radius:50%; font-weight:800; }
    .step.is-current .step-number { color:#063c22; background:var(--green); border-color:var(--green); }
    .step strong { font-size:15px; }
    .step p { margin:4px 0 0; color:var(--muted); line-height:1.45; font-size:15px; }
    .back { display:inline-flex; align-items:center; gap:8px; margin-top:36px; color:var(--ink); text-decoration:none; font-weight:700; }
    .back:hover { color:var(--green-deep); }
    .primary-btn { display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:13px 18px; color:#052b1a; background:var(--green); border:0; border-radius:999px; box-shadow:0 8px 18px rgba(37,211,102,.18); font-weight:700; }
    .primary-btn:hover { background:#1fbd5b; }
    .secondary-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:11px 15px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:12px; font-weight:700; }
    .secondary-btn:hover { border-color:rgba(37,211,102,.7); }
    .onboarding-panel { min-height:460px; display:grid; place-items:center; }
    .state-card, .qr-panel { width:min(100%, 530px); padding:40px; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
    .state-card .state-symbol, .state-card .state-icon { display:grid; place-items:center; width:58px; height:58px; margin-bottom:22px; color:var(--green-deep); background:var(--mint-strong); border-radius:18px; font-size:28px; }
    .state-card h2, .qr-panel h2 { font-size:31px; }
    .state-card p, .qr-panel > p { margin:14px 0 24px; color:var(--muted); line-height:1.55; }
    .progress-note { display:flex; align-items:center; gap:9px; color:var(--muted); font-size:13px; }
    .spinner { width:17px; height:17px; border:2px solid var(--mint-strong); border-top-color:var(--green); border-radius:50%; animation:spin .8s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .qr-panel { background:var(--mint); text-align:center; }
    .qr-panel > p { max-width:350px; margin:9px auto 20px; }
    .qr-frame { width:min(100%, 320px); aspect-ratio:1; display:grid; place-items:center; margin:0 auto 18px; padding:12px; background:var(--surface); border-radius:18px; box-shadow:var(--shadow); }
    .qr-frame img { display:block; width:100%; height:100%; object-fit:contain; image-rendering:pixelated; }
    .qr-placeholder { display:grid; place-items:center; width:100%; height:100%; padding:24px; color:var(--muted); background:#f5faf7; border:1px dashed #b8d8c3; border-radius:10px; font-size:13px; line-height:1.45; }
    .countdown { display:inline-flex; align-items:center; gap:8px; color:var(--green-deep); font-size:23px; font-weight:800; }
    .qr-help { margin:8px 0 20px; color:var(--muted); font-size:13px; }
    .qr-actions { display:flex; justify-content:center; flex-wrap:wrap; gap:9px; }
    .toast { position:fixed; z-index:50; left:50%; bottom:24px; max-width:min(92vw, 520px); padding:12px 16px; color:#fff; background:#0b3021; border-radius:999px; box-shadow:0 12px 28px rgba(9,44,32,.2); font-size:13px; opacity:0; pointer-events:none; transform:translate(-50%, 15px); transition:opacity .2s ease, transform .2s ease; }
    .toast.is-visible { opacity:1; transform:translate(-50%, 0); }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    @media (max-width:860px) { .topbar { grid-template-columns:minmax(0, 1fr) auto; align-items:center; padding:20px 24px; } .brand { grid-column:1; grid-row:1; } .user { grid-column:2; grid-row:1; } .context-wrap { grid-column:1 / -1; grid-row:2; width:100%; } .context-trigger { width:100%; } .context-menu { width:100%; } .page { width:min(100% - 36px, 660px); padding-top:42px; } .page-heading { align-items:flex-start; flex-direction:column; } .connection-hero { padding:30px 26px; } .onboarding-grid { grid-template-columns:1fr; gap:34px; } .onboarding-panel { min-height:0; } .stats { grid-template-columns:1fr; } .stat, .stat + .stat { min-height:0; padding:19px 0; border-left:0; border-bottom:1px solid var(--line); } .stat:last-child { border-bottom:0; } }
    @media (max-width:520px) { .topbar { padding-inline:16px; } .brand { width:126px; } .page { width:min(100% - 28px, 520px); } h1 { font-size:42px; } .hero-top { grid-template-columns:1fr; } .hero-actions { justify-items:stretch; } .hero-buttons { display:grid; grid-template-columns:1fr; } .hero-buttons button { width:100%; } .activity-item { grid-template-columns:34px 1fr; padding-inline:0; } .activity-time { grid-column:2; } .state-card, .qr-panel { padding:25px 18px; } }
    @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation-duration:.01ms !important; transition-duration:.01ms !important; scroll-behavior:auto !important; } }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <a class="brand" href="#dashboard" aria-label="WaPilot, ir para o dashboard">${WAPILOT_LOGO_SVG}</a>
      <div class="context-wrap" id="context-wrap">
        <button class="context-trigger" id="context-trigger" type="button" aria-expanded="false" aria-controls="context-menu"><span class="context-avatar" id="context-avatar">—</span><span class="context-copy"><span class="context-label" id="context-label">Nenhuma conexão</span><span class="context-number" id="context-number">Número ainda não identificado</span></span><i class="ph ph-caret-down" aria-hidden="true"></i></button>
        <div class="context-menu" id="context-menu" popover="auto">
          <div id="context-options"></div>
          <div class="divider"></div>
          <button class="context-option action" id="context-add" type="button"><i class="ph ph-plus-circle" aria-hidden="true"></i><span>Adicionar novo número</span></button>
        </div>
      </div>
      <div class="top-actions"><div class="user"><span class="user-avatar" id="user-avatar">LM</span><span>__USER_EMAIL__</span></div></div>
    </header>
    <main class="page">
      <section class="view" id="dashboard-view" aria-labelledby="dashboard-title">
        <div class="page-heading"><div><p class="eyebrow">Dashboard da conexão</p><h1 id="dashboard-title">Seu WhatsApp está pronto para trabalhar.</h1></div></div>
        <div id="dashboard-content"></div>
      </section>
      <section class="view" id="onboarding-view" hidden aria-labelledby="onboarding-title">
        <div class="onboarding-grid">
          <div><p class="eyebrow">Nova conexão</p><h1 id="onboarding-title">Conecte um novo WhatsApp ao WaPilot</h1><p class="lede">Vamos preparar uma instância nova. Nenhum número fica selecionado enquanto essa conexão não for confirmada.</p><div class="step-summary" aria-label="Etapas da nova conexão"><span class="step-chip is-active" data-step="confirm">1 · Confirmar</span><span class="step-chip" data-step="provision">2 · Preparar</span><span class="step-chip" data-step="qr">3 · Ler QR</span></div><ol class="step-list" id="qr-instructions" hidden><li class="step is-current"><span class="step-number">1</span><div><strong>Abra o WhatsApp</strong><p>No seu celular, toque em <strong>Configurações → Aparelhos conectados</strong>.</p></div></li><li class="step"><span class="step-number">2</span><div><strong>Toque em Conectar aparelho</strong><p>Escolha <strong>Conectar aparelho</strong> para abrir a câmera.</p></div></li><li class="step"><span class="step-number">3</span><div><strong>Escaneie o QR Code</strong><p>Aponte a câmera para o código e mantenha esta tela aberta.</p></div></li></ol><a class="back" href="#dashboard" id="back-dashboard"><i class="ph ph-arrow-left" aria-hidden="true"></i> Voltar para o dashboard</a></div>
          <div class="onboarding-panel">
            <div class="state-card onboarding-state" id="confirm-state"><div class="state-icon"><i class="ph ph-plugs-connected" aria-hidden="true"></i></div><h2>Pronto para criar uma instância?</h2><p>O WaPilot vai preparar um ambiente novo para o WhatsApp que você escolher. Isso leva alguns segundos e ainda não conecta nenhum número.</p><button class="primary-btn" id="confirm-provision" type="button">Continuar <i class="ph ph-arrow-right" aria-hidden="true"></i></button></div>
            <div class="state-card onboarding-state" id="provision-state" hidden><div class="state-icon"><i class="ph ph-cloud-arrow-up" aria-hidden="true"></i></div><h2>Preparando sua instância</h2><p>A instância e o webhook estão sendo configurados. Você não precisa fazer nada agora.</p><div class="progress-note"><span class="spinner" aria-hidden="true"></span><span>Isso deve levar alguns segundos.</span></div></div>
            <div class="qr-panel onboarding-state" id="qr-state" hidden><h2>Leia este QR Code</h2><p>Abra o WhatsApp no celular e conecte um aparelho a esta nova instância.</p><div class="qr-frame"><img id="qr-image" alt="QR Code para conectar o WhatsApp" hidden><div class="qr-placeholder" id="qr-placeholder">Aguardando o QR Code do Evolution Go…</div></div><div class="countdown" aria-live="polite"><i class="ph ph-timer" aria-hidden="true"></i><span id="countdown">00:30</span></div><p class="qr-help" id="qr-help">Se expirar, um novo código será gerado automaticamente.</p><div class="qr-actions"><button class="secondary-btn" id="renew-qr" type="button"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i> Recarregar QR</button><button class="primary-btn" id="check-connection" type="button">Verificar conexão</button></div></div>
            <div class="state-card onboarding-state" id="expired-state" hidden><div class="state-icon"><i class="ph ph-timer" aria-hidden="true"></i></div><h2>O QR Code expirou.</h2><p>Vamos renovar o código da conexão existente. Isso não cria uma segunda conexão no workspace.</p><button class="primary-btn" id="renew-expired" type="button">Gerar novo QR</button></div>
            <div class="state-card onboarding-state" id="success-state" hidden><div class="state-icon"><i class="ph ph-check-circle" aria-hidden="true"></i></div><h2>WhatsApp conectado.</h2><p id="success-copy">O número foi confirmado e está pronto para uso.</p><button class="primary-btn" id="go-dashboard" type="button">Ir para o dashboard <i class="ph ph-arrow-right" aria-hidden="true"></i></button></div>
            <div class="state-card onboarding-state" id="error-state" hidden><div class="state-icon"><i class="ph ph-warning-circle" aria-hidden="true"></i></div><h2>Não foi possível concluir.</h2><p id="error-copy">Tente novamente em alguns instantes.</p><button class="primary-btn" id="retry-provision" type="button">Tentar novamente</button></div>
          </div>
        </div>
      </section>
    </main>
    <div class="toast" id="toast" role="status" aria-live="polite"></div>
  </div>
  <script>
    (() => {
      const dashboard = document.querySelector('#dashboard-view');
      const onboarding = document.querySelector('#onboarding-view');
      const dashboardContent = document.querySelector('#dashboard-content');
      const contextMenu = document.querySelector('#context-menu');
      const contextTrigger = document.querySelector('#context-trigger');
      const contextOptions = document.querySelector('#context-options');
      const toast = document.querySelector('#toast');
      const state = { connections: [], activeId: null, onboardingId: null, onboardingState: 'confirm', timer: null, poll: null, renewal: null, renewing: false, toastTimer: null };
      const labels = { connected: 'Conectado', qr: 'Aguardando QR', expired: 'QR expirado', provisioning: 'Provisionando', offline: 'Offline', error: 'Erro de conexão' };
      const initials = (value) => (String(value || '—').trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '—');
      const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character] || character);
      const showToast = (message) => { toast.textContent = message; toast.classList.add('is-visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800); };
      const api = async (path, options) => { const response = await fetch(path, Object.assign({ headers: { 'Accept':'application/json', 'Content-Type':'application/json' }, credentials:'same-origin' }, options || {})); const text = await response.text(); let body = {}; try { body = text ? JSON.parse(text) : {}; } catch (_) { body = { error: text || 'Resposta inválida' }; } if (!response.ok) throw new Error(body.error || 'Não foi possível concluir a operação.'); return body; };
      const active = () => state.connections.find((item) => item.id === state.activeId) || state.connections.find((item) => item.isDefault) || state.connections[0];
      const updateContextPosition = () => { const rect = contextTrigger.getBoundingClientRect(); contextMenu.style.setProperty('--context-menu-top', (rect.bottom + 9) + 'px'); contextMenu.style.setProperty('--context-menu-left', rect.left + 'px'); contextMenu.style.setProperty('--context-menu-width', rect.width + 'px'); };
      const setContextOpen = (open) => { contextTrigger.setAttribute('aria-expanded', String(open)); contextMenu.classList.toggle('is-open', open); if (open) updateContextPosition(); try { if (open && typeof contextMenu.showPopover === 'function' && !contextMenu.matches(':popover-open')) contextMenu.showPopover(); if (!open && typeof contextMenu.hidePopover === 'function' && contextMenu.matches(':popover-open')) contextMenu.hidePopover(); } catch (_) { contextMenu.hidden = !open; } };
      const statusTone = (connection) => connection.state === 'error' ? 'state-danger' : ['qr','expired','provisioning'].includes(connection.state) ? 'state-warning' : connection.state === 'offline' ? 'state-neutral' : '';
      const activityIcon = (item) => { const title = String(item.title || '').toLowerCase(); if (item.icon === '!' || title.includes('falha')) return 'ph-warning-circle'; if (title.includes('webhook')) return 'ph-broadcast'; if (item.icon === '+' || title.includes('instância') || title.includes('criad')) return 'ph-plus-circle'; return 'ph-check-circle'; };
      const activityFallback = (connection) => { const stateLabel = labels[connection.state] || labels.connected; return [{ icon:'✓', title: stateLabel === 'Conectado' ? 'Conexão verificada' : stateLabel, detail: connection.state === 'connected' ? 'WhatsApp está online e pronto para uso' : (connection.statusDetail || 'O estado desta conexão foi atualizado'), time: 'agora' }, { icon:'↗', title:'Webhook ativo', detail:'Eventos serão capturados a partir da conexão', time:'—' }, { icon:'+', title:'Instância criada', detail:'O ambiente foi preparado no Evolution Go', time:'—' }]; };
      const renderContext = () => { const current = active(); document.querySelector('#context-label').textContent = current ? current.friendlyName : 'Nenhuma conexão'; document.querySelector('#context-number').textContent = current ? (current.phoneNumber || 'Número ainda não identificado') : 'Número ainda não identificado'; document.querySelector('#context-avatar').textContent = current ? initials(current.friendlyName) : '—'; contextOptions.innerHTML = state.connections.map((connection) => '<button class="context-option ' + (connection.id === state.activeId ? 'is-active' : '') + '" type="button" data-select="' + escapeHtml(connection.id) + '"><span class="context-avatar">' + escapeHtml(initials(connection.friendlyName)) + '</span><span><strong>' + escapeHtml(connection.friendlyName) + '</strong><small>' + escapeHtml(connection.phoneNumber || 'Número ainda não identificado') + ' · ' + escapeHtml(labels[connection.state] || labels.connected) + '</small></span>' + (connection.id === state.activeId ? '<i class="ph ph-check check" aria-label="Ativa"></i>' : '<span class="state-dot" aria-hidden="true"></span>') + '</button>' + (!connection.isDefault ? '<button class="context-option" type="button" data-default="' + escapeHtml(connection.id) + '"><span></span><span>Tornar padrão</span></button>' : '')).join(''); };
      const renderDashboard = () => { const connection = active(); if (!connection) { dashboardContent.innerHTML = '<div class="empty"><h2>Comece por uma conexão.</h2><p>Prepare o primeiro número do workspace e acompanhe a leitura do QR até a confirmação.</p></div>'; return; } const activity = connection.activity && connection.activity.length ? connection.activity : activityFallback(connection); document.body.className = statusTone(connection); const defaultBadge = connection.isDefault ? '<span class="default-badge">★ Padrão</span>' : ''; dashboardContent.innerHTML = '<section class="connection-hero" aria-labelledby="connection-title"><div class="hero-top"><div class="identity"><span class="connection-avatar" aria-hidden="true">' + escapeHtml(initials(connection.friendlyName)) + '</span><div class="identity-details"><h2 id="connection-title">' + escapeHtml(connection.friendlyName) + defaultBadge + '</h2><p class="connection-meta"><strong>' + escapeHtml(connection.phoneNumber || 'Número ainda não identificado') + '</strong> · ' + escapeHtml(connection.lastVerified || 'verificação pendente') + '</p></div></div><div class="hero-actions"><div class="status-line"><span class="state-dot" aria-hidden="true"></span><span>' + escapeHtml(labels[connection.state] || labels.connected) + '</span></div><div class="hero-buttons"><button class="secondary" type="button" data-refresh="' + escapeHtml(connection.id) + '">↻ Atualizar</button><button class="primary" type="button" data-open="' + escapeHtml(connection.id) + '">' + (connection.state === 'connected' ? 'Abrir estado →' : 'Continuar conexão →') + '</button></div></div></div></section><section class="stats" aria-label="Resumo da conexão"><div class="stat"><span class="stat-label"><i class="ph ph-heartbeat" aria-hidden="true"></i> Saúde da conexão</span><strong>' + escapeHtml(connection.health || (connection.state === 'connected' ? 'Saudável' : 'Aguardando ação')) + '</strong><small>' + escapeHtml(connection.healthDetail || 'Estado sincronizado com o provedor') + '</small></div><div class="stat"><span class="stat-label"><i class="ph ph-clock" aria-hidden="true"></i> Tempo conectado</span><strong>' + escapeHtml(connection.uptime || '—') + '</strong><small>' + escapeHtml(connection.uptimeDetail || 'Disponível após a confirmação') + '</small></div><div class="stat"><span class="stat-label"><i class="ph ph-broadcast" aria-hidden="true"></i> Webhook</span><strong>' + escapeHtml(connection.webhook || 'Ativo') + '</strong><small>' + escapeHtml(connection.webhookDetail || 'Pronto para capturar eventos') + '</small></div></section><section class="activity" aria-labelledby="activity-title"><div class="section-heading"><h3 id="activity-title">Atividade recente</h3><button class="text-button" type="button" data-activity>Ver tudo →</button></div><ul class="activity-list">' + activity.map((item) => '<li class="activity-item"><span class="activity-icon" aria-hidden="true">' + escapeHtml(item.icon || '•') + '</span><div><strong>' + escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.detail) + '</span></div><time class="activity-time">' + escapeHtml(item.time || '—') + '</time></li>').join('') + '</ul></section>'; };
      const render = () => { renderContext(); if (!dashboard.hidden) renderDashboard(); };
      const setOnboardingState = (next) => { state.onboardingState = next; document.querySelectorAll('.onboarding-state').forEach((item) => { item.hidden = item.id !== next + '-state'; }); const activeStep = next === 'expired' ? 'qr' : next === 'success' ? '' : next; document.querySelectorAll('[data-step]').forEach((item) => item.classList.toggle('is-active', item.dataset.step === activeStep)); document.querySelector('#qr-instructions').hidden = next !== 'qr'; };
      const stopTimers = () => { clearInterval(state.timer); clearInterval(state.poll); clearTimeout(state.renewal); state.timer = null; state.poll = null; state.renewal = null; };
      const showDashboard = () => { stopTimers(); onboarding.hidden = true; dashboard.hidden = false; window.location.hash = 'dashboard'; render(); };
      const showOnboarding = (connection, next) => { stopTimers(); state.onboardingId = connection && connection.id; dashboard.hidden = true; onboarding.hidden = false; window.location.hash = 'onboarding'; const nextState = next || (connection && connection.state === 'expired' ? 'expired' : connection && connection.state === 'qr' ? 'qr' : 'confirm'); setOnboardingState(nextState); if (connection && connection.state === 'qr') { if (connection.qr) setQrImage(connection.qr, connection.qrExpiresIn); else renewQr(); startPolling(); } if (connection && connection.state === 'expired') renewQr(); };
      const setQrImage = (value, expiresIn) => { const image = document.querySelector('#qr-image'); const placeholder = document.querySelector('#qr-placeholder'); if (value) { image.src = value; image.hidden = false; placeholder.hidden = true; } else { image.hidden = true; placeholder.hidden = false; } startCountdown(Number(expiresIn) || 30); };
      const startCountdown = (seconds) => { clearInterval(state.timer); clearTimeout(state.renewal); const end = Date.now() + Math.max(1, seconds) * 1000; const tick = () => { const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000)); document.querySelector('#countdown').textContent = '00:' + String(remaining).padStart(2, '0'); if (!remaining) { clearInterval(state.timer); setOnboardingState('expired'); showToast('QR expirado. Um novo código será gerado.'); state.renewal = setTimeout(() => { if (state.onboardingId) renewQr(); }, 1200); } }; tick(); state.timer = setInterval(tick, 500); };
      const startPolling = () => { clearInterval(state.poll); if (!state.onboardingId) return; state.poll = setInterval(async () => { try { const result = await api('/api/connections/' + encodeURIComponent(state.onboardingId) + '/status'); if (result.state === 'connected') { const connection = state.connections.find((item) => item.id === state.onboardingId); if (connection) { connection.state = 'connected'; connection.phoneNumber = result.phoneNumber || connection.phoneNumber; } setOnboardingState('success'); document.querySelector('#success-copy').textContent = (result.phoneNumber ? result.phoneNumber + ' foi confirmado' : 'O número foi confirmado') + ' e está pronto para uso.'; stopTimers(); showToast('WhatsApp conectado.'); } } catch (_) { /* a transient upstream failure keeps the QR visible */ } }, 4000); };
      const provision = async () => { setOnboardingState('provision'); try { const result = await api('/api/connections/provision', { method:'POST', body:JSON.stringify({}) }); const connection = result.connection; state.connections = state.connections.filter((item) => item.id !== connection.id).concat(Object.assign({}, connection, { state:'qr', qr:result.qr, qrExpiresIn:result.expiresIn })); state.activeId = connection.id; state.onboardingId = connection.id; localStorage.setItem('wapilot.activeConnection', connection.id); renderContext(); setOnboardingState('qr'); setQrImage(result.qr, result.expiresIn); startPolling(); showToast('Instância preparada. Leia o QR para conectar.'); } catch (error) { document.querySelector('#error-copy').textContent = error instanceof Error ? error.message : 'Tente novamente em alguns instantes.'; setOnboardingState('error'); } };
      const renewQr = async () => { if (!state.onboardingId || state.renewing) return; state.renewing = true; setOnboardingState('provision'); try { const result = await api('/api/connections/' + encodeURIComponent(state.onboardingId) + '/qr', { method:'POST' }); const connection = state.connections.find((item) => item.id === state.onboardingId); if (connection) { connection.state = 'qr'; connection.qr = result.qr; connection.qrExpiresIn = result.expiresIn; } setOnboardingState('qr'); setQrImage(result.qr, result.expiresIn); startPolling(); showToast('Novo QR Code gerado.'); } catch (error) { document.querySelector('#error-copy').textContent = error instanceof Error ? error.message : 'Tente novamente em alguns instantes.'; setOnboardingState('error'); } finally { state.renewing = false; } };
      const selectConnection = async (id) => { const connection = state.connections.find((item) => item.id === id); if (!connection) return; state.activeId = id; localStorage.setItem('wapilot.activeConnection', id); setContextOpen(false); renderContext(); if (connection.state === 'connected') { showDashboard(); showToast(connection.friendlyName + ' agora está em foco.'); } else { showOnboarding(connection); showToast('Continuando a configuração de ' + connection.friendlyName + '.'); } };
      const setDefault = async (id) => { try { await api('/api/connections/' + encodeURIComponent(id) + '/default', { method:'POST' }); state.connections.forEach((item) => { item.isDefault = item.id === id; }); state.activeId = id; localStorage.setItem('wapilot.activeConnection', id); render(); showToast('Conexão padrão atualizada.'); } catch (error) { showToast(error.message); } };
      const load = async (refresh) => { try { const result = await api('/connections/data' + (refresh ? '?refresh=1' : '')); state.connections = result.connections || []; const stored = localStorage.getItem('wapilot.activeConnection'); state.activeId = state.connections.some((item) => item.id === stored) ? stored : (state.connections.find((item) => item.isDefault) || state.connections[0] || {}).id || null; renderContext(); const current = active(); if (!state.connections.length) showOnboarding(null, 'confirm'); else if (window.location.hash === '#onboarding' || (current && current.state !== 'connected')) showOnboarding(current); else showDashboard(); } catch (error) { dashboardContent.innerHTML = '<div class="empty"><h2>Não foi possível carregar as conexões.</h2><p>' + escapeHtml(error.message) + '</p><button class="primary-btn" type="button" data-retry>↻ Tentar novamente</button></div>'; dashboard.hidden = false; onboarding.hidden = true; } };
      contextMenu.addEventListener('toggle', () => { if (!contextMenu.matches(':popover-open')) { contextMenu.classList.remove('is-open'); contextTrigger.setAttribute('aria-expanded', 'false'); } });
      window.addEventListener('resize', () => { if (contextTrigger.getAttribute('aria-expanded') === 'true') updateContextPosition(); });
      window.addEventListener('scroll', () => { if (contextTrigger.getAttribute('aria-expanded') === 'true') updateContextPosition(); }, { passive: true });
      contextTrigger.addEventListener('click', () => setContextOpen(contextTrigger.getAttribute('aria-expanded') !== 'true'));
      contextMenu.addEventListener('click', (event) => { const target = event.target.closest('button'); if (!target) return; if (target.dataset.select) selectConnection(target.dataset.select); if (target.dataset.default) setDefault(target.dataset.default); if (target.id === 'context-add') { setContextOpen(false); showOnboarding(null, 'confirm'); } });
      document.addEventListener('click', (event) => { if (!document.querySelector('#context-wrap').contains(event.target)) setContextOpen(false); });
      document.querySelector('#confirm-provision').addEventListener('click', provision);
      document.querySelector('#renew-qr').addEventListener('click', renewQr);
      document.querySelector('#renew-expired').addEventListener('click', renewQr);
      document.querySelector('#check-connection').addEventListener('click', async () => { if (!state.onboardingId) return; try { const result = await api('/api/connections/' + encodeURIComponent(state.onboardingId) + '/status'); if (result.state === 'connected') { setOnboardingState('success'); stopTimers(); showToast('WhatsApp conectado.'); } else showToast('Ainda aguardando a confirmação do aparelho.'); } catch (error) { showToast(error.message); } });
      document.querySelector('#go-dashboard').addEventListener('click', async () => { window.location.hash = 'dashboard'; await load(true); });
      document.querySelector('#retry-provision').addEventListener('click', provision);
      document.querySelector('#back-dashboard').addEventListener('click', (event) => { event.preventDefault(); showDashboard(); });
      document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); showDashboard(); });
      dashboardContent.addEventListener('click', (event) => { const target = event.target.closest('button'); if (!target) return; if (target.dataset.refresh) load(true); if (target.dataset.open) { const connection = state.connections.find((item) => item.id === target.dataset.open); if (connection && connection.state === 'connected') showToast(connection.friendlyName + ' está conectado e pronto para uso.'); else if (connection) showOnboarding(connection); } if (target.dataset.activity) showToast('A atividade detalhada será disponibilizada nesta conexão.'); if (target.dataset.default) setDefault(target.dataset.default); });
      load(false);
    })();
  </script>
</body>
</html>`;
