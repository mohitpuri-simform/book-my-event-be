import { Router } from "express";
import { getCheckoutStatusHandler, postCheckout } from "../controllers/checkout.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.post("/", authenticate, postCheckout);
router.get("/:paymentIntentId/status", authenticate, getCheckoutStatusHandler);

export default router;
