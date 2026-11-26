/**
 * reminderService.js — Pengingat email jatuh tempo peminjaman (H-1).
 *
 * Mengirimkan email pengingat otomatis kepada peminjam pada H-1 sebelum
 * tanggal jatuh tempo pengembalian barang (loan_transactions.due_at)
 * dalam zona waktu WIB (Asia/Jakarta).
 */

import db from "../config/db.js";
import { POINT_RULES } from "./returnService.js";
import { getPointSettings } from "./pointSettingsService.js";
import { sendEmail } from "./emailService.js";
import cron from "node-cron";

export const NOTIFICATION_TYPE_DUE_H_MINUS_1 = "due_h_minus_1";
export const NOTIFICATION_TYPE_DUE_H_MINUS_2 = "due_h_minus_2"; // Alias untuk kompatibilitas ke belakang
export const REMINDER_ADVISORY_LOCK_ID = 8472910;

/**
 * Mengubah objek Date atau string tanggal menjadi format "YYYY-MM-DD" dalam zona waktu WIB.
 */
export function toDateStringWib(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(date));
}

/**
 * Menghitung selisih hari kalender dalam zona waktu WIB antara due_at dan now.
 * Positif jika due_at di masa depan, 0 jika hari ini, negatif jika sudah lewat.
 */
export function calculateDaysDiffWib(dueDate, nowDate = new Date()) {
  const dueWib = toDateStringWib(dueDate);
  const nowWib = toDateStringWib(nowDate);
  const dueUtcMs = Date.parse(`${dueWib}T00:00:00Z`);
  const nowUtcMs = Date.parse(`${nowWib}T00:00:00Z`);
  return Math.round((dueUtcMs - nowUtcMs) / (24 * 60 * 60 * 1000));
}

/**
 * Format tanggal dan jam jatuh tempo dalam bahasa Indonesia dan WIB.
 * Contoh output: "Jumat, 21 Nov 2026, 14.00 WIB"
 */
export function formatDueDateTimeWib(date) {
  const d = new Date(date);
  const dateStr = new Intl.DateTimeFormat("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  }).format(d);

  const timeStr = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Jakarta",
  })
    .format(d)
    .replace(":", ".");

  return `${dateStr}, ${timeStr} WIB`;
}

/**
 * Format frasa selisih hari jatuh tempo.
 * Contoh: "jatuh tempo dalam 2 hari", "jatuh tempo dalam 1 hari", "jatuh tempo dalam 0 hari (hari ini)".
 */
export function formatDueTimephrase(daysDiff) {
  if (daysDiff === 0) {
    return "jatuh tempo dalam 0 hari (hari ini)";
  }
  return `jatuh tempo dalam ${daysDiff} hari`;
}

/**
 * Membangun isi email pengingat jatuh tempo (subjek, plain text, dan HTML sederhana).
 * Fungsi murni, mudah diuji tanpa koneksi database atau SMTP.
 */
export function buildDueReminderEmail({ borrowerName, itemName, dueAt, daysLeft, latePerDay = POINT_RULES.LATE_PER_DAY }) {
  const formattedDueAt = formatDueDateTimeWib(dueAt);
  const dueInText = formatDueTimephrase(daysLeft);
  const penaltyPerDay = Math.abs(latePerDay);

  const subject = `[Pengingat] Pengembalian ${itemName} ${
    daysLeft === 0 ? "Jatuh Tempo Hari Ini" : `Jatuh Tempo dalam ${daysLeft} Hari`
  }`;

  const text = `Halo ${borrowerName},

Ini adalah pengingat bahwa peminjaman barang "${itemName}" akan ${dueInText}, yaitu pada ${formattedDueAt}.

Harap pastikan barang dikembalikan ke Tenaga Kependidikan (Tendik) tepat waktu sebelum batas waktu tersebut. Keterlambatan pengembalian akan dikenakan pengurangan poin sebesar ${penaltyPerDay} poin per hari.

Terima kasih atas kerja samanya dalam menjaga inventaris departemen.

--
Email otomatis dari Enventory, jangan dibalas`;

  const html = `<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #14231F; max-width: 600px; margin: 0 auto; border: 1px solid #E5E7EB; border-radius: 8px; padding: 24px; background-color: #ffffff;">
  <div style="border-bottom: 2px solid #1E3F70; padding-bottom: 12px; margin-bottom: 20px;">
    <h2 style="color: #1E3F70; margin: 0; font-size: 20px;">Pengingat Batas Waktu Pengembalian Barang</h2>
  </div>
  <p>Halo <strong>${borrowerName}</strong>,</p>
  <p>Ini adalah pengingat bahwa peminjaman barang <strong>${itemName}</strong> akan <strong>${dueInText}</strong>, tepatnya pada:</p>
  <div style="background-color: #F8FAF9; border-left: 4px solid #1E3F70; padding: 12px 16px; margin: 16px 0; font-size: 15px;">
    <strong>${formattedDueAt}</strong>
  </div>
  <p>Harap pastikan barang dikembalikan ke Tenaga Kependidikan (Tendik) tepat waktu sebelum batas waktu tersebut.</p>
  <div style="background-color: #FEF6E6; border: 1px solid #FFE8B8; border-radius: 6px; padding: 12px; margin: 16px 0; color: #855302; font-size: 13.5px;">
    ⚠️ <strong>Perhatian:</strong> Keterlambatan pengembalian akan dikenakan pengurangan poin disiplin sebesar <strong>${penaltyPerDay} poin per hari</strong>.
  </div>
  <p>Terima kasih atas kerja samanya dalam menjaga inventaris departemen.</p>
  <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 24px 0 16px 0;" />
  <p style="font-size: 12px; color: #71827D; margin: 0; text-align: center;">Email otomatis dari Enventory, jangan dibalas</p>
</div>`;

  return { subject, text, html };
}

