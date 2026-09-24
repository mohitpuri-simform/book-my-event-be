import { Router } from "express";
import { deleteHold } from "../controllers/hold.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);
router.delete("/:holdId", deleteHold);

export default router;
