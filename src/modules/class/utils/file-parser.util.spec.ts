import { Workbook } from 'exceljs';
import { parseStudentFile } from './file-parser.util';

describe('parseStudentFile', () => {
  describe('CSV parsing', () => {
    it('should parse valid CSV with 3 columns', async () => {
      const csv = Buffer.from(
        'email,student_id,full_name\nstudent1@fpt.edu.vn,SE12345,Nguyen Van A\nstudent2@fpt.edu.vn,SE12346,Tran Thi B',
      );

      const result = await parseStudentFile(csv, 'text/csv');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        email: 'student1@fpt.edu.vn',
        student_id: 'SE12345',
        full_name: 'Nguyen Van A',
      });
    });

    it('should trim whitespace from values', async () => {
      const csv = Buffer.from(
        'email,student_id,full_name\n  student1@fpt.edu.vn , SE12345 , Nguyen Van A  ',
      );

      const result = await parseStudentFile(csv, 'text/csv');

      expect(result[0].email).toBe('student1@fpt.edu.vn');
      expect(result[0].student_id).toBe('SE12345');
      expect(result[0].full_name).toBe('Nguyen Van A');
    });

    it('should skip empty rows', async () => {
      const csv = Buffer.from(
        'email,student_id,full_name\nstudent1@fpt.edu.vn,SE12345,Nguyen Van A\n\n\n',
      );

      const result = await parseStudentFile(csv, 'text/csv');

      expect(result).toHaveLength(1);
    });
  });

  describe('XLSX parsing', () => {
    it('should parse valid XLSX buffer', async () => {
      // Build a minimal XLSX in memory using exceljs
      const workbook = new Workbook();
      const sheet = workbook.addWorksheet('Students');
      sheet.addRow(['email', 'student_id', 'full_name']);
      sheet.addRow(['a@fpt.edu.vn', 'SE001', 'Student A']);
      sheet.addRow(['b@fpt.edu.vn', 'SE002', 'Student B']);
      const buffer = await workbook.xlsx.writeBuffer();

      const result = await parseStudentFile(
        Buffer.from(buffer),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        email: 'a@fpt.edu.vn',
        student_id: 'SE001',
        full_name: 'Student A',
      });
    });
  });

  describe('validation', () => {
    it('should throw on unsupported mime type', async () => {
      await expect(
        parseStudentFile(Buffer.from('data'), 'application/pdf'),
      ).rejects.toThrow('Unsupported file type');
    });

    it('should throw if header row is missing required columns', async () => {
      const csv = Buffer.from('email,name\na@b.com,Test');

      await expect(parseStudentFile(csv, 'text/csv')).rejects.toThrow(
        'Missing required columns',
      );
    });

    it('should throw if more than 50 rows', async () => {
      const rows = Array.from(
        { length: 51 },
        (_, i) => `s${i}@fpt.edu.vn,SE${i},Student ${i}`,
      ).join('\n');
      const csv = Buffer.from(`email,student_id,full_name\n${rows}`);

      await expect(parseStudentFile(csv, 'text/csv')).rejects.toThrow(
        'exceeds maximum of 50',
      );
    });
  });
});
