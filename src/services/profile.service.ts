import { prisma } from "../lib/prisma";
import type { PublicUser } from "./auth.service";
import type { UpdateProfileInput } from "../validation/profile.schema";

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<PublicUser> {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { name: input.name },
  });

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
