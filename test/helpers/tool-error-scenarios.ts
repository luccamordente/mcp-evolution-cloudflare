import {ContactUpdateError} from '../../src/lib/update-contact';
import { AttachmentError } from '../../src/lib/attachments';
import { AudioTranscriptionError } from '../../src/lib/audio-transcription';
import { DocumentReadingError } from '../../src/lib/document-reading';
import { EvolutionApiError, MessageImageError } from '../../src/lib/evolution';
import { InsufficientScopeError, type McpErrorCode } from '../../src/lib/mcp';
import { OptionsError } from '../../src/lib/mcp-options';
import { PdfProcessingError } from '../../src/lib/pdf-policy';
import { SendOperationError } from '../../src/lib/send-idempotency';
import { SendMessageInputError } from '../../src/lib/send-message';
import type { ErrorRecovery } from '../../src/lib/tool-recovery';

type Expectation = { status: number; retryable: boolean; action: ErrorRecovery['action']; tool?: ErrorRecovery['tool'] };
type ErrorScenario = Expectation & (
  { kind: 'classifier'; error: () => Error; operation: string } |
  { kind: 'mcp' }
);

const inspect = { status: 422, retryable: false, action: 'inspect_message', tool: 'get_message' } satisfies Expectation;
const operator = { status: 500, retryable: false, action: 'contact_operator' } satisfies Expectation;
const correct = { status: 400, retryable: false, action: 'correct_arguments' } satisfies Expectation;
const reconcile = { status: 409, retryable: false, action: 'reconcile_send', tool: 'get_message' } satisfies Expectation;
const readRetry = { status: 503, retryable: true, action: 'retry_read' } satisfies Expectation;
const choose = { status: 409, retryable: false, action: 'select_connection', tool: 'search_connections' } satisfies Expectation;
const classified = (error: () => Error, expectation: Expectation, operation = 'get_message'): ErrorScenario => ({ kind: 'classifier', error, operation, ...expectation });

