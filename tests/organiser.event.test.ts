import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../src/app";
import { disconnectAll, resetState } from "./helpers/db";
import { createEventWithSeat, createTestUser } from "./helpers/factories";

beforeEach(async () => {
  await resetState();
});

afterAll(async () => {
  await disconnectAll();
});

describe("organiser event scoping (IDOR)", () => {
  it("an organiser can fetch their own event via /organiser/events/:eventId", async () => {
    const { event, organiser } = await createEventWithSeat();

    const res = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", organiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(event.id);
  });

  it("an organiser cannot fetch another organiser's event via /organiser/events/:eventId", async () => {
    const { event } = await createEventWithSeat();
    const otherOrganiser = await createTestUser("ORGANISER");

    const res = await request(app)
      .get(`/organiser/events/${event.id}`)
      .set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(404);
  });

  it("another organiser's event does not appear in /organiser/events", async () => {
    const { event } = await createEventWithSeat();
    const otherOrganiser = await createTestUser("ORGANISER");

    const res = await request(app).get("/organiser/events").set("Cookie", otherOrganiser.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.find((e: { id: string }) => e.id === event.id)).toBeUndefined();
  });
});
