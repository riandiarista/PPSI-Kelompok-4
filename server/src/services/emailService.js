import nodemailer from "nodemailer";

let customTransporter = null;

/**
 * Mengatur transporter kustom (berguna untuk testing / mock).
 */
export function setTransporter(transporter) {
  customTransporter = transporter;
}

/**
 * Mendapatkan transporter nodemailer berdasarkan environment variable.
 * Mengembalikan null jika konfigurasi SMTP tidak lengkap.
 */
export function getTransporter() {
  if (customTransporter) return customTransporter;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });
}

/**
 * Mengirim email menggunakan transporter yang aktif atau transporter yang di-inject.
 * Jika konfigurasi SMTP tidak lengkap, mencatat log peringatan dan melewati pengiriman tanpa crash.
 *
 * @param {object} opts
 * @param {string} opts.to      - Alamat email penerima
 * @param {string} opts.subject - Subjek email
 * @param {string} opts.text    - Isi email teks murni
 * @param {string} opts.html    - Isi email HTML
 * @param {object} [mailer]     - Transporter override / mock opsional
 * @returns {Promise<{ success: boolean, skipped?: boolean, messageId?: string }>}
 */
export async function sendEmail({ to, subject, text, html }, mailer = null) {
  const transporter = mailer || getTransporter();

  if (!transporter) {
    console.warn("Konfigurasi SMTP belum lengkap di server/.env. Pengiriman email dilewati:", {
      to,
      subject,
    });
    return { success: false, skipped: true };
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@enventory.unp.ac.id";

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
  });

  return { success: true, messageId: info?.messageId };
}
