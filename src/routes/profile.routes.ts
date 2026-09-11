import { Router } from "express";
import { getProfile, patchProfile } from "../controllers/profile.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);
router.get("/", getProfile);
router.patch("/", patchProfile);

export default router;
