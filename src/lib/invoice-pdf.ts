import { spreadsheetRequestHeaders } from '@/lib/spreadsheet';

export type InvoicePdfItem = {
  description: string;
  quantity: number;
  quantity_unit: string;
  unit_price: number;
  amount: number;
};

export type InvoicePdfRequest = {
  templateUrl: string;
  detailTemplateUrl?: string | null;
  filename?: string;
  clientName?: string;
  representativeName?: string;
  issueDate?: string | null;
  invoiceNumber?: string | null;
  subject?: string | null;
  dueDate?: string | null;
  taxRate?: number;
  subtotal?: number;
  taxAmount?: number;
  totalAmount?: number;
  notes?: string | null;
  items: InvoicePdfItem[];
};

export function invoicePdfFilename(
  clientLabel: string | null | undefined,
  billingMonth: string,
  invoiceNumber: string | null | undefined
) {
  const match = billingMonth.match(/^(\d{4})-(\d{1,2})/);
  const period = match ? `${match[1]}年${Number(match[2])}月` : billingMonth || '請求';
  const client = (clientLabel || '（名称なし）').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '（名称なし）';
  const number = (invoiceNumber || '未採番').replace(/[\\/:*?"<>|\r\n]/g, '_').trim() || '未採番';
  return `${client}様_${period}分請求書_${number}.pdf`;
}

export type InvoicePdfResult = {
  blob: Blob;
  filename: string;
};

const inflight = new Map<string, Promise<InvoicePdfResult>>();

function base64ToBlob(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: 'application/pdf' });
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

export async function fetchInvoicePdf(input: InvoicePdfRequest) {
  const result = await loadInvoicePdf(input);
  return result.blob;
}

async function loadInvoicePdf(input: InvoicePdfRequest) {
  const key = JSON.stringify(input);
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = requestInvoicePdf(input).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

async function requestInvoicePdf(input: InvoicePdfRequest): Promise<InvoicePdfResult> {
  const response = await fetch('/api/invoices/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders() },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    filename?: string;
    pdfBase64?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || 'PDFの作成に失敗しました。');
  }
  if (!body.pdfBase64) {
    throw new Error('PDFの作成に失敗しました。');
  }
  const blob = base64ToBlob(body.pdfBase64);
  if (!blob.size) {
    throw new Error('PDFの作成に失敗しました。');
  }
  return {
    blob,
    filename: body.filename || input.filename || '請求書.pdf',
  };
}

export async function ensureInvoicePdf(input: InvoicePdfRequest, existingBlob?: Blob | null): Promise<InvoicePdfResult> {
  if (existingBlob) {
    return { blob: existingBlob, filename: input.filename || '請求書.pdf' };
  }
  return loadInvoicePdf(input);
}

export async function checkDrivePdfExists(options: { folderUrl: string; filename: string }) {
  const response = await fetch('/api/invoices/pdf/drive/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders() },
    body: JSON.stringify({
      folderUrl: options.folderUrl,
      filename: options.filename,
    }),
    signal: AbortSignal.timeout(60000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    exists?: boolean;
    fileId?: string | null;
    filename?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || 'Googleドライブの確認に失敗しました。');
  }
  return {
    exists: Boolean(body.exists),
    fileId: body.fileId || null,
    filename: body.filename || options.filename,
  };
}

export async function saveInvoicePdfToDriveFolder(options: {
  folderUrl: string;
  filename: string;
  blob: Blob;
  mode?: 'create' | 'overwrite';
}) {
  const pdfBase64 = await blobToBase64(options.blob);
  const response = await fetch('/api/invoices/pdf/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders() },
    body: JSON.stringify({
      folderUrl: options.folderUrl,
      filename: options.filename,
      pdfBase64,
      mode: options.mode || 'create',
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    fileId?: string;
    exists?: boolean;
    filename?: string;
  };
  if (response.status === 409 || body.exists) {
    const error = new Error(body.error || '同じ名前のファイルが既にあります。');
    (error as Error & { code?: string }).code = 'FILE_EXISTS';
    throw error;
  }
  if (!response.ok) {
    throw new Error(body.error || 'Googleドライブへの保存に失敗しました。');
  }
  return body;
}

export async function createInvoiceGmailDraft(input: {
  filename: string;
  blob: Blob;
  clientName?: string | null;
  contactPersonName?: string | null;
  contactPersonEmail?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  issueDate?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | null;
  dueDate?: string | null;
}) {
  const pdfBase64 = await blobToBase64(input.blob);
  const response = await fetch('/api/invoices/gmail-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...spreadsheetRequestHeaders() },
    body: JSON.stringify({
      filename: input.filename,
      pdfBase64,
      clientName: input.clientName,
      contactPersonName: input.contactPersonName,
      contactPersonEmail: input.contactPersonEmail,
      representativeName: input.representativeName,
      representativeEmail: input.representativeEmail,
      issueDate: input.issueDate,
      invoiceNumber: input.invoiceNumber,
      totalAmount: input.totalAmount,
      dueDate: input.dueDate,
    }),
    signal: AbortSignal.timeout(120000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    draftId?: string;
    subject?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || 'Gmail下書きの作成に失敗しました。');
  }
  return body;
}

export function suggestRenamedPdfFilename(filename: string) {
  const trimmed = filename.trim() || '請求書.pdf';
  const match = trimmed.match(/^(.*?)(?:\s*\((\d+)\))?(\.pdf)$/i);
  if (!match) return `${trimmed} (2).pdf`;
  const base = match[1];
  const n = match[2] ? Number(match[2]) + 1 : 2;
  const ext = match[3] || '.pdf';
  return `${base} (${n})${ext}`;
}
