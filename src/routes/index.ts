import { Router } from "express";
import authRoutes from "./auth.routes";
import checkoutRoutes from "./checkout.routes";
import eventRoutes from "./event.routes";
import holdRoutes from "./hold.routes";
import meRoutes from "./me.routes";
import organiserRoutes from "./organiser.routes";
import profileRoutes from "./profile.routes";
import supportRoutes from "./support.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/profile", profileRoutes);
router.use("/events", eventRoutes);
router.use("/organiser", organiserRoutes);
router.use("/holds", holdRoutes);
router.use("/checkout", checkoutRoutes);
router.use("/me", meRoutes);
router.use("/support", supportRoutes);

export default router;
