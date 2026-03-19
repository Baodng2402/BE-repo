import { Workbook } from 'exceljs';
import { parseSemesterImportFile } from './semester-import.util';

describe('parseSemesterImportFile', () => {
  it('parses a valid XLSX worksheet with semester-first import columns', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Import');
    sheet.addRow([
      'semester_code',
      'role',
      'email',
      'full_name',
      'class_code',
      'class_name',
      'student_id',
    ]);
    sheet.addRow([
      'SP26',
      'LECTURER',
      'lecturer@fpt.edu.vn',
      'Lecturer A',
      'SWP391',
      'Software Project',
      '',
    ]);
    sheet.addRow([
      'SP26',
      'STUDENT',
      'student@fpt.edu.vn',
      'Student B',
      'SWP391',
      'Software Project',
      'SE0001',
    ]);

    const buffer = await workbook.xlsx.writeBuffer();

    const result = await parseSemesterImportFile(
      Buffer.from(buffer),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      semester_code: 'SP26',
      role: 'LECTURER',
      email: 'lecturer@fpt.edu.vn',
      class_code: 'SWP391',
    });
    expect(result[1]).toMatchObject({
      semester_code: 'SP26',
      role: 'STUDENT',
      student_id: 'SE0001',
    });
  });

  it('throws when required semester-first columns are missing', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Import');
    sheet.addRow(['role', 'email', 'class_code', 'class_name']);
    sheet.addRow(['LECTURER', 'lecturer@fpt.edu.vn', 'SWP391', 'Software']);

    const buffer = await workbook.xlsx.writeBuffer();

    await expect(
      parseSemesterImportFile(
        Buffer.from(buffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).rejects.toThrow('Missing required columns');
  });
});
