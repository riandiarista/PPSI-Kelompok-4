
import "dotenv/config";
import app from "./app.js";
import { startReminderScheduler } from "./services/reminderService.js";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Enventory API running on http://localhost:${PORT}`);
  startReminderScheduler();
});
