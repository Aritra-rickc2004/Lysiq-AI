import express from "express";
import cors from "cors";
import "dotenv/config";
import { serve } from "inngest/express";

import { inngest } from "./Inngest/client.js";
import { onUserSignup } from "./Inngest/functions/on-signup.js";
import { onTicketCreated } from "./Inngest/functions/on-ticket-create.js";

import userRoutes from "./routes/user.js";
import ticketRoutes from "./routes/ticket.js";

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    service: "AI Ticket Assistant Backend",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/users", userRoutes);
app.use("/api/tickets", ticketRoutes);

// Inngest serve endpoint for background jobs & AI triage
app.use(
  "/api/inngest",
  serve({
    client: inngest,
    functions: [onUserSignup, onTicketCreated],
    signingKey: process.env.INNGEST_SIGNING_KEY,
    mode: process.env.INNGEST_DEV === "1" ? "dev" : "cloud",
  })
);

app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 Inngest serve endpoint: http://localhost:${port}/api/inngest`);
});