/**
 * Mencari daftar transaksi peminjaman yang menjadi target pengingat H-1 (selisih 0–1 hari WIB).
 */
export async function getDueReminderTargets({ now = new Date(), client = db } = {}) {
  const query = `
    SELECT
      lt.loan_id,
      lt.due_at,
      lt.transaction_status,
      r.request_id,
      r.borrower_id,
      u.full_name AS borrower_name,
      u.email     AS borrower_email,
      u.is_active AS borrower_active,
      i.item_id,
      i.item_name,
      nl.notification_id,
      nl.status   AS notification_status,
      COALESCE(nl.attempts, 0) AS attempts
    FROM loan_transactions lt
    JOIN loan_requests r ON r.request_id = lt.request_id
    JOIN users u ON u.user_id = r.borrower_id
    JOIN items i ON i.item_id = r.item_id
    LEFT JOIN notification_logs nl
      ON nl.loan_id = lt.loan_id
     AND nl.notification_type = $2
    WHERE lt.transaction_status = 'borrowed'
      AND u.is_active = TRUE
      AND u.email IS NOT NULL AND TRIM(u.email) <> ''
      AND ((lt.due_at AT TIME ZONE 'Asia/Jakarta')::date - ($1::timestamptz AT TIME ZONE 'Asia/Jakarta')::date) BETWEEN 0 AND 1
      AND (nl.notification_id IS NULL OR (nl.status = 'failed' AND nl.attempts < 3))
    ORDER BY lt.due_at ASC, lt.loan_id ASC
  `;

  const { rows } = await client.query(query, [now, NOTIFICATION_TYPE_DUE_H_MINUS_1]);

  return rows
    .map((r) => {
      const daysDiff = calculateDaysDiffWib(r.due_at, now);
      return {
        ...r,
        days_diff: daysDiff,
      };
    })
    .filter((r) => r.days_diff >= 0 && r.days_diff <= 1);
}

/**
 * Menjalankan pengiriman email pengingat jatuh tempo H-1.
 * Idempotent, menggunakan pg_try_advisory_lock, mencatat notification_logs dan audit_logs.
 *
 * @param {object} opts
 * @param {Date}   [opts.now]    - Waktu acuan saat ini (default: new Date())
 * @param {object} [opts.mailer] - Transporter override untuk mock/testing
 * @param {boolean} [opts.dryRun] - Jika true, hanya mencari dan mengembalikan target tanpa kirim email/tulis DB
 */
