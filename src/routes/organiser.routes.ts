import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import { getMyEvents } from "../controllers/organiser.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate, authorize(Role.ORGANISER));
router.get("/events", getMyEvents);

export default router;
