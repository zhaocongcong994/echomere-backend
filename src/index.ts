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

app.use("/auth", authRoutes);
app.use("/profile", profileRoutes);
app.use("/profiles", profilesRoutes);
app.use("/onboarding", onboardingRoutes);
app.use("/bazi", baziRoutes);
app.use("/conversations", conversationsRoutes);
app.use("/chat", chatRoutes);
app.use("/daily-fortune", dailyFortuneRoutes);
app.use("/subscription", subscriptionRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use(errorHandler);

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`[backend] Server running on port ${PORT}`);
});
