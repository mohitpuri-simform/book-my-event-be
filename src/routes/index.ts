import { Router } from "express";
import authRoutes from "./auth.routes";
import eventRoutes from "./event.routes";
import organiserRoutes from "./organiser.routes";
import profileRoutes from "./profile.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/events", eventRoutes);
router.use("/organiser", organiserRoutes);

export default router;
