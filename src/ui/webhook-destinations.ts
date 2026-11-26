export const webhookDestinationStyles = `
  .webhook-destinations { margin-top:42px; padding-top:33px; border-top:1px solid var(--line); }
  .webhook-destinations .lede { margin:6px 0 16px; font-size:14px; }
  .webhook-destinations .authorization-row { margin-bottom:10px; align-items:start; }
  .webhook-destinations code { overflow-wrap:anywhere; }
  .webhook-destinations summary { cursor:pointer; }
  .webhook-destination-form { max-width:660px; display:grid; gap:12px; margin:14px 0 18px; }
  .webhook-destination-form label { display:grid; gap:4px; font-size:13px; font-weight:700; }
  .webhook-destination-form small { color:var(--muted); font-weight:400; }
  .webhook-destination-form :is(input, select, textarea) { min-width:0; width:100%; padding:8px 10px; font:inherit; color:var(--ink); border:1px solid var(--line); border-radius:8px; background:var(--surface); }
  .webhook-destination-form button { justify-self:start; }
  .webhook-destination-actions { display:grid; gap:10px; }
  .webhook-destination-actions form { margin-bottom:0; }
  @media (max-width:620px) { .webhook-destinations .authorization-row { grid-template-columns:1fr; } }
`;

export const webhookDestinationSection = `
  <section class="webhook-destinations" id="webhook-destinations" aria-labelledby="webhook-destinations-title" hidden>
    <div class="section-heading"><div><h3 id="webhook-destinations-title">Destinos de webhook</h3>
      <p class="lede">Compartilhe novas mensagens de conversas escolhidas com um aplicativo que precisa de webhook.</p></div></div>
    <p id="webhook-destination-status" role="status"></p>
    <div id="webhook-destination-list"></div>
    <details id="webhook-destination-add">
      <summary>Adicionar destino</summary>
      <form class="webhook-destination-form" id="webhook-destination-form" method="post">
        <label>Nome do destino <input name="label" maxlength="80" required></label>
        <label>Aplicativo autorizado <select name="grantId" required><option value="">Selecione</option></select></label>
        <label>URL do webhook <input type="url" name="url" maxlength="2048" autocomplete="off" required></label>
        <label>Chave do webhook <input type="password" data-webhook-key maxlength="1026" autocomplete="new-password" required></label>
        <label>Conversas permitidas <textarea name="conversationIds" rows="3" maxlength="10050" required></textarea>
          <small>Informe um número de telefone ou ID de conversa por linha.</small></label>
        <p class="lede">Ao salvar, você permite o envio de IDs e prévias de novas mensagens dessas conversas. Exemplo de prévia: “A reunião começa às 10h.”</p>
        <button class="primary-btn" type="submit">Salvar destino</button>
      </form>
    </details>
  </section>
`;

