import { loadSettings } from '@/lib/local-store';
import { spreadsheetIdFromInput } from '@/types';

export function spreadsheetRequestHeaders(): Record<string, string> {
  const id = spreadsheetIdFromInput(loadSettings().data_spreadsheet_url);
  return id ? { 'X-Spreadsheet-Id': id } : {};
}
