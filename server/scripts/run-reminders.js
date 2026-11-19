// Menjalankan pengecekan dan pengiriman pengingat jatuh tempo H-1 secara manual.
//   npm run reminders:run              -> proses dan kirim email
//   npm run reminders:run -- --dry-run -> hanya mencetak siapa yang akan dikirimi
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });
dotenv.config();

const { default: db } = await import("../src/config/db.js");
const { sendDueReminders, formatDueDateTimeWib } = await import("../src/services/reminderService.js");

async function main() {
  const isDryRun =
    process.argv.includes("--dry-run") ||
    process.env.npm_config_dry_run === "true" ||
    process.env.DRY_RUN === "true";

  console.log(`=== PENGINGAT JATUH TEMPO PEMINJAMAN (H-1) ===`);
  console.log(`Mode: ${isDryRun ? "DRY RUN (Hanya Menampilkan Target)" : "KIRIM SEBENARNYA"}`);
  console.log(`Waktu: ${new Date().toISOString()}`);

  try {
    const result = await sendDueReminders({ dryRun: isDryRun });

    if (isDryRun) {
      console.log(`\nDitemukan ${result.total} peminjaman yang mendekati jatuh tempo (0–1 hari WIB):`);
      if (result.targets.length === 0) {
        console.log("  Tidak ada peminjaman yang memerlukan pengingat saat ini.");
      } else {
        result.targets.forEach((t, i) => {
          console.log(`  ${i + 1}. [Loan #${t.loan_id}] ${t.borrower_name} <${t.borrower_email}>`);
          console.log(`     Barang     : ${t.item_name}`);
          console.log(`     Jatuh Tempo: ${formatDueDateTimeWib(t.due_at)}`);
          console.log(`     Selisih    : ${t.days_diff} hari (WIB)`);
        });
      }
    } else {
      console.log(`\nHasil Pengiriman:`);
      console.log(`  Total Target : ${result.total}`);
      console.log(`  Berhasil     : ${result.sent}`);
      console.log(`  Gagal        : ${result.failed}`);
      console.log(`  Dilewati     : ${result.skipped}`);

      if (result.results && result.results.length > 0) {
        console.log(`\nDetail:`);
        result.results.forEach((r) => {
          console.log(
            `  - Loan #${r.loan_id} -> ${r.borrower_email} [${r.status.toUpperCase()}]${
              r.error ? ` (${r.error})` : ""
            }`
          );
        });
      }
    }
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error("Terjadi kesalahan:", err);
  process.exit(1);
});
