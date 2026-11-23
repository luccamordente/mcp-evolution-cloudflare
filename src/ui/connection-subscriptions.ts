export const subscriptionStyles = `
  .subscriptions { margin-top:42px; padding-top:33px; border-top:1px solid var(--line); }
  .subscription-list { display:grid; gap:10px; }
  .subscriptions button[hidden] { display:none; }
  .subscriptions [data-load-subscriptions], .subscriptions [data-load-deliveries] { justify-self:start; margin-top:6px; }
  .subscription-card { min-width:0; padding:16px 18px; background:var(--surface); border:1px solid var(--line); border-radius:14px; box-shadow:0 5px 16px rgba(16,32,25,.035); }
  .subscription-header, .subscription-toolbar { display:flex; align-items:center; flex-wrap:wrap; justify-content:space-between; gap:8px 16px; }
  .subscription-header h4, .subscription-toolbar h5 { margin:0; font-size:15px; overflow-wrap:anywhere; }
  .subscription-card p { margin:4px 0; color:var(--muted); font-size:13px; line-height:1.5; }
  .subscription-card .subscription-url { color:var(--ink); overflow-wrap:anywhere; }
  .subscription-dates { display:flex; flex-wrap:wrap; gap:0 18px; }
  .subscription-status { padding:4px 10px; border-radius:999px; color:var(--ink); background:var(--canvas); font-size:12px; font-weight:700; }
  .subscription-status.is-active { color:#0b3021; background:var(--mint); }
  .subscription-status.is-warning { color:#755011; background:var(--amber-soft); }
  .subscription-details summary, .subscription-recent > summary { width:fit-content; cursor:pointer; color:#126e39; font-size:13px; font-weight:700; }
  .subscription-details summary { margin-top:11px; }
  .subscription-recent > summary { padding-block:14px; }
  .subscription-body { margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
  .subscription-reference { overflow-wrap:anywhere; }
  .subscription-toolbar { margin-top:14px; }
  .subscription-toolbar .text-button { color:var(--red); }
  .subscription-deliveries { margin:8px 0 0; padding:0; list-style:none; }
  .subscription-deliveries li { display:grid; grid-template-columns:1fr auto; gap:2px 12px; padding:8px 0; border-bottom:1px solid var(--line); font-size:13px; }
  .subscription-deliveries small { color:var(--muted); overflow-wrap:anywhere; grid-column:1 / -1; }
  .subscription-progress { margin:0; color:var(--muted); font-size:13px; }
  .subscription-progress:empty { display:none; }
  .subscription-stop-dialog { width:min(100% - 32px, 440px); padding:24px; color:var(--ink); background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); }
  .subscription-stop-dialog h1 { margin:0; font-size:24px; }
  .subscription-stop-dialog p { color:var(--muted); font-size:14px; line-height:1.5; }
  .subscription-stop-dialog:modal { overscroll-behavior:contain; }
  .subscription-stop-dialog::backdrop { background:rgba(15,27,37,.45); overflow:hidden; overscroll-behavior:contain; }
  .subscription-stop-actions { display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end; }
  .subscription-stop-actions .danger { color:var(--red); }
  @media (max-width:520px) {
    .subscription-card { padding:14px; }
    .subscription-deliveries li { grid-template-columns:1fr; }
  }
`;

export const subscriptionSection = `
  <section class="subscriptions" id="subscriptions" hidden aria-labelledby="subscriptions-title">
    <div class="section-heading">
      <h3 id="subscriptions-title">Assinaturas de mensagens</h3>
      <button class="text-button" type="button" id="refresh-subscriptions" aria-label="Atualizar assinaturas">Atualizar →</button>
    </div>
    <div class="subscription-list" id="subscription-current">
      <p class="subscription-progress" role="status"></p>
      <div class="subscription-list" data-items></div>
      <button type="button" class="secondary" data-load-subscriptions hidden>Carregar mais</button>
    </div>
    <details class="subscription-recent" id="subscription-recent">
      <summary>Encerradas e expiradas nas últimas 24 horas</summary>
      <div class="subscription-list">
        <p class="subscription-progress" role="status"></p>
        <div class="subscription-list" data-items></div>
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
  const dateLine = (item) => '<div class="subscription-dates"><p>Ativada em ' + timeTag(item.activatedAt) + '</p><p>'
    + (item.endedAt ? (item.state === 'expired' ? 'Expirou em ' : 'Encerrada em ') + timeTag(item.endedAt) : 'Expira em ' + timeTag(item.expiresAt)) + '</p></div>';

  function subscriptionCard(item) {
    const label = statusLabel(item);
    const tone = item.state === 'active' ? (item.authorization === 'valid' ? ' is-active' : ' is-warning') : '';
    const trigger = item.eventName === 'message.received' ? 'Nova mensagem recebida' : item.eventName;
    const filter = item.conversationId ? 'Conversa ' + item.conversationId : 'Todas as conversas';
    return '<article class="subscription-card"><div class="subscription-header"><h4>' + escapeHtml(item.appName)
      + '</h4><span class="subscription-status' + tone + '">' + escapeHtml(label) + '</span></div>'
      + '<p>' + escapeHtml(trigger) + ' · ' + escapeHtml(filter) + '</p>'
      + '<p class="subscription-url">' + escapeHtml(item.callbackUrl) + '</p>' + dateLine(item)
      + '<details class="subscription-details" data-subscription="' + escapeHtml(item.id) + '">'
      + '<summary>Ver detalhes<span class="sr-only"> de ' + escapeHtml(item.appName) + '</span></summary>'
      + '<div class="subscription-body"><p class="subscription-reference">Autorização <code>' + escapeHtml(item.authorizationId) + '</code></p>'
      + '<p class="subscription-reference">Assinatura <code>' + escapeHtml(item.id) + '</code></p>'
      + '<div class="subscription-toolbar"><h5>Entregas nas últimas 24 horas</h5>'
      + (item.state === 'active' ? '<button class="text-button" type="button" data-stop-subscription>Encerrar assinatura</button>' : '')
      + '</div><p class="subscription-progress" role="status"></p><ul class="subscription-deliveries"></ul>'
      + '<button class="secondary" type="button" data-load-deliveries hidden>Carregar mais entregas</button></div></details></article>';
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
      items.insertAdjacentHTML('beforeend', page.subscriptions.map(subscriptionCard).join(''));
      progress.textContent = items.childElementCount ? '' : recent ? 'Nenhuma assinatura encerrada ou expirada recentemente.' : 'Nenhuma assinatura ativa nesta conexão.';
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
    return '<li><strong>' + escapeHtml(deliveryStatusLabels[item.state] || item.state) + '</strong><span>Recebida '
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
      const name = details.closest('article').querySelector('h4').textContent;
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
