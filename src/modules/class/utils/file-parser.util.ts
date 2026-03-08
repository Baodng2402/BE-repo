import { BadRequestException } from '@nestjs/common';
import * as Papa from 'papaparse';
import { Workbook } from 'exceljs';

export interface StudentRow {
  email: string;
  student_id: string;
  full_name: string;
}

const MAX_ROWS = 50;
const REQUIRED_COLUMNS = ['email', 'student_id', 'full_name'];

const CSV_MIME_TYPES = new Set(['text/csv', 'application/csv']);
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

export async function parseStudentFile(
  buffer: Buffer,
  mimeType: string,
): Promise<StudentRow[]> {
  let rows: StudentRow[];

  if (CSV_MIME_TYPES.has(mimeType)) {
    rows = parseCsv(buffer);
  } else if (XLSX_MIME_TYPES.has(mimeType)) {
    rows = await parseXlsx(buffer);
  } else {
    throw new BadRequestException(
      `Unsupported file type: ${mimeType}. Use CSV or XLSX.`,
    );
  }

  if (rows.length > MAX_ROWS) {
    throw new BadRequestException(
      `File has ${rows.length} rows, which exceeds maximum of 50 students per import.`,
    );
  }

  return rows;
}

function parseCsv(buffer: Buffer): StudentRow[] {
  const text = buffer.toString('utf-8');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim().toLowerCase(),
  });

  validateHeaders(parsed.meta.fields || []);

  return parsed.data.map((row) => ({
    email: (row.email || '').trim(),
    student_id: (row.student_id || '').trim(),
    full_name: (row.full_name || '').trim(),
  }));
}

async function parseXlsx(buffer: Buffer): Promise<StudentRow[]> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];

  if (!sheet || sheet.rowCount < 2) {
    throw new BadRequestException('XLSX file is empty or has no data rows.');
  }

  const headerRow = sheet.getRow(1);
  const headers = headerRow.values as (string | undefined)[];
  // exceljs row.values is 1-indexed, so headers[0] is undefined
  const normalizedHeaders = headers
    .slice(1)
    .map((h) => (h || '').toString().trim().toLowerCase());

  validateHeaders(normalizedHeaders);

  const rows: StudentRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header
    const values = row.values as (string | undefined)[];
    const email = (values[1] || '').toString().trim();
    const student_id = (values[2] || '').toString().trim();
    const full_name = (values[3] || '').toString().trim();

    if (email) {
      rows.push({ email, student_id, full_name });
    }
  });

  return rows;
}

function validateHeaders(headers: string[]): void {
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new BadRequestException(
      `Missing required columns: ${missing.join(', ')}. Expected: email, student_id, full_name`,
    );
  }
}
