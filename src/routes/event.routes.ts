import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import { getEvent, getEvents, patchEvent, postEvent } from "../controllers/event.controller";
import { authenticate, authorize } from "../middleware/auth";
import sectionRoutes from "./section.routes";

const router = Router();

router.get("/", getEvents);
router.post("/", authenticate, authorize(Role.ORGANISER), postEvent);
router.get("/:eventId", getEvent);
router.patch("/:eventId", authenticate, authorize(Role.ORGANISER), patchEvent);
router.use("/:eventId/sections", sectionRoutes);

export default router;
