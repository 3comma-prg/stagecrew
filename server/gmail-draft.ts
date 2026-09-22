import { google } from 'googleapis';
import { JWT } from 'google-auth-library';

export type InvoiceGmailDraftInput = {
  filename?: string;
  pdfBase64?: string;
  clientName?: string | null;
  contactPersonName?: string | null;
  contactPersonEmail?: string | null;
  representativeName?: string | null;
  representativeEmail?: string | null;
  issueDate?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | string | null;
  dueDate?: string | null;
};

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.settings.basic',
];

const MISSING_SENDER = '設定画面で送信元メールアドレスを設定してください';

export function familyName(fullName: string | null | undefined) {
  const trimmed = (fullName || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[ \u3000]+/).filter(Boolean);
  return parts[0] || trimmed;
}

function formatDueDate(value: string | null | undefined) {
  const text = (value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return text;
  return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
}

/** 件名・本文用。発行日を「yyyy年m月分」にする */
function formatIssuePeriod(value: string | null | undefined) {
  const text = (value || '').trim();
  const match = text.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?/);
  if (!match) return text;
  return `${match[1]}年${Number(match[2])}月分`;
}

function formatYen(value: number | string | null | undefined) {
  const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  const amount = Number.isFinite(number) ? Math.round(number) : 0;
  return amount.toLocaleString('ja-JP');
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function looksLikeHtml(text: string) {
  return /<\/?[a-z][\s\S]*>/i.test(text);
}

function stripHtml(text: string) {
  return text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function encodeRfc2047(text: string) {
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function encodeFilename(filename: string) {
  const safe = filename.replace(/[\r\n"]/g, '').trim() || 'invoice.pdf';
  // Gmail は filename= の ASCII フォールバックを優先表示するため、RFC 2047 で日本語を入れる
  const encoded = encodeRfc2047(safe);
  return `filename="${encoded}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function toBase64Url(value: Buffer | string) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function wrapBase64(value: string) {
  return value.replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/g, '');
}

export function resolveInvoiceRecipients(input: InvoiceGmailDraftInput) {
  const contactName = (input.contactPersonName || '').trim();
  const contactEmail = (input.contactPersonEmail || '').trim();
  const representativeName = (input.representativeName || '').trim();
  const representativeEmail = (input.representativeEmail || '').trim();
  const clientName = (input.clientName || '').trim();

  if (contactName) {
    if (!contactEmail) {
      throw new Error('担当者メールアドレスがありません。クライアント情報を確認してください。');
    }
    const greetingLines = [clientName, `${familyName(contactName)}様`];
    if (representativeName) greetingLines.push(`cc ${familyName(representativeName)}様`);
    return {
      to: contactEmail,
      cc: representativeEmail || undefined,
      greeting: greetingLines.filter(Boolean).join('\n'),
    };
  }

  if (!representativeEmail) {
    throw new Error('代表者メールアドレスがありません。クライアント情報を確認してください。');
  }
  const representativeLast = familyName(representativeName) || representativeName;
  const greeting = [clientName, representativeLast ? `${representativeLast}様` : ''].filter(Boolean).join('\n');
  return { to: representativeEmail, cc: undefined as string | undefined, greeting };
}

function textToHtml(text: string) {
  return escapeHtml(text).replace(/\n/g, '<br>\r\n');
}

function buildBodies(input: InvoiceGmailDraftInput, greeting: string, signatureHtml: string) {
  const issueDate = formatIssuePeriod(input.issueDate);
  const dueDate = formatDueDate(input.dueDate);
  const invoiceNumber = (input.invoiceNumber || '').trim() || '（未採番）';
  const amount = formatYen(input.totalAmount);
  const signatureText = signatureHtml ? stripHtml(signatureHtml) : '';

  const plainCore = [
    greeting,
    '',
    'いつもお世話になっております。',
    '',
    `${issueDate}の請求書をお送りいたします。`,
    '添付ファイルのPDFをご確認ください。',
    '',
    '■ ご請求概要',
    `・請求書番号: ${invoiceNumber}`,
    `・ご請求金額: ¥${amount}（税込）`,
    `・お支払期限: ${dueDate}`,
    '',
    '内容にご不明な点や相違などがございましたら、大変お手数ですがご連絡いただけますと幸いです。',
    'ご査収のほど、よろしくお願い申し上げます。',
  ].join('\n');

  const htmlSignature = signatureHtml
    ? looksLikeHtml(signatureHtml)
      ? signatureHtml
      : textToHtml(signatureHtml)
    : '';

  const plain = signatureText ? `${plainCore}\n\n${signatureText}` : plainCore;
  const html = `<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#111">${textToHtml(plainCore)}${
    htmlSignature ? `<br>\r\n<br>\r\n${htmlSignature}` : ''
  }</div>`;

  return { plain, html };
}

function buildMime(options: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  plain: string;
  html: string;
  filename: string;
  pdfBytes: Buffer;
}) {
  const mixed = `mixed_${Date.now().toString(36)}`;
  const alt = `alt_${Date.now().toString(36)}`;
  const headers = [
    `From: ${options.from}`,
    `To: ${options.to}`,
    ...(options.cc ? [`Cc: ${options.cc}`] : []),
    `Subject: ${encodeRfc2047(options.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
  ];

  const pdfB64 = wrapBase64(options.pdfBytes.toString('base64'));
  const plainB64 = wrapBase64(Buffer.from(options.plain, 'utf8').toString('base64'));
  const htmlB64 = wrapBase64(Buffer.from(options.html, 'utf8').toString('base64'));

  return [
    headers.join('\r\n'),
    '',
    `--${mixed}`,
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    '',
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    plainB64,
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${alt}--`,
    `--${mixed}`,
    `Content-Type: application/pdf; name="${encodeRfc2047(options.filename.replace(/[\r\n"]/g, '').trim() || 'invoice.pdf')}"`,
    `Content-Disposition: attachment; ${encodeFilename(options.filename)}`,
    'Content-Transfer-Encoding: base64',
    '',
    pdfB64,
    `--${mixed}--`,
    '',
  ].join('\r\n');
}

async function fetchDefaultSignature(gmail: ReturnType<typeof google.gmail>, senderEmail: string) {
  const listed = await gmail.users.settings.sendAs.list({ userId: 'me' });
  const aliases = listed.data.sendAs || [];
  const sender = senderEmail.toLowerCase();
  const preferred =
    aliases.find((item) => item.isDefault) ||
    aliases.find((item) => item.isPrimary) ||
    aliases.find((item) => (item.sendAsEmail || '').toLowerCase() === sender) ||
    aliases[0];
  return preferred?.signature || '';
}

function gmailErrorMessage(error: unknown) {
  const err = error as {
    message?: string;
    code?: number | string;
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const status = Number(err.code || err.response?.status || 0);
  const message = err.response?.data?.error?.message || err.message || String(error);
  if (status === 401 || status === 403 || /unauthorized_client|invalid_grant|not authorized/i.test(message)) {
    return 'Gmail APIのドメイン全体の委任ができません。Google Cloud で Gmail API を有効にし、サービスアカウントに gmail.compose と gmail.settings.basic のスコープを委任してください。';
  }
  return `Gmail下書きの作成に失敗しました。${message.slice(0, 240)}`;
}

export async function createInvoiceGmailDraft(options: {
  serviceAccountEmail: string;
  privateKey: string;
  senderEmail: string;
  input: InvoiceGmailDraftInput;
}) {
  const senderEmail = options.senderEmail.trim();
  if (!senderEmail) {
    throw new Error(MISSING_SENDER);
  }
  const pdfBytes = Buffer.from(options.input.pdfBase64 || '', 'base64');
  if (!pdfBytes.length) {
    throw new Error('添付する請求書PDFがありません。');
  }
  const filename = (options.input.filename || '請求書.pdf').replace(/[\r\n]/g, ' ').trim() || '請求書.pdf';
  const recipients = resolveInvoiceRecipients(options.input);
  const clientName = (options.input.clientName || '').trim() || '（名称なし）';
  const issueDate = formatIssuePeriod(options.input.issueDate);
  const subject = `【ご請求書】${clientName}様 ${issueDate}請求書送付のご連絡`;

  const auth = new JWT({
    email: options.serviceAccountEmail,
    key: options.privateKey,
    scopes: GMAIL_SCOPES,
    subject: senderEmail,
  });
  const gmail = google.gmail({ version: 'v1', auth });

  let signature = '';
  try {
    signature = await fetchDefaultSignature(gmail, senderEmail);
  } catch (error) {
    throw new Error(gmailErrorMessage(error));
  }

  const bodies = buildBodies(options.input, recipients.greeting, signature);
  const mime = buildMime({
    from: senderEmail,
    to: recipients.to,
    cc: recipients.cc,
    subject,
    plain: bodies.plain,
    html: bodies.html,
    filename,
    pdfBytes,
  });

  try {
    const created = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw: toBase64Url(mime) },
      },
    });
    return {
      draftId: created.data.id || '',
      messageId: created.data.message?.id || '',
      to: recipients.to,
      cc: recipients.cc || null,
      subject,
    };
  } catch (error) {
    throw new Error(gmailErrorMessage(error));
  }
}

export const MISSING_GMAIL_SENDER_MESSAGE = MISSING_SENDER;
