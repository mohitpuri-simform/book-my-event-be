import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import { getOrganiserEventBookings } from "../controllers/booking.controller";
import { getMyEvent, getMyEvents } from "../controllers/organiser.controller";
import { postConnectStripeAccount } from "../controllers/stripeConnect.controller";
import { getWallet, postWithdraw } from "../controllers/wallet.controller";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();

router.use(authenticate, authorize(Role.ORGANISER));
router.get("/events", getMyEvents);
router.get("/events/:eventId", getMyEvent);
router.get("/events/:eventId/bookings", getOrganiserEventBookings);
router.post("/stripe/connect", postConnectStripeAccount);
router.get("/wallet", getWallet);
router.post("/wallet/withdraw", postWithdraw);

export default router;