export const toolErrorScenarios: Record<McpErrorCode, ErrorScenario> = {
  contact_result_unknown: classified(() => new ContactUpdateError("contact_result_unknown","Inspect the contact."), {status:409,retryable:false,action:"stop"}, "update_contact"),
  contact_update_pending: classified(() => new ContactUpdateError("contact_update_pending","Inspect the contact."), {status:409,retryable:false,action:"stop"}, "update_contact"),
  idempotency_conflict: classified(() => new SendOperationError('idempotency_conflict', 'WaPilot received different arguments for the same action key.'), reconcile, 'send_message'),
  send_in_progress: classified(() => new SendOperationError('send_in_progress', 'WaPilot cannot confirm this send yet.'), reconcile, 'send_message'),
  send_result_unknown: classified(() => new SendOperationError('send_result_unknown', 'WaPilot could not confirm the earlier send.'), reconcile, 'send_message'),
  send_idempotency_unavailable: classified(() => new SendOperationError('send_idempotency_unavailable', 'WaPilot could not reserve this action safely.'), { ...operator, status: 503, tool: 'get_message' }, 'send_message'),
  connection_not_found: classified(() => new Error('Connection not found'), { ...choose, status: 404 }),
  insufficient_scope: classified(() => new InsufficientScopeError(), { status: 403, retryable: false, action: 'reauthorize' }, 'send_message'),
  no_default_connection: classified(() => new Error('No default connection configured'), choose),
  multiple_default_connections: classified(() => new Error('Multiple default connections configured'), choose),
  request_deadline_exceeded: classified(() => new PdfProcessingError('request_deadline_exceeded', 504, 'WaPilot PDF processing exceeded its deadline.'), { ...inspect, status: 504 }),
  dependency_timeout: classified(() => new AudioTranscriptionError('dependency_timeout', 504, 'WaPilot audio source timed out.'), { ...inspect, status: 504 }),
  service_unavailable: classified(() => new EvolutionApiError(503, 'WaPilot is unreachable'), readRetry, 'search_contacts'),
  service_request_failed: classified(() => new EvolutionApiError(429, 'private-response https://private.invalid/file Bearer secret-value'), { ...readRetry, status: 429 }, 'search_groups'),
  media_too_large: classified(() => new SendMessageInputError('media_too_large', 413, 'WaPilot attachment exceeds its size limit.'), { ...correct, status: 413 }, 'send_message'),
  message_not_found: { kind: 'mcp', status: 404, retryable: false, action: 'inspect_message', tool: 'search_messages' },
  message_content_unavailable: { kind: 'mcp', status: 404, retryable: false, action: 'inspect_message', tool: 'search_messages' },
  message_content_pending: { kind: 'mcp', status: 409, retryable: false, action: 'inspect_message', tool: 'get_message' },
  message_unavailable: { kind: 'mcp', ...readRetry },
  image_unavailable: classified(() => new MessageImageError(415, 'WaPilot native image display cannot read this file.'), { ...inspect, status: 415 }),
  audio_unavailable: classified(() => new AudioTranscriptionError('audio_unavailable', 404, 'WaPilot audio source is unavailable.'), { ...inspect, status: 404 }),
  transcription_unavailable: classified(() => new AudioTranscriptionError('transcription_unavailable', 503, 'WaPilot transcription is unavailable.'), { ...inspect, status: 503 }),
  transcription_failed: classified(() => new AudioTranscriptionError('transcription_failed', 502, 'WaPilot could not transcribe this audio.'), { ...inspect, status: 502 }),
  no_speech: classified(() => new AudioTranscriptionError('no_speech', 422, 'WaPilot could not recognize speech.'), inspect),
  pdf_invalid: classified(() => new PdfProcessingError('pdf_invalid', 422, 'WaPilot could not open this PDF.'), { ...correct, status: 422, tool: 'get_message' }),
  pdf_limit: classified(() => new PdfProcessingError('pdf_limit', 413, 'WaPilot PDF rendering exceeds its limits.'), { ...correct, status: 413, tool: 'get_message' }),
  pdf_page_unavailable: classified(() => new PdfProcessingError('pdf_page_unavailable', 422, 'WaPilot could not render this page.'), { ...correct, status: 422, tool: 'get_message' }),
  document_unavailable: classified(() => new DocumentReadingError('document_unavailable', 404, 'WaPilot could not retrieve the PDF.'), { ...inspect, status: 404 }),
  document_reading_unavailable: classified(() => new DocumentReadingError('document_reading_unavailable', 503, 'WaPilot PDF text extraction is unavailable.'), { ...inspect, status: 503 }),
  document_conversion_failed: classified(() => new DocumentReadingError('document_conversion_failed', 502, 'WaPilot could not extract PDF text.'), { ...inspect, status: 502 }),
  no_document_text: classified(() => new DocumentReadingError('no_document_text', 422, 'WaPilot found no extractable PDF text.'), inspect),
  document_text_too_large: classified(() => new DocumentReadingError('document_text_too_large', 413, 'WaPilot cannot return this much PDF text.'), { ...inspect, status: 413 }),
  request_cancelled: classified(() => new DOMException('Cancelled', 'AbortError'), { status: 499, retryable: false, action: 'stop' }),
  invalid_base64: classified(() => new SendMessageInputError('invalid_base64', 400, 'WaPilot requires valid Base64 bytes.'), correct, 'send_message'),
  connection_credentials_unavailable: classified(() => new Error('Invalid encrypted token'), operator),
  send_action_conflict: classified(() => new SendOperationError('send_action_conflict', 'WaPilot cannot reserve a key owned by another action.'), reconcile, 'send_message'),
  media_origin_not_allowed: classified(() => new AttachmentError('media_origin_not_allowed', 502, 'WaPilot cannot access this media origin.'), { ...operator, status: 502 }),
  attachment_not_found: classified(() => new AttachmentError('attachment_not_found', 404, 'WaPilot could not find this attachment.'), { ...inspect, status: 404 }),
  attachment_source_unavailable: classified(() => new AttachmentError('attachment_source_unavailable', 404, 'WaPilot has no downloadable file source.'), { ...inspect, status: 404 }),
  attachment_download_failed: classified(() => new AttachmentError('attachment_download_failed', 502, 'WaPilot could not reach attachment storage.'), { ...readRetry, status: 502 }),
  attachment_links_unavailable: classified(() => new AttachmentError('attachment_links_unavailable', 503, 'WaPilot could not create a public download link.'), { ...operator, status: 503, tool: 'get_message' }),
  attachment_link_invalid: classified(() => new AttachmentError('attachment_link_invalid', 401, 'WaPilot attachment link is invalid.'), { ...inspect, status: 401 }),
  attachment_link_expired: classified(() => new AttachmentError('attachment_link_expired', 401, 'WaPilot attachment link has expired.'), { ...inspect, status: 401 }),
  attachment_configuration_error: classified(() => new AttachmentError('attachment_configuration_error', 500, 'WaPilot attachment size configuration is invalid.'), { ...operator, tool: 'get_message' }),
  responses_unavailable: { kind: 'mcp', ...inspect, status: 404 },
  invalid_options: classified(() => new OptionsError('invalid_options', 'WaPilot requires offset >= 0.'), correct, 'search_messages'),
  incompatible_include: classified(() => new OptionsError('incompatible_include', 'WaPilot cannot transcribe a video.'), { ...correct, tool: 'get_message' }),
  unsupported_include: classified(() => new OptionsError('unsupported_include', 'WaPilot cannot list reactions.'), { ...correct, tool: 'get_message' }),
  incompatible_encoding_format: classified(() => new OptionsError('incompatible_encoding_format', 'WaPilot cannot return this video as a PDF.'), { ...correct, tool: 'get_message' }),
  unexpected_error: classified(() => new Error('private-response https://private.invalid/file Bearer secret-value'), operator),
};
