export type OptInChoice = 'always' | 'once' | 'never';

export interface CandidateMessage {
  type: 'candidate';
  url: string;
  isArticle: boolean;
  title?: string;
}

export interface OptInResponseMessage {
  type: 'opt-in-response';
  domain: string;
  choice: OptInChoice;
}

export interface ManualArchiveMessage {
  type: 'manual-archive';
  url: string;
}

export type Message = CandidateMessage | OptInResponseMessage | ManualArchiveMessage;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isCandidateMessage(v: unknown): v is CandidateMessage {
  return (
    isRecord(v) &&
    v.type === 'candidate' &&
    typeof v.url === 'string' &&
    typeof v.isArticle === 'boolean'
  );
}

export function isOptInResponseMessage(v: unknown): v is OptInResponseMessage {
  return (
    isRecord(v) &&
    v.type === 'opt-in-response' &&
    typeof v.domain === 'string' &&
    (v.choice === 'always' || v.choice === 'once' || v.choice === 'never')
  );
}

export function isManualArchiveMessage(v: unknown): v is ManualArchiveMessage {
  return isRecord(v) && v.type === 'manual-archive' && typeof v.url === 'string';
}
