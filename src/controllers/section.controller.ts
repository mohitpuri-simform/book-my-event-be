import type { Request, Response } from "express";
import { MESSAGES } from "../constants/messages.constants";
import { asyncHandler } from "../utils/asyncHandler";
import { sendSuccess } from "../utils/response";
import {
  createSectionSchema,
  reorderSectionsSchema,
  updateSectionSchema,
} from "../validation/section.schema";
import {
  createSectionWithSeats,
  deleteSection,
  listSectionsForEvent,
  reorderSections,
  updateSection,
} from "../services/section.service";

export const postSection = asyncHandler(async (req: Request, res: Response) => {
  const input = createSectionSchema.parse(req.body);
  const section = await createSectionWithSeats(req.params.eventId!, req.user!.id, input);
  sendSuccess(res, { statusCode: 201, data: section, message: MESSAGES.sections.createSuccess });
});

export const getSections = asyncHandler(async (req: Request, res: Response) => {
  const sections = await listSectionsForEvent(req.params.eventId!, req.user?.id);
  sendSuccess(res, { data: sections, message: MESSAGES.sections.fetchSuccess });
});

export const patchSection = asyncHandler(async (req: Request, res: Response) => {
  const input = updateSectionSchema.parse(req.body);
  const section = await updateSection(
    req.params.eventId!,
    req.params.sectionId!,
    req.user!.id,
    input,
  );
  sendSuccess(res, { data: section, message: MESSAGES.sections.updateSuccess });
});

export const patchReorderSections = asyncHandler(async (req: Request, res: Response) => {
  const input = reorderSectionsSchema.parse(req.body);
  const sections = await reorderSections(req.params.eventId!, req.user!.id, input);
  sendSuccess(res, { data: sections, message: MESSAGES.sections.reorderSuccess });
});

export const deleteSectionHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteSection(req.params.eventId!, req.params.sectionId!, req.user!.id);
  sendSuccess(res, { message: MESSAGES.sections.deleteSuccess });
});
