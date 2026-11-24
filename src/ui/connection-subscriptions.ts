export const subscriptionStyles = `
  .subscriptions { margin-top:42px; padding-top:33px; border-top:1px solid var(--line); }
  .subscriptions .section-heading { flex-wrap:wrap; gap:6px 20px; }
  .subscriptions .lede { margin-top:6px; font-size:14px; }
  .subscription-list { display:grid; gap:10px; }
  .subscriptions button[hidden] { display:none; }
  .subscriptions [data-load-subscriptions], .subscriptions [data-load-deliveries] { justify-self:start; margin-top:6px; }
  .subscription-rows, .subscription-recent { background:var(--surface); border:1px solid var(--line); border-radius:14px; }
  .subscription-rows:has(> [data-items]:empty) { display:none; }
  .subscription-columns, .subscription-details > summary {
    display:grid; grid-template-columns:minmax(0,1.55fr) minmax(0,1.05fr) minmax(0,1fr);
    align-items:center; column-gap:16px; padding-inline:18px;
  }
  .subscription-columns { padding-block:9px; border-radius:13px 13px 0 0; background:var(--canvas); color:var(--muted); font-size:12px; font-weight:700; }
  .subscription-columns > :first-child { padding-inline-start:22px; }
  .subscription-details { border-top:1px solid var(--line); }
  .subscription-details > summary, .subscription-recent > summary { cursor:pointer; list-style:none; }
  .subscription-details > summary::-webkit-details-marker, .subscription-recent > summary::-webkit-details-marker { display:none; }
  .subscription-details > summary { min-height:70px; padding-block:12px; }
  .subscription-details[open] > summary, .subscription-details > summary:hover, .subscription-recent > summary:hover { background:var(--mint); }
  .subscription-details:last-child:not([open]) > summary { border-radius:0 0 13px 13px; }
  .subscriptions summary:focus-visible { outline:2px solid var(--green-deep); outline-offset:-2px; }
  .subscription-identity { display:grid; grid-template-columns:12px minmax(0,1fr); align-items:start; gap:10px; }
  .subscription-identity::before {
    content:""; width:7px; height:7px; margin:7px 0 0 1px;
    color:var(--green-deep); border:solid currentColor; border-width:0 1.5px 1.5px 0; transform:rotate(-45deg);
  }
  details[open] > summary .subscription-identity::before { transform:rotate(45deg); }
  .subscription-name, .subscription-timing strong { display:block; font-weight:700; overflow-wrap:anywhere; }
  .subscription-meta, .subscription-timing time { display:block; color:var(--muted); font-size:12px; }
  .subscription-timing strong { font-size:13px; }
  .subscription-status {
    justify-self:start; max-width:100%; padding:4px 9px; border-radius:6px; overflow-wrap:anywhere;
    color:var(--ink); background:var(--canvas); font-size:12px; font-weight:700;
  }
  .subscription-status.is-active { color:#0b3021; background:var(--mint-strong); }
  .subscription-status.is-warning { color:#755011; background:var(--amber-soft); }
  .subscription-recent { margin-top:12px; }
  .subscription-recent > summary { display:block; padding:12px 18px; border-radius:13px; }
  .subscription-recent > .subscription-list > :not([data-items]) { margin-inline:18px; }
  .subscription-recent > .subscription-list > :last-child:not([hidden]) { margin-bottom:12px; }
  .subscription-recent > .subscription-list > .subscription-progress:not(:empty) { margin-top:8px; }
  .subscription-body {
    display:grid; grid-template-columns:minmax(0,1.45fr) minmax(0,1fr); gap:20px;
    padding:16px 18px 18px 40px; border-top:1px solid var(--line);
  }
  .subscription-body h4 { margin:0; font-size:14px; }
  .subscription-facts { border-inline-start:1px solid var(--line); padding-inline-start:18px; }
  .subscription-facts dl { margin:8px 0 0; }
  .subscription-facts dt { margin-top:7px; color:var(--muted); font-size:12px; }
  .subscription-facts dd { margin:0; font-size:13px; overflow-wrap:anywhere; }
  .subscription-facts .text-button { margin-top:5px; color:var(--red); }
  .subscription-deliveries { margin:0; padding:0; list-style:none; }
  .subscription-deliveries li {
    position:relative; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,auto);
    gap:2px 9px; margin-top:8px; padding:8px 0 0 15px; border-top:1px solid var(--line); font-size:13px;
  }
  .subscription-deliveries li::before { content:""; position:absolute; inset:15px auto auto 0; width:6px; height:6px; border-radius:50%; background:var(--muted); }
  .subscription-deliveries li.is-accepted::before { background:var(--green-deep); }
  .subscription-deliveries li.is-failed::before { background:var(--red); }
  .subscription-deliveries .subscription-received { color:var(--muted); font-size:12px; }
  .subscription-deliveries small { color:var(--muted); font-size:12px; overflow-wrap:anywhere; grid-column:1 / -1; }
  .subscription-progress { margin:0; color:var(--muted); font-size:13px; }
  .subscription-activity .subscription-progress:not(:empty) { margin-top:8px; }
  .subscription-progress:empty { display:none; }
  .subscription-stop-dialog { width:min(100% - 32px, 440px); padding:24px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
  .subscription-stop-dialog h1 { margin:0; font-size:24px; }
  .subscription-stop-dialog p { color:var(--muted); font-size:14px; line-height:1.5; }
  .subscription-stop-dialog:modal { overscroll-behavior:contain; }
  .subscription-stop-dialog::backdrop { background:rgba(15,27,37,.45); overflow:hidden; overscroll-behavior:contain; }
  .subscription-stop-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
  .subscription-stop-actions .danger { color:var(--red); }
  @media (max-width:590px) {
    .subscription-columns { display:none; }
    .subscription-rows .subscription-details:first-child { border-top:0; }
    .subscription-rows .subscription-details:first-child > summary { border-start-start-radius:13px; border-start-end-radius:13px; }
    .subscription-details > summary { grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:5px 8px; padding-inline:12px; }
    .subscription-details .subscription-identity { grid-column:1 / -1; }
    .subscription-details .subscription-status { margin-inline-start:22px; }
    .subscription-timing { text-align:end; }
    .subscription-recent > summary { padding-inline:12px; }
    .subscription-body { grid-template-columns:minmax(0,1fr); gap:14px; padding-inline:14px; }
    .subscription-facts { border-inline-start:0; border-top:1px solid var(--line); padding:12px 0 0; }
  }
  @media (max-width:420px) {
    .subscription-deliveries li { grid-template-columns:1fr; }
  }
`;

