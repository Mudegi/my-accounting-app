import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';

// Lazy-load xlsx to avoid crashes on React Native module init
let _XLSX: typeof import('xlsx') | null = null;
async function getXLSX() {
  if (!_XLSX) _XLSX = await import('xlsx');
  return _XLSX;
}

/* ── CSV helpers ── */

const escapeCsv = (val: any): string => {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

const toCsv = (headers: string[], rows: any[][]): string => {
  const lines = [headers.map(escapeCsv).join(',')];
  rows.forEach(row => lines.push(row.map(escapeCsv).join(',')));
  return lines.join('\n');
};

/* ── Export ── */

export async function exportData(
  businessName: string,
  label: string,
  headers: string[],
  rows: any[][],
  format: 'csv' | 'xlsx',
) {
  const date = new Date().toISOString().split('T')[0];
  const safeName = businessName.replace(/[^a-zA-Z0-9]/g, '_');

  if (format === 'csv') {
    const csv = toCsv(headers, rows);
    const filename = `${safeName}_${label}_${date}.csv`;
    const file = new File(Paths.cache, filename);
    file.write(csv);
    const uri = file.uri;
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: `Export ${label}` });
  } else {
    const XLSX = await getXLSX();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, label);
    const xlsxData = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    const filename = `${safeName}_${label}_${date}.xlsx`;
    const file = new File(Paths.cache, filename);
    file.write(xlsxData, { encoding: 'base64' });
    const uri = file.uri;
    await Sharing.shareAsync(uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: `Export ${label}`,
    });
  }
}

/* ── Import ── */

export async function importData(
  expectedHeaders: string[],
): Promise<Record<string, string>[] | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      'text/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const uri = asset.uri;
  const name = asset.name?.toLowerCase() || '';

  let rows: Record<string, string>[];

  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const XLSX = await getXLSX();
    const file = new File(uri);
    const base64 = await file.text();
    const wb = XLSX.read(base64, { type: 'string' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
  } else {
    // CSV
    const file = new File(uri);
    const text = await file.text();
    rows = parseCsv(text);
  }

  if (!rows.length) return null;

  // Validate headers
  const fileHeaders = Object.keys(rows[0]).map(h => h.trim().toLowerCase());
  const missing = expectedHeaders.filter(
    h => !fileHeaders.includes(h.toLowerCase()),
  );
  if (missing.length > 0) {
    throw new Error(
      `Missing columns: ${missing.join(', ')}.\nExpected: ${expectedHeaders.join(', ')}`,
    );
  }

  return rows;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const result: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (vals[idx] || '').trim();
    });
    result.push(row);
  }
  return result;
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}
