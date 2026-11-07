export const SEND_RECEIPT_LABELS = {
  accepted: 'Envio aceito',
  failed: 'Falha confirmada',
  unknown: 'Não foi possível confirmar o envio',
} as const;

export interface SendReceipt {
  text: string;
  to: string;
  connectionId?: string;
  connectionName?: string;
  state: keyof typeof SEND_RECEIPT_LABELS;
}
