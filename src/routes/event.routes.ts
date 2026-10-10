import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import {
  getEvent,
  getEvents,
  patchEvent,
  postEvent,
  postPublishEvent,
  postUnpublishEvent,
} from "../controllers/event.controller";
import { authenticate, authorize, optionalAuthenticate } from "../middleware/auth";
import seatRoutes from "./seat.routes";
import sectionRoutes from "./section.routes";

const router = Router();

router.get("/", getEvents);
router.post("/", authenticate, authorize(Role.ORGANISER), postEvent);
router.get("/:eventId", optionalAuthenticate, getEvent);
router.patch("/:eventId", authenticate, authorize(Role.ORGANISER), patchEvent);
router.post("/:eventId/publish", authenticate, authorize(Role.ORGANISER), postPublishEvent);
router.post("/:eventId/unpublish", authenticate, authorize(Role.ORGANISER), postUnpublishEvent);
router.use("/:eventId/sections", sectionRoutes);
router.use("/:eventId/seats", seatRoutes);

export default router;
