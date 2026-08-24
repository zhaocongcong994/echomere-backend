import "dotenv/config";
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import profileRoutes from "./routes/profile.js";
import profilesRoutes from "./routes/profiles.js";
import onboardingRoutes from "./routes/onboarding.js";
import baziRoutes from "./routes/bazi.js";
import conversationsRoutes from "./routes/conversations.js";
import chatRoutes from "./routes/chat.js";
import dailyFortuneRoutes from "./routes/dailyFortune.js";
import subscriptionRoutes from "./routes/subscription.js";
import { errorHandler } from "./middleware.js";

const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://81.70.23.109:8080",
    ],
    credentials: true,
  })
);
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/profiles", profilesRoutes);
app.use("/api/onboarding", onboardingRoutes);
app.use("/api/bazi", baziRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/daily-fortune", dailyFortuneRoutes);
app.use("/api/subscription", subscriptionRoutes);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`[backend] Server running on port ${PORT}`);
});
