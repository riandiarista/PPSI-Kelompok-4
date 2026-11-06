
import express from "express";
import cors from "cors";
import db from "./config/db.js";
import authRoutes from "./routes/auth.js";

const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to Enventory API",
  });
});

// Health check (API + koneksi database)
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.status(200).json({
      success: true,
      message: "Enventory API is running",
      database: "connected",
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: "Enventory API is running, but database is unreachable",
      database: "disconnected",
    });
  }
});

// Routes
app.use("/api/auth", authRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Endpoint not found",
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
  });
});

export default app;
