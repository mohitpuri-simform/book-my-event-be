import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import {
  deleteSectionHandler,
  getSections,
  patchReorderSections,
  patchSection,
  postSection,
} from "../controllers/section.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router({ mergeParams: true });

router.get("/", getSections);
router.post("/", authenticate, authorize(Role.ORGANISER), postSection);
router.patch("/reorder", authenticate, authorize(Role.ORGANISER), patchReorderSections);
router.patch("/:sectionId", authenticate, authorize(Role.ORGANISER), patchSection);
router.delete("/:sectionId", authenticate, authorize(Role.ORGANISER), deleteSectionHandler);

export default router;