export async function sendDueReminders({ now = new Date(), mailer = null, dryRun = false } = {}) {
  if (dryRun) {
    const targets = await getDueReminderTargets({ now, client: db });
    return {
      dryRun: true,
      total: targets.length,
      targets,
    };
  }

  const client = await db.connect();
  let lockAcquired = false;

  try {
    const { rows: lockRows } = await client.query(
      "SELECT pg_try_advisory_lock($1) AS acquired",
      [REMINDER_ADVISORY_LOCK_ID]
    );
    lockAcquired = Boolean(lockRows[0]?.acquired);

    if (!lockAcquired) {
      console.log("Pengingat jatuh tempo sedang diproses oleh instance lain, proses dilewati.");
      return {
        skipped: true,
        reason: "locked",
        total: 0,
        sent: 0,
        failed: 0,
      };
    }

    const targets = await getDueReminderTargets({ now, client });
    const { rules } = await getPointSettings(client);
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const results = [];

    for (const target of targets) {
      const emailContent = buildDueReminderEmail({
        borrowerName: target.borrower_name,
        itemName: target.item_name,
        dueAt: target.due_at,
        daysLeft: target.days_diff,
        latePerDay: rules.LATE_PER_DAY,
      });

      try {
        const sendResult = await sendEmail(
          {
            to: target.borrower_email,
            subject: emailContent.subject,
            text: emailContent.text,
            html: emailContent.html,
          },
          mailer
        );

        if (sendResult?.skipped) {
          skippedCount++;
          results.push({
            loan_id: target.loan_id,
            borrower_email: target.borrower_email,
            status: "skipped",
          });
          continue;
        }

        // Catat sukses ke notification_logs (upsert)
        await client.query(
          `INSERT INTO notification_logs
             (loan_id, user_id, notification_type, status, attempts, last_error, sent_at)
           VALUES ($1, $2, $3, 'sent', 1, NULL, NOW())
           ON CONFLICT (loan_id, notification_type)
           DO UPDATE SET
             status = 'sent',
             attempts = notification_logs.attempts + 1,
             last_error = NULL,
             sent_at = NOW()`,
          [target.loan_id, target.borrower_id, NOTIFICATION_TYPE_DUE_H_MINUS_1]
        );

        // Catat ke audit_logs (KF-25)
        await client.query(
          `INSERT INTO audit_logs
             (actor_user_id, action_type, entity_type, entity_id, details)
           VALUES (NULL, 'send_due_reminder', 'loan', $1, $2)`,
          [
            target.loan_id,
            JSON.stringify({
              loan_id: target.loan_id,
              borrower_id: target.borrower_id,
              borrower_email: target.borrower_email,
              item_name: target.item_name,
              due_at: new Date(target.due_at).toISOString(),
              days_diff: target.days_diff,
            }),
          ]
        );

        sentCount++;
        results.push({
          loan_id: target.loan_id,
          borrower_email: target.borrower_email,
          status: "sent",
        });
      } catch (err) {
        failedCount++;
        const errorMessage = err?.message || String(err);
        console.error(
          `Gagal mengirim email pengingat loan_id ${target.loan_id} ke ${target.borrower_email}:`,
          errorMessage
        );

        // Catat kegagalan ke notification_logs (upsert)
        await client.query(
          `INSERT INTO notification_logs
             (loan_id, user_id, notification_type, status, attempts, last_error, sent_at)
           VALUES ($1, $2, $3, 'failed', 1, $4, NULL)
           ON CONFLICT (loan_id, notification_type)
           DO UPDATE SET
             status = 'failed',
             attempts = notification_logs.attempts + 1,
             last_error = $4`,
          [target.loan_id, target.borrower_id, NOTIFICATION_TYPE_DUE_H_MINUS_1, errorMessage]
        );

        results.push({
          loan_id: target.loan_id,
          borrower_email: target.borrower_email,
          status: "failed",
          error: errorMessage,
        });
      }
    }

    return {
      total: targets.length,
      sent: sentCount,
      failed: failedCount,
      skipped: skippedCount,
      results,
    };
  } finally {
    if (lockAcquired) {
      await client.query("SELECT pg_advisory_unlock($1)", [REMINDER_ADVISORY_LOCK_ID]).catch(() => {});
    }
    client.release();
  }
}

/**
 * Memulai scheduler cron untuk pengingat jatuh tempo harian pada 08:00 WIB
 * serta menjalankan satu kali saat startup server untuk catch-up.
 */
export function startReminderScheduler() {
  const enabled = process.env.REMINDER_ENABLED !== "false" && process.env.REMINDER_ENABLED !== "0";
  if (!enabled) {
    console.log("Pengingat jatuh tempo dinonaktifkan (REMINDER_ENABLED=false)");
    return null;
  }

  const cronPattern = process.env.REMINDER_CRON || "0 8 * * *";

  // Jalankan sekali saat startup untuk catch-up (server baru nyala)
  sendDueReminders().catch((err) => {
    console.error("Gagal menjalankan catch-up pengingat jatuh tempo saat startup:", err.message);
  });

  // Jadwalkan cron reguler di zona waktu Asia/Jakarta
  const task = cron.schedule(
    cronPattern,
    async () => {
      console.log(`[Cron] Menjalankan pengingat jatuh tempo (${new Date().toISOString()})...`);
      try {
        const result = await sendDueReminders();
        console.log(`[Cron] Selesai: ${result.sent} terkirim, ${result.failed} gagal dari ${result.total} target.`);
      } catch (err) {
        console.error("[Cron] Error saat menjalankan pengingat jatuh tempo:", err.message);
      }
    },
    {
      timezone: "Asia/Jakarta",
    }
  );

  console.log(`Scheduler pengingat jatuh tempo aktif: '${cronPattern}' (Asia/Jakarta)`);
  return task;
}

