import { Router } from "express";
import { getMyBookings } from "../controllers/booking.controller";
import { getMyHolds } from "../controllers/hold.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);
router.get("/holds", getMyHolds);
router.get("/bookings", getMyBookings);

export default router;
