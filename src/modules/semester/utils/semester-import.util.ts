import { BadRequestException } from '@nestjs/common';
import { Workbook } from 'exceljs';

export interface SemesterImportRow {
  row_number: number;
  semester_code: string;
  role: string;
  email: string;
  full_name: string;
  class_code: string;
  class_name: string;
  student_id: string;
}

const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const REQUIRED_HEADERS = [
  'semester_code',
  'role',
  'email',
  'full_name',
  'class_code',
  'class_name',
];

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

    const read = (header: string) =>
      (row.getCell(headerIndex.get(header) || 0).value || '').toString().trim();

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
      !role &&
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
      role,
      email,
      full_name: fullName,
      class_code: classCode,
      class_name: className,
      student_id: studentId,
    });
  });

  return rows;
}
