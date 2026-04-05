import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';

export interface SemesterImportRow {
  row_number: number;
  semester_code: string;
  role?: string;
  email: string;
  full_name: string;
  class_code: string;
  class_name?: string;
  student_id: string;
}

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const REQUIRED_HEADERS = [
  'semester_code',
  'email',
  'full_name',
  'class_code',
  'student_id',
];

function normalizeCellValue(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return '';
  if (depth > 4) return '';

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    const joined = value
      .map((item) => normalizeCellValue(item, depth + 1))
      .filter(Boolean)
      .join('')
      .trim();
    return joined;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;

    const mailto = normalizeCellValue(record.hyperlink, depth + 1);
    if (mailto.toLowerCase().startsWith('mailto:')) {
      return mailto.slice('mailto:'.length).trim();
    }

    const prioritized = ['text', 'result', 'richText', 'value'];
    for (const key of prioritized) {
      const extracted = normalizeCellValue(record[key], depth + 1);
      if (extracted) return extracted;
    }

    for (const nested of Object.values(record)) {
      const extracted = normalizeCellValue(nested, depth + 1);
      if (extracted) return extracted;
    }

    try {
      const json = JSON.stringify(record);
      if (json) {
        const emailMatch = json.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
        if (emailMatch?.[0]) return emailMatch[0];
      }
    } catch {
      return '';
    }
  }

  return '';
}

export async function parseSemesterImportFile(
  buffer: Buffer,
  mimeType: string,
): Promise<SemesterImportRow[]> {
  if (!XLSX_MIME_TYPES.has(mimeType)) {
    throw new BadRequestException('Only Excel/XLSX files are allowed.');
  }

  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];

  if (!sheet || sheet.rowCount < 2) {
    throw new BadRequestException('XLSX file is empty or has no data rows.');
  }

  const headerValues = (sheet.getRow(1).values as Array<string | undefined>)
    .slice(1)
    .map((value) => (value || '').toString().trim().toLowerCase());

  const missingHeaders = REQUIRED_HEADERS.filter(
    (header) => !headerValues.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new BadRequestException(
      `Missing required columns: ${missingHeaders.join(', ')}.`,
    );
  }

  const headerIndex = new Map(
    headerValues.map((header, index) => [header, index + 1]),
  );

  const rows: SemesterImportRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const read = (header: string) => {
      const index = headerIndex.get(header);
      if (!index) return '';
      return normalizeCellValue(row.getCell(index).value);
    };

    const email = read('email');
    const semesterCode = read('semester_code');
    const role = read('role');
    const fullName = read('full_name');
    const classCode = read('class_code');
    const className = read('class_name');
    const studentId = read('student_id');

    if (
      !semesterCode &&
      !email &&
      !fullName &&
      !classCode &&
      !className &&
      !studentId
    ) {
      return;
    }

    rows.push({
      row_number: rowNumber,
      semester_code: semesterCode,
      role: role || undefined,
      email,
      full_name: fullName,
      class_code: classCode,
      class_name: className || undefined,
      student_id: studentId,
    });
  });

  return rows;
}
