interface ClassEnrollmentData {
  className: string;
  classCode: string;
  semester: string | null;
  lecturerName: string;
  enrollmentKey: string;
  tempPassword?: string;
}

export function classEnrollmentEmail(data: ClassEnrollmentData): {
  subject: string;
  html: string;
} {
  const subject = `You've been added to ${data.classCode} — Enrollment Key Inside`;

  const semesterLine = data.semester
    ? `<p><strong>Semester:</strong> ${data.semester}</p>`
    : '';

  const passwordSection = data.tempPassword
    ? `
    <div style="background:#fff3cd;padding:12px;border-radius:4px;margin:12px 0">
      <p style="margin:0">An account has been created for you.</p>
      <p style="margin:4px 0"><strong>Your temporary password:</strong> <code>${data.tempPassword}</code></p>
      <p style="margin:0;font-size:13px">Please change your password after signing in.</p>
    </div>`
    : '';

  const html = `
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 16px">Class Enrollment</h2>
  <p>You have been added to <strong>${data.className}</strong> (${data.classCode}) by <strong>${data.lecturerName}</strong>.</p>
  ${semesterLine}
  <div style="background:#e8f4fd;padding:12px;border-radius:4px;margin:12px 0">
    <p style="margin:0"><strong>Enrollment Key:</strong> <code style="font-size:16px">${data.enrollmentKey}</code></p>
  </div>
  ${passwordSection}
  <p style="font-size:13px;color:#666">Use this key to join the class after signing in.</p>
</div>`;

  return { subject, html };
}