export const webhookDestinationScript = String.raw`
  const webhookDestinationsSection = document.querySelector('#webhook-destinations');
  const webhookDestinationList = document.querySelector('#webhook-destination-list');
  const webhookDestinationStatus = document.querySelector('#webhook-destination-status');
  const webhookDestinationForm = document.querySelector('#webhook-destination-form');
  const webhookDestinationAdd = document.querySelector('#webhook-destination-add');
  let webhookConnectionId;
  let webhookListRequest;

  function renderWebhookGrantOptions(grants) {
    const select = webhookDestinationForm.elements.namedItem('grantId');
    const selected = select.value;
    const choices = grants.filter((grant) => Array.isArray(grant.scopes) && grant.scopes.includes('mcp:read'));
    select.replaceChildren(new Option('Selecione', ''));
    for (const grant of choices) {
      const name = grant.clientName || grant.clientId;
      const parts = [name, grant.redirectHost, formatDate(grant.createdAt)].filter(Boolean);
      select.add(new Option(parts.join(' · '), grant.id));
    }
    if (choices.some((grant) => grant.id === selected)) select.value = selected;
  }

  function webhookDestinationPath(connectionId, destinationId) {
    return '/api/connections/' + encodeURIComponent(connectionId) + '/webhook-destinations'
      + (destinationId ? '/' + encodeURIComponent(destinationId) : '');
  }

  function webhookDestinationItem(item) {
    const enabled = item.state === 'active';
    const id = escapeHtml(item.id);
    return '<article class="authorization-row"><div><strong>' + escapeHtml(item.label) + '</strong>'
      + '<p>' + escapeHtml(item.hostname) + ' · ' + (enabled ? 'Ativo' : 'Desativado') + '</p>'
      + '<p>ID do destino <code>' + id + '</code></p><p>Conversas permitidas '
      + item.conversationIds.map((entry) => '<code>' + escapeHtml(entry) + '</code>').join(', ') + '</p></div>'
      + (enabled ? '<div class="webhook-destination-actions"><details><summary>Trocar chave</summary>'
        + '<form class="webhook-destination-form" method="post" data-rotate-destination="' + id + '">'
        + '<label>Nova chave do webhook <input type="password" data-webhook-key maxlength="1026" autocomplete="new-password" required></label>'
        + '<button class="secondary" type="submit">Salvar chave</button></form></details>'
        + '<button class="text-button" type="button" data-disable-destination="' + id + '">Desativar destino</button></div>' : '')
      + '</article>';
  }

  async function loadWebhookDestinations(connectionId) {
    const request = Symbol();
    webhookListRequest = request;
    try {
      const result = await api(webhookDestinationPath(connectionId));
      if (webhookConnectionId !== connectionId || webhookListRequest !== request) return;
      webhookDestinationList.innerHTML = (result.destinations || []).map(webhookDestinationItem).join('');
      webhookDestinationStatus.textContent = result.destinations?.length ? '' : 'Nenhum destino cadastrado.';
    } catch (error) {
      if (webhookConnectionId !== connectionId || webhookListRequest !== request) return;
      webhookDestinationStatus.textContent = error.message;
    }
  }

  function syncWebhookDestinations(connection) {
    const connectionId = connection?.id;
    if (webhookConnectionId === connectionId) return;
    webhookConnectionId = connectionId;
    webhookDestinationsSection.hidden = !connectionId;
    webhookDestinationForm.reset();
    webhookDestinationAdd.open = false;
    webhookDestinationList.replaceChildren();
    webhookDestinationStatus.textContent = 'Carregando destinos…';
    if (connectionId) loadWebhookDestinations(connectionId);
  }

  webhookDestinationsSection.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target;
    const connectionId = webhookConnectionId;
    const destinationId = form.dataset.rotateDestination;
    const button = form.querySelector('[type=submit]');
    if (!connectionId || button.disabled) return;
    const fields = new FormData(form);
    const keyInput = form.querySelector('[data-webhook-key]');
    const key = keyInput.value;
    keyInput.value = '';
    const body = destinationId ? { key } : {
      key, url: fields.get('url'), label: fields.get('label'), grantId: fields.get('grantId'),
      conversationIds: String(fields.get('conversationIds')).split(/\r?\n/).map((id) => id.trim()).filter(Boolean),
    };
    button.disabled = true;
    try {
      await api(webhookDestinationPath(connectionId, destinationId), { method: destinationId ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      if (webhookConnectionId !== connectionId) return;
      form.reset();
      webhookDestinationAdd.open = false;
      await loadWebhookDestinations(connectionId);
      showToast(destinationId ? 'Chave atualizada.' : 'Destino salvo. Use o ID do destino para criar uma assinatura.');
    } catch (error) {
      showToast(error.message);
    } finally { button.disabled = false; }
  });

  webhookDestinationList.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-disable-destination]');
    const connectionId = webhookConnectionId;
    if (!connectionId || !button || !window.confirm('Desativar este destino e encerrar as assinaturas vinculadas?')) return;
    button.disabled = true;
    try {
      await api(webhookDestinationPath(connectionId, button.dataset.disableDestination), { method:'DELETE' });
      if (webhookConnectionId !== connectionId) return;
      refreshSubscriptions();
      await loadWebhookDestinations(connectionId);
      showToast('Destino desativado.');
    } catch (error) {
      showToast(error.message);
    } finally { button.disabled = false; }
  });
`;
