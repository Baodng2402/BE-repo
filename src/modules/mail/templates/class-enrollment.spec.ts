import { classEnrollmentEmail } from './class-enrollment';

describe('classEnrollmentEmail', () => {
  it('should include class info and enrollment key for existing user', () => {
    const result = classEnrollmentEmail({
      className: 'Software Architecture',
      classCode: 'SWP391',
      semester: 'SP26',
      lecturerName: 'Dr. Nguyen',
      enrollmentKey: 'A1B2C3D4',
    });

    expect(result.subject).toContain('SWP391');
    expect(result.html).toContain('Software Architecture');
    expect(result.html).toContain('SP26');
    expect(result.html).toContain('Dr. Nguyen');
    expect(result.html).toContain('A1B2C3D4');
    expect(result.html).not.toContain('temporary password');
  });

  it('should include temp password for new user', () => {
    const result = classEnrollmentEmail({
      className: 'Software Architecture',
      classCode: 'SWP391',
      semester: 'SP26',
      lecturerName: 'Dr. Nguyen',
      enrollmentKey: 'A1B2C3D4',
      tempPassword: 'xK9mP2nQ',
    });

    expect(result.html).toContain('xK9mP2nQ');
    expect(result.html).toContain('temporary password');
  });

  it('should handle missing semester gracefully', () => {
    const result = classEnrollmentEmail({
      className: 'Test Class',
      classCode: 'TEST101',
      semester: null,
      lecturerName: 'Dr. Test',
      enrollmentKey: 'ABCD1234',
    });

    expect(result.subject).toContain('TEST101');
    expect(result.html).not.toContain('null');
  });
});