export const subscriptionSection = `
  <section class="subscriptions" id="subscriptions" hidden aria-labelledby="subscriptions-title">
    <div class="section-heading">
      <div>
        <h3 id="subscriptions-title">Assinaturas de mensagens</h3>
        <p class="lede">Veja quais aplicativos recebem avisos de novas mensagens desta conexão.</p>
      </div>
      <button class="text-button" type="button" id="refresh-subscriptions" aria-label="Atualizar assinaturas">Atualizar →</button>
    </div>
    <div class="subscription-list" id="subscription-current">
      <p class="subscription-progress" role="status"></p>
      <div class="subscription-rows">
        <div class="subscription-columns" aria-hidden="true">
          <span>Aplicativo e alcance</span><span>Situação</span><span>Vigência</span>
        </div>
        <div data-items></div>
      </div>
      <button type="button" class="secondary" data-load-subscriptions hidden>Carregar mais</button>
    </div>
    <details class="subscription-recent" id="subscription-recent">
      <summary><span class="subscription-identity"><span>
        <strong>Encerradas e expiradas</strong><span class="subscription-meta">Últimas 24 horas</span>
      </span></span></summary>
      <div class="subscription-list">
        <p class="subscription-progress" role="status"></p>
        <div data-items></div>
        <button type="button" class="secondary" data-load-subscriptions hidden>Carregar mais</button>
      </div>
    </details>
    <dialog class="subscription-stop-dialog" id="subscription-stop" aria-labelledby="subscription-stop-title" aria-describedby="subscription-stop-description">
      <h1 id="subscription-stop-title">Encerrar assinatura?</h1>
      <p id="subscription-stop-description"></p>
      <form method="dialog" class="subscription-stop-actions">
        <button class="secondary" value="cancel" autofocus>Manter assinatura</button>
        <button class="secondary danger" value="stop">Encerrar assinatura</button>
      </form>
    </dialog>
  </section>
`;

