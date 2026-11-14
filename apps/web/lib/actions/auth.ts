"use server";

import { completeSignOut } from "@/lib/complete-sign-out";

export async function signOutAction(): Promise<void> {
  await completeSignOut();
}
