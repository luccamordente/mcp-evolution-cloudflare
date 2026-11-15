import { expect, it } from 'vitest';
import { classifyMcpError } from '../src/lib/mcp';
import { toolErrorScenarios } from './helpers/tool-error-scenarios';
import { AttachmentError } from '../src/lib/attachments';
import { EvolutionApiError } from '../src/lib/evolution';
import { SendMessageInputError } from '../src/lib/send-message';
import { SendOperationError } from '../src/lib/send-idempotency';

for (const [code, scenario] of Object.entries(toolErrorScenarios)) {
  if (scenario.kind !== 'classifier') continue;
  it(`classifies ${code} and gives its specific recovery`, () => {
    const error = classifyMcpError(scenario.error(), scenario.operation);
    expect(error).toMatchObject({ code, status: scenario.status, retryable: scenario.retryable, operation: scenario.operation, recovery: { action: scenario.action } });
    expect(error.recovery.tool).toBe(scenario.tool);
    expect(error.message.trim()).not.toBe('');
    expect(error.recovery.steps.length).toBeGreaterThan(0);
    expect(error.recovery.steps.every(step => step.trim().length > 0)).toBe(true);
    expect(error.hint).toBe(error.recovery.steps.join(' '));
    expect(JSON.stringify(error)).not.toMatch(/private-response|private.invalid|secret-value/);
  });
}

it.each([401, 403, 404, 410, 429, 502])('guides file download recovery according to storage status %s', status => {
  const error = classifyMcpError(new AttachmentError('attachment_download_failed', status, 'WaPilot file download failed.'), 'get_message');
  expect(error.retryable).toBe(status === 429 || status >= 500);
  expect(error.recovery.action).toBe(status === 401 || status === 403 ? 'contact_operator' : status === 404 || status === 410 ? 'inspect_message' : 'retry_read');
  expect(error.recovery.retryAfterMs).toBe(error.retryable ? 5000 : undefined);
});

it.each([401, 403])('distinguishes connection authorization from MCP authorization for HTTP %s', status => {
  const error = classifyMcpError(new EvolutionApiError(status, 'private-response'), 'search_contacts');
  expect(error).toMatchObject({ retryable: false, recovery: { action: 'select_connection', tool: 'search_connections' } });
});

it.each([408, 429, 503, 504])('never marks a failed send as automatically retryable for HTTP %s', status => {
  const error = classifyMcpError(new EvolutionApiError(status, 'private-response'), 'send_message');
  expect(error).toMatchObject({ retryable: false, recovery: { action: 'reconcile_send', tool: 'get_message' } });
});

it('keeps media correction distinct from download fallback', () => {
  const error = new SendMessageInputError('media_too_large', 413, 'WaPilot file is too large.');
  expect(classifyMcpError(error, 'send_message').recovery.action).toBe('correct_arguments');
  expect(classifyMcpError(error, 'get_message').recovery.action).toBe('inspect_message');
});

it('reconciles failed status lookups without suggesting another dispatch', () => {
  const error = classifyMcpError(new SendOperationError('send_idempotency_unavailable', 'WaPilot could not read the action record.'), 'get_message');
  expect(error).toMatchObject({ retryable: false, recovery: { action: 'reconcile_send', tool: 'get_message' } });
});

it.each(['search_connections', 'search_contacts', 'search_groups', 'search_messages', 'get_message', 'send_message'])('makes retry policy safe for %s', operation => {
  const error = classifyMcpError(new EvolutionApiError(429, 'WaPilot rate limit.'), operation);
  expect(error.retryable).toBe(operation !== 'send_message');
  expect(error.recovery.action).toBe(operation === 'send_message' ? 'reconcile_send' : 'retry_read');
});

it('distinguishes an unapproved send source from an unapproved read source', () => {
  const error = new SendMessageInputError('media_origin_not_allowed', 400, 'WaPilot does not allow this media origin.');
  expect(classifyMcpError(error, 'send_message').recovery.action).toBe('correct_arguments');
  expect(classifyMcpError(error, 'get_message').recovery.action).toBe('contact_operator');
});