export const subscriptionScript = `
  const subscriptionsSection = document.querySelector('#subscriptions');
  const currentSubscriptions = document.querySelector('#subscription-current');
  const recentSubscriptions = document.querySelector('#subscription-recent');
  const stopDialog = document.querySelector('#subscription-stop');
  let subscriptionConnection = null;
  let stopTarget;
  const relativeDays = new Intl.RelativeTimeFormat('pt-BR', { numeric:'auto' });
  const subscriptionStatusLabels = { active:'Ativa', expired:'Expirada', cancelled:'Encerrada', revoked:'Autorização revogada' };
  const deliveryStatusLabels = { pending:'Pendente', delivering:'Em processamento', accepted:'Aceita pelo destino', cancelled:'Cancelada', expired:'Expirada', failed:'Falhou' };
  const deliveryReasons = {
    deadline:'Prazo da entrega esgotado', attempt_limit:'Limite de tentativas atingido', unavailable:'Destino indisponível',
    lease_expired:'Tentativa interrompida', authorization:'Sem autorização vigente', cancelled:'Assinatura encerrada',
    expired_or_invalid:'Prazo esgotado ou assinatura inativa', sender_invalid_request:'Entrega inválida',
    sender_destination_blocked:'Destino bloqueado',
  };
  const subscriptionPath = (connectionId, id) => '/api/connections/' + encodeURIComponent(connectionId) + '/subscriptions' + (id ? '/' + encodeURIComponent(id) : '');
  const timeTag = (value) => '<time datetime="' + escapeHtml(value) + '">' + escapeHtml(formatDate(value)) + '</time>';
  const statusLabel = (item) => {
    if (item.state === 'active' && item.authorization !== 'valid') {
      return item.authorization === 'inactive' ? 'Autorização inativa' : 'Autorização não verificada';
    }
    return subscriptionStatusLabels[item.state];
  };
  const localCalendarDay = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());

  function subscriptionTiming(item, today) {
    const date = item.endedAt || item.expiresAt;
    const days = (localCalendarDay(new Date(date)) - today) / 86400000;
    const action = item.state === 'expired' ? 'Expirou' : item.endedAt ? 'Encerrada' : 'Expira';
    const relative = Number.isFinite(days) && (item.endedAt ? days <= 0 : days >= 0) ? relativeDays.format(days, 'day') : 'em';
    return '<span class="subscription-timing"><strong>' + action + ' ' + relative + '</strong>' + timeTag(date) + '</span>';
  }

  function subscriptionRow(item, today) {
    const label = statusLabel(item);
    const tone = item.state === 'active' ? (item.authorization === 'valid' ? ' is-active' : ' is-warning') : '';
    const trigger = item.eventName === 'message.received' ? 'Nova mensagem recebida' : item.eventName;
    const scope = item.conversationId ? 'Uma conversa específica' : 'Todas as conversas';
    return '<details class="subscription-details" data-subscription="' + escapeHtml(item.id) + '">'
      + '<summary><span class="subscription-identity"><span><span class="subscription-name">' + escapeHtml(item.appName)
      + '</span><span class="subscription-meta">' + scope + '</span></span></span>'
      + '<span class="subscription-status' + tone + '">' + escapeHtml(label) + '</span>' + subscriptionTiming(item, today) + '</summary>'
      + '<div class="subscription-body"><div class="subscription-activity"><h4>Entregas nas últimas 24 horas</h4>'
      + '<p class="subscription-progress" role="status"></p><ul class="subscription-deliveries"></ul>'
      + '<button class="secondary" type="button" data-load-deliveries hidden>Carregar mais entregas</button></div>'
      + '<div class="subscription-facts"><h4>Dados da assinatura</h4><dl>'
      + '<dt>Endereço de entrega</dt><dd class="subscription-url">' + escapeHtml(item.callbackUrl) + '</dd>'
      + '<dt>Gatilho</dt><dd>' + escapeHtml(trigger) + '</dd>'
      + (item.conversationId ? '<dt>Conversa</dt><dd><code>' + escapeHtml(item.conversationId) + '</code></dd>' : '')
      + '<dt>Ativada em</dt><dd>' + timeTag(item.activatedAt) + '</dd>'
      + '<dt>Referência da autorização</dt><dd><code>' + escapeHtml(item.authorizationId) + '</code></dd>'
      + '<dt>Referência da assinatura</dt><dd><code>' + escapeHtml(item.id) + '</code></dd></dl>'
      + (item.state === 'active' ? '<button class="text-button" type="button" data-stop-subscription>Encerrar assinatura</button>' : '')
      + '</div></div></details>';
  }

  function updatePageButton(button, cursor, retry) {
    button.hidden = !cursor && !retry;
    button.disabled = false;
    button.dataset.cursor = cursor || '';
    button.textContent = retry ? 'Tentar novamente' : (button.hasAttribute('data-load-deliveries') ? 'Carregar mais entregas' : 'Carregar mais');
  }

  async function loadSubscriptionList(group, cursor) {
    const connectionId = subscriptionConnection;
    if (!connectionId) return;
    const request = Symbol();
    group.subscriptionRequest = request;
    group.dataset.loading = '1';
    const recent = group === recentSubscriptions;
    const items = group.querySelector('[data-items]');
    const progress = group.querySelector('[role=status]');
    const button = group.querySelector('[data-load-subscriptions]');
    if (!cursor) items.replaceChildren();
    button.disabled = true;
    progress.textContent = 'Carregando assinaturas…';
    const query = new URLSearchParams();
    if (recent) query.set('recent', '1');
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await api(subscriptionPath(connectionId) + (query.size ? '?' + query : ''));
      if (group.subscriptionRequest !== request || connectionId !== subscriptionConnection) return;
      const today = localCalendarDay(new Date());
      items.insertAdjacentHTML('beforeend', page.subscriptions.map(item => subscriptionRow(item, today)).join(''));
      progress.textContent = items.childElementCount ? '' : recent ? 'Nenhuma assinatura encerrada ou expirada recentemente.' : 'Nenhuma assinatura vigente nesta conexão.';
      group.dataset.loaded = '1';
      updatePageButton(button, page.nextCursor, false);
    } catch (error) {
      if (group.subscriptionRequest !== request || connectionId !== subscriptionConnection) return;
      progress.textContent = error.sessionExpired ? error.message : 'Não foi possível carregar as assinaturas.';
      updatePageButton(button, cursor, true);
    } finally {
      if (group.subscriptionRequest === request) delete group.dataset.loading;
    }
  }

  function syncSubscriptions(connection) {
    const connectionId = connection?.id || null;
    if (subscriptionConnection === connectionId) return;
    subscriptionConnection = connectionId;
    subscriptionsSection.hidden = !connectionId;
    recentSubscriptions.open = false;
    delete recentSubscriptions.dataset.loaded;
    for (const group of [currentSubscriptions, recentSubscriptions]) {
      group.subscriptionRequest = null;
      delete group.dataset.loading;
      group.querySelector('[data-items]').replaceChildren();
      group.querySelector('[role=status]').textContent = '';
      updatePageButton(group.querySelector('[data-load-subscriptions]'), '', false);
    }
    if (connectionId) loadSubscriptionList(currentSubscriptions);
  }

  function refreshSubscriptions() {
    delete recentSubscriptions.dataset.loaded;
    loadSubscriptionList(currentSubscriptions);
    if (recentSubscriptions.open) loadSubscriptionList(recentSubscriptions);
  }

  function deliveryItem(item) {
    const result = item.result || '';
    const reason = deliveryReasons[result] || (/^http_[1-5][0-9]{2}$/.test(result) ? 'Resposta HTTP ' + result.slice(5) : '');
    const tone = item.state === 'accepted' ? ' class="is-accepted"' : item.state === 'failed' || item.state === 'expired' ? ' class="is-failed"' : '';
    return '<li' + tone + '><strong>' + escapeHtml(deliveryStatusLabels[item.state] || item.state) + '</strong><span class="subscription-received">Recebida '
      + timeTag(item.receivedAt) + '</span><small>' + escapeHtml(item.attempts) + (item.attempts === 1 ? ' tentativa' : ' tentativas')
      + (reason ? ' · ' + escapeHtml(reason) : '') + '</small>'
      + (item.messageId ? '<small>Mensagem <code>' + escapeHtml(item.messageId) + '</code></small>' : '') + '</li>';
  }

  async function loadDeliveries(details, cursor) {
    const connectionId = subscriptionConnection;
    const items = details.querySelector('.subscription-deliveries');
    const progress = details.querySelector('[role=status]');
    const button = details.querySelector('[data-load-deliveries]');
    details.dataset.loading = '1';
    button.disabled = true;
    progress.textContent = 'Carregando entregas…';
    if (!cursor) items.replaceChildren();
    try {
      const page = await api(subscriptionPath(connectionId, details.dataset.subscription) + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''));
      if (!details.isConnected || connectionId !== subscriptionConnection) return;
      items.insertAdjacentHTML('beforeend', page.deliveries.map(deliveryItem).join(''));
      progress.textContent = items.childElementCount ? '' : 'Nenhuma entrega registrada nas últimas 24 horas.';
      details.dataset.loaded = '1';
      updatePageButton(button, page.nextCursor, false);
    } catch (error) {
      if (!details.isConnected || connectionId !== subscriptionConnection) return;
      progress.textContent = error.sessionExpired ? error.message : 'Não foi possível carregar as entregas.';
      updatePageButton(button, cursor, true);
    } finally {
      delete details.dataset.loading;
    }
  }

  subscriptionsSection.addEventListener('toggle', (event) => {
    const details = event.target;
    if (!details.open || details.dataset.loaded || details.dataset.loading) return;
    if (details === recentSubscriptions) loadSubscriptionList(details);
    else if (details.hasAttribute('data-subscription')) loadDeliveries(details);
  }, true);

  subscriptionsSection.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.id === 'refresh-subscriptions') refreshSubscriptions();
    if (button.hasAttribute('data-load-subscriptions')) loadSubscriptionList(button.closest('#subscription-recent, #subscription-current'), button.dataset.cursor);
    const details = button.closest('[data-subscription]');
    if (!details) return;
    if (button.hasAttribute('data-load-deliveries')) loadDeliveries(details, button.dataset.cursor);
    if (button.hasAttribute('data-stop-subscription')) {
      const name = details.querySelector('.subscription-name').textContent;
      stopTarget = { connectionId: subscriptionConnection, id: details.dataset.subscription, button };
      stopDialog.querySelector('p').textContent = name + ' deixará de receber novas notificações desta assinatura. A autorização atual não poderá renová-la.';
      stopDialog.showModal();
    }
  });

  stopDialog.addEventListener('close', async () => {
    const target = stopTarget;
    const confirmed = stopDialog.returnValue === 'stop';
    stopDialog.returnValue = '';
    stopTarget = undefined;
    if (!confirmed || !target || target.connectionId !== subscriptionConnection) return;
    target.button.disabled = true;
    try {
      await api(subscriptionPath(target.connectionId, target.id), { method:'DELETE' });
      if (target.connectionId === subscriptionConnection) {
        if (recentSubscriptions.open) loadSubscriptionList(recentSubscriptions);
        else {
          delete recentSubscriptions.dataset.loaded;
          recentSubscriptions.open = true;
        }
        loadSubscriptionList(currentSubscriptions);
        recentSubscriptions.querySelector('summary').focus();
      }
      showToast('Assinatura encerrada.');
    } catch (error) {
      target.button.disabled = false;
      if (!error.sessionExpired) showToast(error.message);
    }
  });
`;
