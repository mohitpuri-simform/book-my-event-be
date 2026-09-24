import { Router } from "express";
import { postSeatHold } from "../controllers/hold.controller";
import { authenticate } from "../middleware/auth";

const router = Router({ mergeParams: true });

router.post("/:seatId/hold", authenticate, postSeatHold);

export default router;
